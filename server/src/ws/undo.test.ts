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
import { applyPlayerEvent, ok, startLive, type Client, type LiveHarness, type PlayerState } from './testing/harness.js';

// LIV-05: undo over the wire, against a real SQLite file and real Socket.io clients over a real port
// (specs/04-live-sync.md §2, §3, §4, §8, specs/10-testing-acceptance.md §2, D-040, D-117). Undoing a
// command restores the database and sends each room exactly what the inverse command sends: players
// hear nothing of undoing a hidden token's add or move, and undoing a reveal reaches them as the
// `token.removed` a hide sends. The DM's copy and the player's copy, kept from the events alone,
// always equal a fresh snapshot.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let h: LiveHarness;

beforeEach(async () => {
  h = await startLive();
});

afterEach(async () => {
  await h.close();
});

interface World {
  sceneA: Scene;
  sceneB: Scene;
  goblin: LibraryAsset;
  lurker: LibraryAsset;
  dm: Client;
  tv: Client;
}

/** Scene A live with a visible goblin placed in preparation; a DM socket and a player socket. */
async function world(): Promise<World & { first: SceneToken }> {
  const sceneA = await h.scene('Crypt of undoing', (await h.image('undo wire A', 96)).id);
  const sceneB = await h.scene('The far road', (await h.image('undo wire B', 80)).id);
  const goblin = await h.asset('Goblin');
  const lurker = await h.asset('Lurker', { category: 'monster', default_hidden: true, notes: 'Waits in the dark' });
  const first = await h.place(sceneA.id, goblin.id, 1, 1);
  const dm = await h.connect({ cookie: h.cookie });
  const tv = await h.connect();
  await acknowledged(dm, 'scene.activate', { scene_id: sceneA.id });
  await dm.settle();
  await tv.settle();
  return { sceneA, sceneB, goblin, lurker, dm, tv, first };
}

// Every table of the database, read from the schema itself.
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

/** Sends a command and answers the events each socket received for it. */
async function step(w: World, type: string, payload: unknown): Promise<{ dm: EventEnvelope[]; tv: EventEnvelope[] }> {
  await acknowledged(w.dm, type, payload);
  return { dm: await w.dm.settle(), tv: await w.tv.settle() };
}
const undo = (w: World) => step(w, 'undo', {});
const shape = (events: EventEnvelope[]) =>
  events.map((event) => ({
    type: event.type,
    id: (event.payload as { id?: string; token?: { id: string } }).token?.id ?? (event.payload as { id?: string }).id,
  }));
const tokenOf = (events: EventEnvelope[]) => (events[0]!.payload as TokenChange).token;

describe('undo over the wire (specs/04-live-sync.md §8, D-040)', () => {
  it('acknowledges undo with nothing to undo and tells nobody, taking no version', async () => {
    const w = await world();
    const before = dump();
    const versions = [h.versions.dm.current(), h.versions.players.current()];
    expect(await undo(w)).toEqual({ dm: [], tv: [] });
    expect(dump()).toEqual(before);
    expect([h.versions.dm.current(), h.versions.players.current()]).toEqual(versions);
  });

  it('undoes the add of a hidden token: the DM hears token.removed, players nothing', async () => {
    const w = await world();
    const before = dump();
    const added = await step(w, 'token.add', { scene_id: w.sceneA.id, asset_id: w.lurker.id, x: 4, y: 4 });
    expect(added.tv).toEqual([]);
    const lurker = tokenOf(added.dm);
    const undone = await undo(w);
    expect(shape(undone.dm)).toEqual([{ type: 'token.removed', id: lurker.id }]);
    expect(undone.tv).toEqual([]);
    expect(dump()).toEqual(before);
  });

  it('undoes the move of a hidden token: the DM hears it moved back, players nothing', async () => {
    const w = await world();
    const lurker = await h.place(w.sceneB.id, w.lurker.id, 0, 0);
    await acknowledged(w.dm, 'scene.activate', { scene_id: w.sceneB.id });
    await w.dm.settle();
    await w.tv.settle();
    const before = dump();
    expect((await step(w, 'token.move', { token_id: lurker.id, x: 6, y: 2 })).tv).toEqual([]);
    const undone = await undo(w);
    expect(undone.dm).toHaveLength(1);
    expect(tokenOf(undone.dm)).toMatchObject({ id: lurker.id, x: 0, y: 0, hidden: true });
    expect(undone.tv).toEqual([]);
    expect(dump()).toEqual(before);
  });

  it('undoes the delete of a hidden token: the DM hears it added back, as it was, and players nothing', async () => {
    const w = await world();
    const hidden = tokenOf(
      (await step(w, 'token.add', { scene_id: w.sceneA.id, asset_id: w.lurker.id, x: 3, y: 3 })).dm,
    );
    const before = dump();
    expect((await step(w, 'token.delete', { token_id: hidden.id })).tv).toEqual([]);
    const undone = await undo(w);
    expect(shape(undone.dm)).toEqual([{ type: 'token.added', id: hidden.id }]);
    expect(tokenOf(undone.dm)).toEqual(hidden);
    expect(undone.tv).toEqual([]);
    expect(dump()).toEqual(before);
  });

  it('undoes a reveal: players hear token.removed, exactly what a hide sends', async () => {
    const w = await world();
    const hidden = tokenOf(
      (await step(w, 'token.add', { scene_id: w.sceneA.id, asset_id: w.lurker.id, x: 3, y: 3 })).dm,
    );
    const row = () => h.data.db.prepare('SELECT * FROM token WHERE id = ?').get(hidden.id);
    const before = row();
    const revealed = await step(w, 'token.setVisibility', { token_id: hidden.id, hidden: false });
    expect(shape(revealed.tv)).toEqual([{ type: 'token.added', id: hidden.id }]);
    const undone = await undo(w);
    expect(shape(undone.dm)).toEqual([{ type: 'token.updated', id: hidden.id }]);
    expect(tokenOf(undone.dm)).toMatchObject({ hidden: true });
    expect(undone.tv).toEqual([
      { type: 'token.removed', version: expect.any(Number) as number, payload: { id: hidden.id } },
    ]);
    // The token is as it was, but players saw it: it stays shown, so a later reveal keeps its label
    // (Q-096); the number its first showing issued stays issued (Q-091, Q-092, D-117).
    expect(row()).toEqual({ ...(before as object), shown: 1 });
  });

  it('puts back whether players saw a deleted token, so its next reveal keeps the label they saw (Q-096)', async () => {
    const w = await world();
    const shown = () => h.data.db.prepare('SELECT shown FROM token WHERE id = ?').pluck().get(w.first.id);
    expect(shown()).toBe(1);
    await step(w, 'token.setVisibility', { token_id: w.first.id, hidden: true });
    await step(w, 'token.delete', { token_id: w.first.id });
    await undo(w);
    expect(shown()).toBe(1);
    const revealed = await step(w, 'token.setVisibility', { token_id: w.first.id, hidden: false });
    expect((revealed.tv[0]!.payload as { token: { label: string } }).token.label).toBe('Goblin');
    expect(JSON.stringify(revealed.tv)).not.toContain('shown');
  });

  it('undoes a hide: players hear token.added with the label they saw, and the database is as before', async () => {
    const w = await world();
    const before = dump();
    await step(w, 'token.setVisibility', { token_id: w.first.id, hidden: true });
    const undone = await undo(w);
    expect(shape(undone.tv)).toEqual([{ type: 'token.added', id: w.first.id }]);
    expect((undone.tv[0]!.payload as { token: { label: string } }).token.label).toBe('Goblin');
    expect(dump()).toEqual(before);
  });

  it('undoes a move and a delete of a visible token, and the add of a visible one, as their inverse commands send', async () => {
    const w = await world();
    const before = dump();
    await step(w, 'token.move', { token_id: w.first.id, x: 5, y: 5 });
    await step(w, 'token.delete', { token_id: w.first.id });
    const placed = tokenOf(
      (await step(w, 'token.add', { scene_id: w.sceneA.id, asset_id: w.goblin.id, x: 7, y: 7 })).dm,
    );

    const unAdd = await undo(w);
    expect(shape(unAdd.tv)).toEqual([{ type: 'token.removed', id: placed.id }]);
    const unDelete = await undo(w);
    expect(shape(unDelete.dm)).toEqual([{ type: 'token.added', id: w.first.id }]);
    expect(shape(unDelete.tv)).toEqual([{ type: 'token.added', id: w.first.id }]);
    expect(tokenOf(unDelete.tv)).toMatchObject({ x: 5, y: 5, label: 'Goblin' });
    const unMove = await undo(w);
    expect(shape(unMove.tv)).toEqual([{ type: 'token.updated', id: w.first.id }]);
    expect(tokenOf(unMove.tv)).toMatchObject({ x: 1, y: 1 });

    // Every token is as it was. The add issued number 2, which stays issued: undoing it is a deletion,
    // and no number is issued twice (Q-091, D-117).
    const table = (dumped: string, name: string) =>
      (JSON.parse(dumped) as [string, Record<string, unknown>[]][]).find(([each]) => each === name)![1];
    expect(table(dump(), 'token')).toEqual(table(before, 'token'));
    const issued = (dumped: string) =>
      table(dumped, 'scene').map((scene) => JSON.parse(scene.token_numbers as string) as Record<string, number>);
    expect(issued(before)).toContainEqual({ [w.goblin.id]: 1 });
    expect(issued(dump())).toContainEqual({ [w.goblin.id]: 2 });
  });

  it('keeps both rooms’ copies, built from the events alone, equal to a fresh snapshot through a run of undos', async () => {
    const w = await world();
    let player: PlayerState = applyPlayerEvent({ version: 0, scene: null }, (await requestSnapshot(w.tv))!);
    // The DM's copy, kept as the DM view keeps it: a token event replaces its token and the ones it
    // renamed, a removal drops it.
    const dm = new Map(
      ((await requestSnapshot(w.dm))!.payload as DmSnapshot).scene!.tokens.map((token) => [token.id, token]),
    );
    const applyDm = (events: EventEnvelope[]) => {
      for (const event of events) {
        if (event.type === 'token.removed') dm.delete((event.payload as { id: string }).id);
        else if (event.type === 'token.added' || event.type === 'token.updated') {
          const { token, relabelled } = event.payload as TokenChange;
          for (const each of [token, ...relabelled]) dm.set(each.id, each);
        } else throw new Error(`unexpected ${event.type}`);
      }
    };
    const byId = (tokens: Iterable<SceneToken>) => [...tokens].sort((a, b) => a.id.localeCompare(b.id));
    const commands: [string, object][] = [
      ['token.add', { scene_id: w.sceneA.id, asset_id: w.lurker.id, x: 2, y: 2 }],
      ['token.add', { scene_id: w.sceneA.id, asset_id: w.goblin.id, x: 3, y: 3 }],
      ['token.move', { token_id: w.first.id, x: 8, y: 1 }],
      ['token.setVisibility', { token_id: w.first.id, hidden: true }],
      ['token.delete', { token_id: w.first.id }],
    ];
    for (const [type, payload] of commands) {
      const events = await step(w, type, payload);
      applyDm(events.dm);
      for (const event of events.tv) player = applyPlayerEvent(player, event);
    }
    for (let n = 0; n < commands.length; n++) {
      const events = await undo(w);
      expect(events.dm, `undo ${n + 1}`).toHaveLength(1);
      applyDm(events.dm);
      for (const event of events.tv) player = applyPlayerEvent(player, event);
      const fresh = (await requestSnapshot(w.tv))!.payload as PlayerSnapshot;
      expect(player.scene).toEqual(fresh.scene);
      const dmFresh = (await requestSnapshot(w.dm))!.payload as DmSnapshot;
      expect(byId(dm.values())).toEqual(byId(dmFresh.scene!.tokens));
    }
    expect(player.scene?.tokens.map((token) => token.id)).toEqual([w.first.id]);
  });

  it('refuses an invalid undo payload in the envelope, and leaves the history to the next valid undo', async () => {
    const w = await world();
    await step(w, 'token.move', { token_id: w.first.id, x: 4, y: 4 });
    const before = dump();
    for (const payload of [{ steps: 1 }, { token_id: w.first.id }, null, 'undo']) {
      const ack = (await h.command(w.dm, 'undo', payload)) as ErrorEnvelope;
      expect(ack.error.code, JSON.stringify(payload)).toBe('validation_failed');
    }
    expect(dump()).toEqual(before);
    expect(await w.dm.settle()).toEqual([]);
    expect(await w.tv.settle()).toEqual([]);
    await undo(w);
    expect(h.data.db.prepare('SELECT x, y FROM token WHERE id = ?').get(w.first.id)).toEqual({ x: 1, y: 1 });
  });

  it('is shared by every DM browser: one undoes the other’s most recent command', async () => {
    const w = await world();
    const other = await h.connect({ cookie: h.cookie });
    await acknowledged(other, 'token.move', { token_id: w.first.id, x: 9, y: 9 });
    await acknowledged(w.dm, 'undo', {});
    expect(h.data.db.prepare('SELECT x, y FROM token WHERE id = ?').get(w.first.id)).toEqual({ x: 1, y: 1 });
  });

  it('refuses undo from a player socket, changing nothing, and leaves the history to the DM', async () => {
    const w = await world();
    await step(w, 'token.move', { token_id: w.first.id, x: 4, y: 4 });
    const before = dump();
    const ack = (await h.command(w.tv, 'undo', {})) as ErrorEnvelope;
    expect(ack.error.code).toBe('forbidden');
    expect(dump()).toEqual(before);
    expect(await w.tv.settle()).toEqual([]);
    await undo(w);
    expect(h.data.db.prepare('SELECT x, y FROM token WHERE id = ?').get(w.first.id)).toEqual({ x: 1, y: 1 });
  });

  it('forgets the history when another scene goes live, on Blank TV, and when the live scene is deleted', async () => {
    const w = await world();
    const quiet = async () => {
      const before = dump();
      expect(await undo(w)).toEqual({ dm: [], tv: [] });
      expect(dump()).toEqual(before);
    };
    await step(w, 'token.move', { token_id: w.first.id, x: 4, y: 4 });
    await step(w, 'scene.activate', { scene_id: w.sceneB.id });
    await step(w, 'scene.activate', { scene_id: w.sceneA.id });
    await quiet();

    await step(w, 'token.move', { token_id: w.first.id, x: 5, y: 5 });
    await step(w, 'scene.deactivate', {});
    await quiet();
    await step(w, 'scene.activate', { scene_id: w.sceneA.id });
    await quiet();

    await step(w, 'token.move', { token_id: w.first.id, x: 6, y: 6 });
    const summary = await h.inject({ method: 'GET', url: `/api/scenes/${w.sceneA.id}/deletion` });
    ok(
      await h.inject({
        method: 'DELETE',
        url: `/api/scenes/${w.sceneA.id}`,
        payload: { confirm: summary.json<object>() },
      }),
      204,
    );
    await w.dm.settle();
    await w.tv.settle();
    await quiet();
  });

  it('refuses an undo whose token is gone, as the inverse command would be, telling nobody', async () => {
    const w = await world();
    const other = await h.connect({ cookie: h.cookie });
    await step(w, 'token.move', { token_id: w.first.id, x: 4, y: 4 });
    // Another DM browser deletes the token and presses Ctrl+Z: the delete, most recent, is undone first.
    await acknowledged(other, 'token.delete', { token_id: w.first.id });
    await acknowledged(other, 'undo', {});
    await w.dm.settle();
    await w.tv.settle();
    // The token is back, so the move's inverse, next in the history, applies.
    await undo(w);
    expect(h.data.db.prepare('SELECT x, y FROM token WHERE id = ?').get(w.first.id)).toEqual({ x: 1, y: 1 });

    await step(w, 'token.move', { token_id: w.first.id, x: 2, y: 2 });
    h.data.db.prepare('DELETE FROM token WHERE id = ?').run(w.first.id);
    const before = dump();
    const ack = (await h.command(w.dm, 'undo', {})) as ErrorEnvelope;
    expect(ack.error.code).toBe('not_found');
    expect(dump()).toEqual(before);
    expect(await w.dm.settle()).toEqual([]);
    expect(await w.tv.settle()).toEqual([]);
  });
});

async function requestSnapshot(client: Client): Promise<EventEnvelope | undefined> {
  await client.settle();
  return client.events.at(-1);
}
