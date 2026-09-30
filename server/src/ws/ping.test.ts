import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DmSnapshotSchema,
  PingShownPayloadSchema,
  PlayerSnapshotSchema,
  type ErrorEnvelope,
  type Scene,
} from '@emberglass/shared';
import { compileSchema } from '../validation.js';
import { startLive, type Client, type LiveHarness } from './testing/harness.js';

// TBL-01 over a real port and real Socket.io clients, against a real SQLite file (specs/04-live-sync.md
// §2, §3, §12, Q-099): `ping` from the DM view reaches both rooms as the same `ping`, one version each; it
// names the live scene or is refused, and is stored nowhere, never undone and carried by no snapshot.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let h: LiveHarness;

afterEach(async () => {
  await h.close();
});

const isShown = compileSchema(PingShownPayloadSchema);
const isDmSnapshot = compileSchema(DmSnapshotSchema);
const isPlayerSnapshot = compileSchema(PlayerSnapshotSchema);

async function liveScene(): Promise<{ scene: Scene; other: Scene; dm: Client; tv: Client }> {
  h = await startLive();
  const scene = await h.scene('The long hall', (await h.image('ping map', 96)).id);
  const other = await h.scene('The vault', (await h.image('ping map B', 80)).id);
  const dm = await h.connect({ cookie: h.cookie });
  const tv = await h.connect();
  expect(await h.command(dm, 'scene.activate', { scene_id: scene.id })).toEqual({ ok: true });
  await dm.settle();
  await tv.settle();
  return { scene, other, dm, tv };
}

const ping = (client: Client, scene: Scene, x = 4.5, y = 2.25) =>
  h.command(client, 'ping', { scene_id: scene.id, x, y });
const code = (ack: unknown) => (ack as ErrorEnvelope).error.code;
const types = (events: { type: string }[]) => events.map((event) => event.type);

/** Every row of every table, to prove that a ping writes nothing. */
function dump(): Record<string, unknown[]> {
  const db = h.data.db;
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
    name: string;
  }[];
  return Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}"`).all()]));
}

describe('ping (specs/04-live-sync.md §2, §3, §12)', () => {
  it('reaches both rooms as the same ping, one version each, the point in grid units', async () => {
    const { scene, dm, tv } = await liveScene();
    const versions = [h.versions.dm.current(), h.versions.players.current()];
    expect(await ping(dm, scene)).toEqual({ ok: true });
    const [dmEvents, tvEvents] = [await dm.settle(), await tv.settle()];
    expect(dmEvents.map((event) => [event.type, event.version])).toEqual([['ping', versions[0]! + 1]]);
    expect(tvEvents.map((event) => [event.type, event.version])).toEqual([['ping', versions[1]! + 1]]);
    expect(dmEvents[0]!.payload).toEqual({ x: 4.5, y: 2.25 });
    expect(tvEvents[0]!.payload).toEqual({ x: 4.5, y: 2.25 });
    expect(isShown(tvEvents[0]!.payload)).toBe(true);
    // The same point again is a new ping: each is drawn.
    expect(await ping(dm, scene)).toEqual({ ok: true });
    expect(types(await tv.settle())).toEqual(['ping']);
  });

  it('refuses a ping for a scene that is not live, and when nothing is live; players hear nothing', async () => {
    const { scene, other, dm, tv } = await liveScene();
    expect(code(await ping(dm, other))).toBe('scene_not_live');
    expect(await dm.settle()).toEqual([]);
    expect(await tv.settle()).toEqual([]);
    await h.command(dm, 'scene.deactivate', {});
    await dm.settle();
    await tv.settle();
    expect(code(await ping(dm, scene))).toBe('scene_not_live');
    expect(await dm.settle()).toEqual([]);
    expect(await tv.settle()).toEqual([]);
  });

  it('refuses a ping from a player view', async () => {
    const { scene, dm, tv } = await liveScene();
    expect(code(await ping(tv, scene))).toBe('forbidden');
    expect(await dm.settle()).toEqual([]);
    expect(await tv.settle()).toEqual([]);
  });

  it('is never stored, never undone and in no snapshot', async () => {
    const { scene, dm, tv } = await liveScene();
    const goblin = await h.asset('Goblin');
    expect(await h.command(dm, 'token.add', { scene_id: scene.id, asset_id: goblin.id, x: 2, y: 2 })).toEqual({
      ok: true,
    });
    await dm.settle();
    await tv.settle();
    const before = dump();
    expect(await ping(dm, scene)).toEqual({ ok: true });
    expect(dump()).toEqual(before);
    await dm.settle();
    await tv.settle();
    // Undo takes back the placement before it; the ping was never recorded.
    expect(await h.command(dm, 'undo', {})).toEqual({ ok: true });
    expect(types(await tv.settle())).toEqual(['token.removed']);
    expect(await h.command(dm, 'undo', {})).toEqual({ ok: true });
    expect(await tv.settle()).toEqual([]);

    // A screen and a DM browser connecting after it are given snapshots with no ping in them.
    const later = await h.connect();
    const laterDm = await h.connect({ cookie: h.cookie });
    expect(isPlayerSnapshot(later.first.payload)).toBe(true);
    expect(isDmSnapshot(laterDm.first.payload)).toBe(true);
    expect(JSON.stringify(later.first.payload)).not.toContain('ping');
    expect(JSON.stringify(laterDm.first.payload)).not.toContain('ping');
  });
});
