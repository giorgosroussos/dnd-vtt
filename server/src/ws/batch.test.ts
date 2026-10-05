import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DmSnapshot,
  ErrorEnvelope,
  EventEnvelope,
  LibraryAsset,
  PlayerSnapshot,
  Scene,
  SceneToken,
  TokenChange,
} from '@emberglass/shared';
import { applyPlayerEvent, startLive, type Client, type LiveHarness, type PlayerState } from './testing/harness.js';

// UXR-02: `token.batch` over the wire, against a real SQLite file and real Socket.io clients over a real port
// (specs/04-live-sync.md §2, §4, §8, Q-123). A batch applies its commands in order, all or nothing; each room
// receives exactly what those commands sent one by one would send, so players hear nothing of a hidden token in
// it and nothing names the batch; one undo takes the whole group back and one redo applies it again.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let h: LiveHarness;

beforeEach(async () => {
  h = await startLive();
});

afterEach(async () => {
  await h.close();
});

interface World {
  scene: Scene;
  other: Scene;
  goblin: LibraryAsset;
  lurker: LibraryAsset;
  a: SceneToken;
  b: SceneToken;
  hidden: SceneToken;
  dm: Client;
  tv: Client;
}

/** A live scene with two visible goblins and a hidden lurker; a DM socket and a player socket. */
async function world(): Promise<World> {
  const scene = await h.scene('Hall of many', (await h.image('batch wire', 96)).id);
  const other = await h.scene('Elsewhere', (await h.image('batch elsewhere', 80)).id);
  const goblin = await h.asset('Goblin', { category: 'monster', default_hidden: false, hp_max: 7 });
  const lurker = await h.asset('Lurker', { category: 'monster', default_hidden: true, hp_max: 20 });
  const a = await h.place(scene.id, goblin.id, 1, 1);
  const b = await h.place(scene.id, goblin.id, 2, 1);
  const hidden = await h.place(scene.id, lurker.id, 3, 1);
  const dm = await h.connect({ cookie: h.cookie });
  const tv = await h.connect();
  await acknowledged(dm, 'scene.activate', { scene_id: scene.id });
  await dm.settle();
  await tv.settle();
  return { scene, other, goblin, lurker, a, b, hidden, dm, tv };
}

const dump = () =>
  JSON.stringify(
    (
      h.data.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .pluck()
        .all() as string[]
    ).map((table) => [table, h.data.db.prepare(`SELECT * FROM "${table}"`).all()]),
  );

async function acknowledged(client: Client, type: string, payload: unknown): Promise<void> {
  const ack = await h.command(client, type, payload);
  expect(ack, `${type} ${JSON.stringify(ack)}`).toEqual({ ok: true });
}
async function step(w: World, type: string, payload: unknown): Promise<{ dm: EventEnvelope[]; tv: EventEnvelope[] }> {
  await acknowledged(w.dm, type, payload);
  return { dm: await w.dm.settle(), tv: await w.tv.settle() };
}
const batch = (w: World, ...commands: { type: string; payload: object }[]) => step(w, 'token.batch', { commands });
const move = (token: SceneToken, x: number, y: number) => ({
  type: 'token.move',
  payload: { token_id: token.id, x, y },
});
const hide = (token: SceneToken, hidden = true) => ({
  type: 'token.setVisibility',
  payload: { token_id: token.id, hidden },
});
const tokensOf = (events: EventEnvelope[]) =>
  events
    .filter((event) => event.type !== 'history.changed')
    .map((event) => ({
      type: event.type,
      id: (event.payload as { token?: { id: string }; id?: string }).token?.id ?? (event.payload as { id?: string }).id,
    }));
const historyOf = (events: EventEnvelope[]) =>
  events.filter((event) => event.type === 'history.changed').map((event) => event.payload);
const row = (id: string) => h.data.db.prepare('SELECT x, y, hidden FROM token WHERE id = ?').get(id);

describe('token.batch over the wire (specs/04-live-sync.md §2, §8, Q-123)', () => {
  it('moves a group, hidden token included: the DM hears each, players only the ones they see; one undo, one redo', async () => {
    const w = await world();
    const before = dump();
    const moved = await batch(w, move(w.a, 5, 5), move(w.hidden, 6, 5), move(w.b, 7, 5));
    expect(tokensOf(moved.dm)).toEqual([
      { type: 'token.updated', id: w.a.id },
      { type: 'token.updated', id: w.hidden.id },
      { type: 'token.updated', id: w.b.id },
    ]);
    expect(tokensOf(moved.tv)).toEqual([
      { type: 'token.updated', id: w.a.id },
      { type: 'token.updated', id: w.b.id },
    ]);
    expect(JSON.stringify(moved.tv)).not.toContain(w.hidden.id);
    expect(historyOf(moved.dm)).toEqual([{ can_undo: true, can_redo: false }]);

    const undone = await step(w, 'undo', {});
    // Last first: the batch's moves taken back in the reverse order, as one step.
    expect(tokensOf(undone.dm).map((event) => event.id)).toEqual([w.b.id, w.hidden.id, w.a.id]);
    expect(tokensOf(undone.tv).map((event) => event.id)).toEqual([w.b.id, w.a.id]);
    expect(historyOf(undone.dm)).toEqual([{ can_undo: false, can_redo: true }]);
    expect(dump()).toEqual(before);

    const redone = await step(w, 'redo', {});
    expect(tokensOf(redone.dm).map((event) => event.id)).toEqual([w.a.id, w.hidden.id, w.b.id]);
    expect([row(w.a.id), row(w.hidden.id), row(w.b.id)]).toEqual([
      { x: 5, y: 5, hidden: 0 },
      { x: 6, y: 5, hidden: 1 },
      { x: 7, y: 5, hidden: 0 },
    ]);
    await step(w, 'undo', {});
    expect(dump()).toEqual(before);
  });

  it('hides and reveals a group: players hear token.removed and token.added, the undo puts them back with their labels', async () => {
    const w = await world();
    const label = (id: string) => h.data.db.prepare('SELECT label FROM token WHERE id = ?').pluck().get(id);
    const shown = [label(w.a.id), label(w.b.id)];
    const hidden = await batch(w, hide(w.a), hide(w.b), hide(w.hidden));
    // Hiding the hidden lurker changed nothing: the DM hears of the two goblins only.
    expect(tokensOf(hidden.dm).map((event) => event.id)).toEqual([w.a.id, w.b.id]);
    expect(tokensOf(hidden.tv)).toEqual([
      { type: 'token.removed', id: w.a.id },
      { type: 'token.removed', id: w.b.id },
    ]);
    const undone = await step(w, 'undo', {});
    expect(tokensOf(undone.tv).map((event) => event.type)).toEqual(['token.added', 'token.added']);
    const labels = undone.tv.map((event) => (event.payload as TokenChange).token.label).sort();
    expect(labels).toEqual(shown.sort());
  });

  it('applies damage, conditions and deletions to a group, undone together', async () => {
    const w = await world();
    const before = dump();
    await batch(
      w,
      { type: 'token.applyHp', payload: { token_id: w.a.id, delta: -4 } },
      { type: 'token.applyHp', payload: { token_id: w.b.id, delta: -4 } },
    );
    const hp = (id: string) => h.data.db.prepare('SELECT hp_current FROM token WHERE id = ?').pluck().get(id);
    expect([hp(w.a.id), hp(w.b.id)]).toEqual([3, 3]);
    await batch(
      w,
      { type: 'token.setMarkers', payload: { token_id: w.a.id, markers: [{ id: 'prone' }] } },
      { type: 'token.setMarkers', payload: { token_id: w.b.id, markers: [{ id: 'prone' }] } },
    );
    const gone = await batch(
      w,
      { type: 'token.delete', payload: { token_id: w.a.id } },
      { type: 'token.delete', payload: { token_id: w.hidden.id } },
    );
    expect(tokensOf(gone.tv)).toEqual([{ type: 'token.removed', id: w.a.id }]);
    for (let n = 0; n < 3; n++) await step(w, 'undo', {});
    expect(dump()).toEqual(before);
  });

  it('refuses the whole batch when one of its commands is refused: nothing changes and nobody is told', async () => {
    const w = await world();
    const elsewhere = await h.place(w.other.id, w.goblin.id, 0, 0);
    await w.dm.settle();
    const before = dump();
    const versions = [h.versions.dm.current(), h.versions.players.current()];
    for (const commands of [
      // A token of a scene that is not live, after a move that would have applied.
      [move(w.a, 9, 9), move(elsewhere, 1, 1)],
      // A token that does not exist.
      [move(w.a, 9, 9), { type: 'token.delete', payload: { token_id: '00000000-0000-4000-8000-0000000000ff' } }],
      // A condition twice, which the schema lets through and the command refuses.
      [
        hide(w.a),
        {
          type: 'token.setMarkers',
          payload: {
            token_id: w.b.id,
            markers: [
              { id: 'exhaustion', level: 1 },
              { id: 'exhaustion', level: 2 },
            ],
          },
        },
      ],
    ]) {
      const ack = (await h.command(w.dm, 'token.batch', { commands })) as ErrorEnvelope;
      expect(ack.error.code).not.toBeUndefined();
      expect(await w.dm.settle()).toEqual([]);
      expect(await w.tv.settle()).toEqual([]);
      expect(dump()).toEqual(before);
    }
    expect([h.versions.dm.current(), h.versions.players.current()]).toEqual(versions);
    // Nothing entered the history: undo finds nothing to take back.
    expect(await step(w, 'undo', {})).toEqual({ dm: [], tv: [] });
  });

  it('keeps both rooms’ copies, built from the events alone, equal to a fresh snapshot through batches and their undo', async () => {
    const w = await world();
    let player: PlayerState = applyPlayerEvent({ version: 0, scene: null }, w.tv.events.at(-1)!);
    const dm = new Map((w.dm.events.at(-1)!.payload as DmSnapshot).scene!.tokens.map((token) => [token.id, token]));
    const applyDm = (events: EventEnvelope[]) => {
      for (const event of events) {
        if (event.type === 'token.removed') dm.delete((event.payload as { id: string }).id);
        else if (event.type === 'token.added' || event.type === 'token.updated') {
          const { token, relabelled } = event.payload as TokenChange;
          for (const each of [token, ...relabelled]) dm.set(each.id, each);
        }
      }
    };
    const byId = (tokens: Iterable<SceneToken>) => [...tokens].sort((x, y) => x.id.localeCompare(y.id));
    const check = async () => {
      await w.dm.settle();
      await w.tv.settle();
      await acknowledged(w.dm, 'scene.activate', { scene_id: w.scene.id });
      const fresh = await w.tv.settle();
      const dmFresh = await w.dm.settle();
      return { tv: fresh.at(-1)!.payload as PlayerSnapshot, dm: dmFresh.at(-1)!.payload as DmSnapshot };
    };
    const steps: { type: string; payload: object }[][] = [
      [move(w.a, 4, 4), move(w.hidden, 4, 5)],
      [hide(w.b), hide(w.hidden, false)],
      [{ type: 'token.delete', payload: { token_id: w.a.id } }, move(w.b, 8, 8)],
    ];
    for (const commands of steps) {
      const events = await batch(w, ...commands);
      applyDm(events.dm);
      for (const event of events.tv) player = applyPlayerEvent(player, event);
    }
    for (let n = 0; n < steps.length; n++) {
      const events = await step(w, 'undo', {});
      applyDm(events.dm);
      for (const event of events.tv) player = applyPlayerEvent(player, event);
    }
    // Activating the same scene again sends each room a fresh snapshot to compare against (and resets the camera).
    const fresh = await check();
    expect(player.scene!.tokens).toEqual(fresh.tv.scene!.tokens);
    expect(byId(dm.values())).toEqual(byId(fresh.dm.scene!.tokens));
  });
});
