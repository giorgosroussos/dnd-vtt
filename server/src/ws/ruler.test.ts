import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DmSnapshotSchema,
  PLAYER_VIEW_AUTH,
  PlayerSnapshotSchema,
  RulerClearedPayloadSchema,
  RulerShownPayloadSchema,
  type DmSnapshot,
  type ErrorEnvelope,
  type Measurement,
  type PlayerSnapshot,
  type Scene,
} from '@emberglass/shared';
import { compileSchema } from '../validation.js';
import { ok, startLive, type Client, type LiveHarness } from './testing/harness.js';

// LIV-07 over a real port and real Socket.io clients, against a real SQLite file (specs/04-live-sync.md
// §2, §3, §5, §11, specs/06-grid-and-measurement.md §5, specs/10-testing-acceptance.md §2; Q-027, Q-037,
// Q-048, Q-086, Q-087, D-121): `ruler.update` and `ruler.clear` from the DM view reach both rooms as
// `ruler.shown` and `ruler.cleared`, one version each; a measurement names the live scene or is refused;
// it is held in memory, never stored nor undone, carried by every snapshot, and taken off by an
// activation, Blank TV, a new map and the DM socket that drew it going.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let h: LiveHarness;

afterEach(async () => {
  await h.close();
});

const isShown = compileSchema(RulerShownPayloadSchema);
const isCleared = compileSchema(RulerClearedPayloadSchema);
const isDmSnapshot = compileSchema(DmSnapshotSchema);
const isPlayerSnapshot = compileSchema(PlayerSnapshotSchema);

const from = { column: 1, row: 1 };
const to = { column: 7, row: 3 };
// Six across and two down: 30 ft by the PHB rule at 5 ft a square.
const measured: Measurement = { from, to, feet: 30 };

async function liveScene(): Promise<{ scene: Scene; other: Scene; dm: Client; tv: Client }> {
  h = await startLive();
  const scene = await h.scene('The long hall', (await h.image('ruler map', 96)).id);
  const other = await h.scene('The vault', (await h.image('ruler map B', 80)).id);
  const dm = await h.connect({ cookie: h.cookie });
  const tv = await h.connect();
  expect(await h.command(dm, 'scene.activate', { scene_id: scene.id })).toEqual({ ok: true });
  await dm.settle();
  await tv.settle();
  return { scene, other, dm, tv };
}

const measure = (client: Client, scene: Scene, path: { from: object; to: object } = { from, to }) =>
  h.command(client, 'ruler.update', { scene_id: scene.id, ...path });
const clear = (client: Client, scene: Scene) => h.command(client, 'ruler.clear', { scene_id: scene.id });
const code = (ack: unknown) => (ack as ErrorEnvelope).error.code;
const rulerOf = (client: Client) => (client.events.at(-1)!.payload as DmSnapshot | PlayerSnapshot).scene?.ruler;
const types = (events: { type: string }[]) => events.map((event) => event.type);

/** Every row of every table, to prove that a measurement writes nothing. */
function dump(): Record<string, unknown[]> {
  const db = h.data.db;
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
    name: string;
  }[];
  return Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}"`).all()]));
}

describe('ruler.update and ruler.clear (specs/04-live-sync.md §2, §3, §11)', () => {
  it('reach both rooms as ruler.shown and ruler.cleared, one version each, the same squares and distance', async () => {
    const { scene, dm, tv } = await liveScene();
    let versions = [h.versions.dm.current(), h.versions.players.current()];
    expect(await measure(dm, scene)).toEqual({ ok: true });
    let [dmEvents, tvEvents] = [await dm.settle(), await tv.settle()];
    expect(dmEvents.map((event) => [event.type, event.version])).toEqual([['ruler.shown', versions[0]! + 1]]);
    expect(tvEvents.map((event) => [event.type, event.version])).toEqual([['ruler.shown', versions[1]! + 1]]);
    expect(dmEvents[0]!.payload).toEqual({ ruler: measured });
    expect(tvEvents[0]!.payload).toEqual({ ruler: measured });
    expect(isShown(tvEvents[0]!.payload)).toBe(true);
    // The snapshot each asked for agrees.
    expect(rulerOf(dm)).toEqual(measured);
    expect(rulerOf(tv)).toEqual(measured);

    // Moving the end reaches both rooms again, once.
    expect(await measure(dm, scene, { from, to: { column: 1, row: 5 } })).toEqual({ ok: true });
    [dmEvents, tvEvents] = [await dm.settle(), await tv.settle()];
    expect(types(dmEvents)).toEqual(['ruler.shown']);
    expect(tvEvents.map((event) => event.payload)).toEqual([{ ruler: { from, to: { column: 1, row: 5 }, feet: 20 } }]);

    versions = [h.versions.dm.current(), h.versions.players.current()];
    expect(await clear(dm, scene)).toEqual({ ok: true });
    [dmEvents, tvEvents] = [await dm.settle(), await tv.settle()];
    expect(dmEvents.map((event) => [event.type, event.version])).toEqual([['ruler.cleared', versions[0]! + 1]]);
    expect(tvEvents.map((event) => [event.type, event.version])).toEqual([['ruler.cleared', versions[1]! + 1]]);
    expect(isCleared(tvEvents[0]!.payload)).toBe(true);
    expect(rulerOf(dm)).toBeNull();
    expect(rulerOf(tv)).toBeNull();
  });

  it('tells nobody when the measurement is the one shown, or a clear finds nothing shown', async () => {
    const { scene, dm, tv } = await liveScene();
    expect(await clear(dm, scene)).toEqual({ ok: true });
    await measure(dm, scene);
    await dm.settle();
    await tv.settle();
    const versions = [h.versions.dm.current(), h.versions.players.current()];
    expect(await measure(dm, scene)).toEqual({ ok: true });
    expect(await dm.settle()).toEqual([]);
    expect(await tv.settle()).toEqual([]);
    expect([h.versions.dm.current(), h.versions.players.current()]).toEqual(versions);
  });

  it('refuses a measurement or a clear for a scene that is not live, and an invalid one; players hear nothing (Q-086)', async () => {
    const { scene, other, dm, tv } = await liveScene();
    // A scene being prepared while another is live: nothing of it reaches the TV.
    expect(code(await measure(dm, other))).toBe('scene_not_live');
    expect(code(await clear(dm, other))).toBe('scene_not_live');
    for (const payload of [
      { scene_id: scene.id, from },
      { scene_id: scene.id, from, to: { column: 0.5, row: 1 } },
      { scene_id: scene.id, from, to, feet: 1 },
      { from, to },
    ]) {
      expect(code(await h.command(dm, 'ruler.update', payload)), JSON.stringify(payload)).toBe('validation_failed');
    }
    expect(code(await h.command(dm, 'ruler.clear', {}))).toBe('validation_failed');
    expect(await dm.settle()).toEqual([]);
    expect(await tv.settle()).toEqual([]);
    expect(rulerOf(tv)).toBeNull();
    // Nothing live at all: refused the same way.
    await h.command(dm, 'scene.deactivate', {});
    await tv.settle();
    expect(code(await measure(dm, scene))).toBe('scene_not_live');
    expect(code(await clear(dm, scene))).toBe('scene_not_live');
    expect(await tv.settle()).toEqual([]);
  });

  it('is never stored and never undone: undo takes back the command before it and the measurement stays', async () => {
    const { scene, dm, tv } = await liveScene();
    const goblin = await h.asset('Goblin');
    expect(await h.command(dm, 'token.add', { scene_id: scene.id, asset_id: goblin.id, x: 2, y: 2 })).toEqual({
      ok: true,
    });
    const token = ((await dm.settle())[0]!.payload as { token: { id: string } }).token;
    await tv.settle();
    expect(await h.command(dm, 'token.move', { token_id: token.id, x: 5, y: 5 })).toEqual({ ok: true });
    const before = dump();
    await measure(dm, scene);
    expect(dump()).toEqual(before);
    await clear(dm, scene);
    expect(dump()).toEqual(before);
    await measure(dm, scene);
    expect(dump()).toEqual(before);
    await dm.settle();
    await tv.settle();

    expect(await h.command(dm, 'undo', {})).toEqual({ ok: true });
    const events = await tv.settle();
    expect(types(events)).toEqual(['token.updated']);
    expect(events[0]!.payload).toMatchObject({ token: { id: token.id, x: 2, y: 2 } });
    expect(rulerOf(tv)).toEqual(measured);
    // Then the placement, and nothing is left to undo: the ruler commands were never recorded.
    expect(await h.command(dm, 'undo', {})).toEqual({ ok: true });
    expect(types(await tv.settle())).toEqual(['token.removed']);
    expect(await h.command(dm, 'undo', {})).toEqual({ ok: true });
    expect(await tv.settle()).toEqual([]);
    expect(rulerOf(tv)).toEqual(measured);
  });

  it('gives a screen or a DM browser connecting or reconnecting the measurement shown, with its snapshot', async () => {
    const { scene, dm } = await liveScene();
    await measure(dm, scene);
    const late = await h.connect();
    expect(isPlayerSnapshot(late.first.payload)).toBe(true);
    expect((late.first.payload as PlayerSnapshot).scene?.ruler).toEqual(measured);
    const laptop = await h.connect({ cookie: h.cookie }, { ...PLAYER_VIEW_AUTH });
    expect((laptop.first.payload as PlayerSnapshot).scene?.ruler).toEqual(measured);
    const other = await h.connect({ cookie: h.cookie });
    expect(isDmSnapshot(other.first.payload)).toBe(true);
    expect((other.first.payload as DmSnapshot).scene?.ruler).toEqual(measured);
  });
});

describe('the distance (specs/06-grid-and-measurement.md §5, Q-037, Q-087)', () => {
  it("counts by the server-wide rule and the live scene's feet per square; a new scale reaches both rooms", async () => {
    const { scene, dm, tv } = await liveScene();
    h.data.db.prepare("UPDATE settings SET ruler_rule = 'dmg'").run();
    // Two diagonals: 5 + 10 under the DMG rule.
    await measure(dm, scene, { from: { column: 0, row: 0 }, to: { column: 2, row: 2 } });
    expect((await tv.settle())[0]!.payload).toEqual({
      ruler: { from: { column: 0, row: 0 }, to: { column: 2, row: 2 }, feet: 15 },
    });
    await dm.settle();

    // A live setup edit of the scale reaches both rooms in the snapshot it pushes, the distance recounted.
    const response = await h.inject({
      method: 'PATCH',
      url: `/api/scenes/${scene.id}`,
      payload: { grid: { feet_per_square: 10 } },
    });
    expect(ok<Scene>(response).grid.feet_per_square).toBe(10);
    const [dmEvents, tvEvents] = [await dm.settle(), await tv.settle()];
    expect(types(dmEvents)).toEqual(['scene.snapshot']);
    expect(types(tvEvents)).toEqual(['scene.snapshot']);
    for (const event of [dmEvents[0]!, tvEvents[0]!]) {
      expect((event.payload as PlayerSnapshot).scene?.ruler).toEqual({
        from: { column: 0, row: 0 },
        to: { column: 2, row: 2 },
        feet: 30,
      });
    }
    expect((tvEvents[0]!.payload as PlayerSnapshot).scene?.grid.feet_per_square).toBe(10);
  });
});

describe('what takes a measurement off the TV (D-121)', () => {
  it('another activation, the live scene activated again, and Blank TV', async () => {
    const { scene, other, dm, tv } = await liveScene();
    await measure(dm, scene);
    await h.command(dm, 'scene.activate', { scene_id: other.id });
    let events = await tv.settle();
    expect(types(events)).toEqual(['ruler.shown', 'scene.snapshot']);
    expect((events[1]!.payload as PlayerSnapshot).scene?.ruler).toBeNull();

    await measure(dm, other);
    await h.command(dm, 'scene.activate', { scene_id: other.id });
    events = await tv.settle();
    expect((events.at(-1)!.payload as PlayerSnapshot).scene?.ruler).toBeNull();

    await measure(dm, other);
    await h.command(dm, 'scene.deactivate', {});
    await h.command(dm, 'scene.activate', { scene_id: other.id });
    events = await tv.settle();
    expect(types(events)).toEqual(['ruler.shown', 'scene.cleared', 'scene.snapshot']);
    expect((events.at(-1)!.payload as PlayerSnapshot).scene?.ruler).toBeNull();
  });

  it('a new map for the live scene; a recalibration and a change to the players’ grid keep it', async () => {
    const { scene, dm, tv } = await liveScene();
    await measure(dm, scene);
    await tv.settle();
    const patch = async (payload: object) =>
      ok<Scene>(await h.inject({ method: 'PATCH', url: `/api/scenes/${scene.id}`, payload }));
    await patch({ grid: { size: 12, offset_x: 1, offset_y: 1, columns: 8, rows: 4 } });
    await patch({ grid: { visible: false } });
    let events = await tv.settle();
    expect(types(events)).toEqual(['scene.snapshot', 'scene.snapshot']);
    expect((events.at(-1)!.payload as PlayerSnapshot).scene?.ruler).toEqual(measured);
    await patch({ map_image_id: (await h.image('ruler map, redrawn', 90)).id });
    events = await tv.settle();
    expect((events.at(-1)!.payload as PlayerSnapshot).scene?.ruler).toBeNull();
    expect(rulerOf(dm)).toBeNull();
  });

  it('the DM socket that drew it going, not another; the last to measure owns the line', async () => {
    const { scene, dm, tv } = await liveScene();
    const second = await h.connect({ cookie: h.cookie });
    await measure(dm, scene);
    await tv.settle();
    second.socket.disconnect();
    expect(await tv.settle()).toEqual([]);
    expect(rulerOf(tv)).toEqual(measured);

    const versions = [h.versions.dm.current(), h.versions.players.current()];
    const third = await h.connect({ cookie: h.cookie });
    dm.socket.disconnect();
    let events = await tv.settle();
    expect(events.map((event) => [event.type, event.version])).toEqual([['ruler.cleared', versions[1]! + 1]]);
    expect(types(await third.settle())).toEqual(['ruler.cleared']);

    // Another DM browser measuring takes the line over: the first going no longer takes it off.
    const fourth = await h.connect({ cookie: h.cookie });
    await measure(fourth, scene);
    await measure(third, scene, { from, to: { column: 2, row: 2 } });
    await tv.settle();
    fourth.socket.disconnect();
    expect(await tv.settle()).toEqual([]);
    expect(rulerOf(tv)).toEqual({ from, to: { column: 2, row: 2 }, feet: 5 });
    // And a DM browser's clear takes off any measurement, whoever drew it.
    const fifth = await h.connect({ cookie: h.cookie });
    await clear(fifth, scene);
    events = await tv.settle();
    expect(types(events)).toEqual(['ruler.cleared']);
  });

  it('a DM session ending, whose sockets go with it', async () => {
    const { scene, dm, tv } = await liveScene();
    await measure(dm, scene);
    await tv.settle();
    const signOut = await h.inject({ method: 'DELETE', url: '/api/auth' });
    expect(signOut.statusCode, signOut.body).toBe(204);
    await vi.waitFor(() => expect(dm.socket.connected).toBe(false));
    const events = await tv.settle();
    expect(types(events)).toEqual(['ruler.cleared']);
  });
});

describe('ruler edge cases (LIV-07 review)', () => {
  it('shows none after the live scene is deleted over REST, and the drawing socket going then sends nothing (T-M5)', async () => {
    const { scene, other, dm, tv } = await liveScene();
    await measure(dm, scene);
    await tv.settle();
    const summary = await h.inject({ method: 'GET', url: `/api/scenes/${scene.id}/deletion` });
    const deleted = await h.inject({
      method: 'DELETE',
      url: `/api/scenes/${scene.id}`,
      payload: { confirm: summary.json<object>() },
    });
    expect(deleted.statusCode, deleted.body).toBe(204);
    expect(types(await tv.settle())).toEqual(['scene.cleared']);
    await h.command(dm, 'scene.activate', { scene_id: other.id });
    const events = await tv.settle();
    expect((events.at(-1)!.payload as PlayerSnapshot).scene?.ruler).toBeNull();
    dm.socket.disconnect();
    expect(await tv.settle()).toEqual([]);
  });

  it('gives the line to the last socket to send it, even when it is the one already shown (T-L1)', async () => {
    const { scene, dm, tv } = await liveScene();
    const second = await h.connect({ cookie: h.cookie });
    await measure(dm, scene);
    await tv.settle();
    // The same path from another DM socket tells nobody, but that socket now owns the line.
    await measure(second, scene);
    expect(await tv.settle()).toEqual([]);
    dm.socket.disconnect();
    expect(await tv.settle()).toEqual([]);
    second.socket.disconnect();
    expect(types(await tv.settle())).toEqual(['ruler.cleared']);
  });

  it('measures on a map-less live scene by its own feet per square (T-L3)', async () => {
    h = await startLive();
    const fog = await h.scene('The fog');
    ok<Scene>(
      await h.inject({ method: 'PATCH', url: `/api/scenes/${fog.id}`, payload: { grid: { feet_per_square: 10 } } }),
    );
    const dm = await h.connect({ cookie: h.cookie });
    const tv = await h.connect();
    await h.command(dm, 'scene.activate', { scene_id: fog.id });
    await tv.settle();
    expect(await measure(dm, fog, { from: { column: 29, row: 19 }, to: { column: 0, row: 0 } })).toEqual({ ok: true });
    expect((await tv.settle())[0]!.payload).toEqual({
      ruler: { from: { column: 29, row: 19 }, to: { column: 0, row: 0 }, feet: 290 },
    });
  });

  it('never tells players which socket drew the line (T-L7)', async () => {
    const { scene, dm, tv } = await liveScene();
    await measure(dm, scene);
    const received = JSON.stringify(await tv.settle()) + JSON.stringify(tv.events.at(-1));
    expect(dm.socket.id).toBeDefined();
    expect(received).not.toContain(dm.socket.id!);
    expect(received).not.toContain('owner');
  });
});
