import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DmSnapshotSchema,
  PlayerSnapshotSchema,
  type DeletionSummary,
  type DmSnapshot,
  type EventEnvelope,
  type LibraryAsset,
  type PlayerSnapshot,
  type Scene,
  type SceneToken,
  type Session,
} from '@emberglass/shared';
import { compileSchema } from '../validation.js';
import { ok, startLive, type Client, type LiveHarness } from './testing/harness.js';

// LIV-04: REST changes that alter the live scene reach the WebSocket rooms, against a real SQLite
// file and real Socket.io clients over a real port (specs/04-live-sync.md §4, §5, §10,
// specs/03-domain-model.md §7, specs/05-assets-and-images.md §5, Q-015, Q-031, G-012, G-019). A
// setup change to the live scene, or an asset change to one of its visible tokens, sends both rooms
// a fresh snapshot; a change players cannot see reaches the DM's room only; a change to a scene that
// is not live sends nothing; deleting the live scene or an ancestor sends both rooms the idle state.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const isDmSnapshot = compileSchema<DmSnapshot>(DmSnapshotSchema);
const isPlayerSnapshot = compileSchema<PlayerSnapshot>(PlayerSnapshotSchema);

let h: LiveHarness;

beforeEach(async () => {
  h = await startLive();
});

afterEach(async () => {
  await h.close();
});

interface World {
  live: Scene;
  other: Scene;
  goblin: LibraryAsset;
  lurker: LibraryAsset;
  visible: SceneToken;
  hidden: SceneToken;
  dm: Client;
  player: Client;
}

/** A live scene with a visible goblin and a hidden lurker, another scene, a DM and a player connected. */
async function world(): Promise<World> {
  const live = await h.scene('Lair of the lurker', (await h.image('map A', 96)).id);
  const other = await h.scene('The road', (await h.image('map B', 80)).id);
  const goblin = await h.asset('Goblin');
  const lurker = await h.asset('Lurker', { category: 'monster', default_hidden: true, notes: 'Waits in the dark' });
  const visible = await h.place(live.id, goblin.id, 1, 1);
  const hidden = await h.place(live.id, lurker.id, 2, 2);
  expect(hidden.hidden).toBe(true);
  const dm = await h.connect({ cookie: h.cookie });
  const player = await h.connect();
  expect(await h.command(dm, 'scene.activate', { scene_id: live.id })).toEqual({ ok: true });
  // The activation's snapshots are behind us: each test starts with nothing unread.
  expect((await dm.settle()).map((each) => each.type)).toEqual(['scene.snapshot']);
  expect((await player.settle()).map((each) => each.type)).toEqual(['scene.snapshot']);
  return { live, other, goblin, lurker, visible, hidden, dm, player };
}

const patchScene = (id: string, payload: object) => h.inject({ method: 'PATCH', url: `/api/scenes/${id}`, payload });
const patchAsset = (id: string, payload: object) => h.inject({ method: 'PATCH', url: `/api/assets/${id}`, payload });

async function remove(kind: 'campaigns' | 'sessions' | 'scenes', id: string): Promise<void> {
  const confirm = ok<DeletionSummary>(await h.inject({ method: 'GET', url: `/api/${kind}/${id}/deletion` }));
  expect(confirm.live).toBe(true);
  ok(await h.inject({ method: 'DELETE', url: `/api/${kind}/${id}`, payload: { confirm } }), 204);
}

/** The one snapshot a room received, checked against its room's strict schema. */
function onlySnapshot(events: EventEnvelope[], room: 'dm'): DmSnapshot;
function onlySnapshot(events: EventEnvelope[], room: 'players'): PlayerSnapshot;
function onlySnapshot(events: EventEnvelope[], room: 'dm' | 'players'): DmSnapshot | PlayerSnapshot {
  expect(events.map((each) => each.type)).toEqual(['scene.snapshot']);
  const payload = events[0]!.payload;
  expect(room === 'dm' ? isDmSnapshot(payload) : isPlayerSnapshot(payload)).toBe(true);
  return payload as unknown as DmSnapshot | PlayerSnapshot;
}

/** Nothing of the hidden token in anything players received: no id, asset, image, name or notes. */
function nothingHidden(events: EventEnvelope[], w: World): void {
  const text = JSON.stringify(events);
  for (const secret of [w.hidden.id, w.lurker.id, w.lurker.image_id, 'Lurker', 'Waits in the dark']) {
    expect(text).not.toContain(secret);
  }
}

describe('a REST change to the live scene (04 §10, G-019)', () => {
  it('sends both rooms a fresh snapshot with the new map, the players one without the hidden token', async () => {
    const w = await world();
    const map = await h.image('map C', 128);
    const before = { dm: h.versions.dm.current(), players: h.versions.players.current() };
    ok(await patchScene(w.live.id, { map_image_id: map.id }));
    const dm = onlySnapshot(await w.dm.settle(), 'dm');
    expect(dm.scene?.map?.id).toBe(map.id);
    expect(dm.scene?.tokens.map((each) => each.id).sort()).toEqual([w.visible.id, w.hidden.id].sort());
    const playerEvents = await w.player.settle();
    const players = onlySnapshot(playerEvents, 'players');
    expect(players.scene?.map?.id).toBe(map.id);
    expect(players.scene?.tokens.map((each) => each.id)).toEqual([w.visible.id]);
    nothingHidden(playerEvents, w);
    // Each snapshot took its room's next version, as an event does (04 §5).
    expect(w.dm.events.at(-2)?.version).toBe(before.dm + 1);
    expect(w.player.events.at(-2)?.version).toBe(before.players + 1);
  });

  it('sends both rooms the new calibration, and the grid players see hidden', async () => {
    const w = await world();
    const grid = { size: 16, offset_x: 2, offset_y: 3, columns: 5, rows: 2 };
    ok(await patchScene(w.live.id, { grid }));
    expect(onlySnapshot(await w.dm.settle(), 'dm').scene?.scene.grid).toMatchObject(grid);
    const calibrated = await w.player.settle();
    expect(onlySnapshot(calibrated, 'players').scene?.grid).toMatchObject(grid);
    nothingHidden(calibrated, w);
    ok(await patchScene(w.live.id, { grid: { visible: false } }));
    expect(onlySnapshot(await w.dm.settle(), 'dm').scene?.scene.grid.visible).toBe(false);
    const hiddenGrid = await w.player.settle();
    expect(onlySnapshot(hiddenGrid, 'players').scene?.grid.visible).toBe(false);
    nothingHidden(hiddenGrid, w);
  });

  it('tells only the DM room of a rename, which players do not see, and sends nothing for no change', async () => {
    const w = await world();
    const players = h.versions.players.current();
    ok(await patchScene(w.live.id, { name: 'The lair' }));
    expect(onlySnapshot(await w.dm.settle(), 'dm').scene?.scene.name).toBe('The lair');
    expect(await w.player.settle()).toEqual([]);
    expect(h.versions.players.current()).toBe(players);
    // Saving what is already stored changes nothing, so nobody is told.
    ok(await patchScene(w.live.id, { grid: { visible: true } }));
    expect(await w.dm.settle()).toEqual([]);
    expect(await w.player.settle()).toEqual([]);
  });

  it('sends nothing for a refused change to the live scene', async () => {
    const w = await world();
    const versions = { dm: h.versions.dm.current(), players: h.versions.players.current() };
    expect((await patchScene(w.live.id, { grid: { size: 0.001 } })).statusCode).toBe(400);
    expect((await patchScene(w.live.id, { map_image_id: 'f'.repeat(64) })).statusCode).toBe(400);
    expect(await w.dm.settle()).toEqual([]);
    expect(await w.player.settle()).toEqual([]);
    expect({ dm: h.versions.dm.current(), players: h.versions.players.current() }).toEqual(versions);
  });

  it('sends nothing for any change to a scene that is not live', async () => {
    const w = await world();
    const versions = { dm: h.versions.dm.current(), players: h.versions.players.current() };
    ok(await patchScene(w.other.id, { map_image_id: (await h.image('map D', 112)).id }));
    ok(await patchScene(w.other.id, { grid: { size: 16, offset_x: 0, offset_y: 0, columns: 5, rows: 3 } }));
    ok(await patchScene(w.other.id, { grid: { visible: false } }));
    ok(await patchScene(w.other.id, { name: 'The long road' }));
    ok(await h.post(`/api/scenes/${w.other.id}/tokens`, { asset_id: w.goblin.id, x: 0, y: 0 }), 201);
    expect(await w.dm.settle()).toEqual([]);
    expect(await w.player.settle()).toEqual([]);
    expect({ dm: h.versions.dm.current(), players: h.versions.players.current() }).toEqual(versions);
  });

  it('sends nothing while nothing is live', async () => {
    const w = await world();
    expect(await h.command(w.dm, 'scene.deactivate', {})).toEqual({ ok: true });
    await w.dm.settle();
    await w.player.settle();
    ok(await patchScene(w.live.id, { grid: { visible: false } }));
    ok(await patchAsset(w.goblin.id, { size: 'large' }));
    expect(await w.dm.settle()).toEqual([]);
    expect(await w.player.settle()).toEqual([]);
  });
});

describe('a REST change to an asset with a token on the live scene (05 §5, G-019)', () => {
  it('sends both rooms a snapshot with the new image of a visible token, and none of the hidden one', async () => {
    const w = await world();
    const image = await h.image('goblin, repainted');
    ok(await patchAsset(w.goblin.id, { image_id: image.id }));
    const dm = onlySnapshot(await w.dm.settle(), 'dm');
    expect(dm.scene?.tokens.find((each) => each.id === w.visible.id)?.asset.image_id).toBe(image.id);
    const playerEvents = await w.player.settle();
    const players = onlySnapshot(playerEvents, 'players');
    expect(players.scene?.tokens).toEqual([expect.objectContaining({ id: w.visible.id, image_id: image.id })]);
    nothingHidden(playerEvents, w);
  });

  it('sends both rooms a snapshot with the new size and the new name of a visible token', async () => {
    const w = await world();
    ok(await patchAsset(w.goblin.id, { size: 'large' }));
    expect(
      onlySnapshot(await w.dm.settle(), 'dm').scene?.tokens.find((each) => each.id === w.visible.id),
    ).toMatchObject({
      asset: { size: 'large' },
    });
    const resized = await w.player.settle();
    expect(onlySnapshot(resized, 'players').scene?.tokens).toEqual([
      expect.objectContaining({ id: w.visible.id, size: 'large' }),
    ]);
    nothingHidden(resized, w);
    // The lone goblin carries the bare name, which follows the asset (D-111).
    ok(await patchAsset(w.goblin.id, { name: 'Hobgoblin' }));
    await w.dm.settle();
    expect(onlySnapshot(await w.player.settle(), 'players').scene?.tokens[0]?.label).toBe('Hobgoblin');
  });

  it('tells only the DM room when every live token of the asset is hidden (04 §4)', async () => {
    const w = await world();
    const players = h.versions.players.current();
    ok(await patchAsset(w.lurker.id, { image_id: (await h.image('lurker, repainted')).id }));
    ok(await patchAsset(w.lurker.id, { size: 'huge' }));
    ok(await patchAsset(w.lurker.id, { name: 'Shade' }));
    const dm = await w.dm.settle();
    expect(dm.map((each) => each.type)).toEqual(['scene.snapshot', 'scene.snapshot', 'scene.snapshot']);
    expect(
      (dm.at(-1)!.payload as unknown as DmSnapshot).scene?.tokens.find((each) => each.id === w.hidden.id),
    ).toMatchObject({
      label: 'Shade',
      asset: { size: 'huge', name: 'Shade' },
    });
    // Players receive nothing, and their version does not move, so no gap tells them either.
    expect(await w.player.settle()).toEqual([]);
    expect(h.versions.players.current()).toBe(players);
  });

  it('sends nothing for an asset with no token on the live scene, or a change players never see', async () => {
    const w = await world();
    const kobold = await h.asset('Kobold');
    await h.place(w.other.id, kobold.id, 0, 0);
    ok(await patchAsset(kobold.id, { size: 'small', image_id: (await h.image('kobold, repainted')).id }));
    ok(await patchAsset(w.goblin.id, { notes: 'Carries a rusty key', tags: ['cave'], default_hidden: true }));
    expect(await w.dm.settle()).toEqual([]);
    expect(await w.player.settle()).toEqual([]);
  });
});

describe('deleting the live scene or an ancestor (03 §7, Q-031, G-012)', () => {
  const kinds = ['scene', 'session', 'campaign'] as const;

  for (const kind of kinds) {
    it(`sends both rooms the idle state and no id of the deleted scene when its ${kind} is deleted`, async () => {
      const w = await world();
      const session = ok<Session>(await h.inject({ method: 'GET', url: `/api/sessions/${w.live.session_id}` }));
      const id = kind === 'scene' ? w.live.id : kind === 'session' ? session.id : session.campaign_id;
      await remove(`${kind}s`, id);
      for (const client of [w.dm, w.player]) {
        const events = await client.settle();
        expect(events.map(({ type, payload }) => ({ type, payload }))).toEqual([
          { type: 'scene.cleared', payload: {} },
        ]);
        expect(JSON.stringify(events)).not.toContain(w.live.id);
      }
      nothingHidden(w.player.events.slice(1), w);
      // The idle state is what a fresh snapshot now says, in both rooms.
      expect(w.dm.events.at(-1)?.payload).toEqual({ role: 'dm', scene: null });
      expect(w.player.events.at(-1)?.payload).toEqual({ role: 'players', scene: null });
      // Blank TV afterwards is acknowledged and tells nobody anything more: the TV is already idle.
      expect(await h.command(w.dm, 'scene.deactivate', {})).toEqual({ ok: true });
      expect(await w.dm.settle()).toEqual([]);
      expect(await w.player.settle()).toEqual([]);
    });
  }

  it('sends nothing when a scene that is not live is deleted', async () => {
    const w = await world();
    const confirm = ok<DeletionSummary>(await h.inject({ method: 'GET', url: `/api/scenes/${w.other.id}/deletion` }));
    ok(await h.inject({ method: 'DELETE', url: `/api/scenes/${w.other.id}`, payload: { confirm } }), 204);
    expect(await w.dm.settle()).toEqual([]);
    expect(await w.player.settle()).toEqual([]);
  });

  it('sends nothing when the deletion is refused for a stale confirmation', async () => {
    const w = await world();
    const confirm = { sessions: 0, scenes: 1, tokens: 0, live: true };
    expect(
      (await h.inject({ method: 'DELETE', url: `/api/scenes/${w.live.id}`, payload: { confirm } })).statusCode,
    ).toBe(409);
    expect(await w.dm.settle()).toEqual([]);
    expect(await w.player.settle()).toEqual([]);
  });
});
