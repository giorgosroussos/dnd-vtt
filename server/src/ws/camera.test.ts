import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DmCameraPayloadSchema,
  DmSnapshotSchema,
  FIT_CAMERA,
  PLAYER_VIEW_AUTH,
  PlayerCameraPayloadSchema,
  PlayerSnapshotSchema,
  SOCKET_CHANNELS,
  type DmSnapshot,
  type ErrorEnvelope,
  type EventEnvelope,
  type PlayerCamera,
  type PlayerSnapshot,
  type Scene,
} from '@emberglass/shared';
import { compileSchema } from '../validation.js';
import { ok, startLive, type Client, type LiveHarness } from './testing/harness.js';

// LIV-06 over a real port and real Socket.io clients, against a real SQLite file (specs/04-live-sync.md
// §2, §3, §5, §6, §9, specs/10-testing-acceptance.md §2; Q-038, D-018, D-119): `camera.setPlayer` from
// the DM view reaches both rooms as `camera.player`, one version each; a screen connecting receives
// the camera with its snapshot; activation and a new world reset it; and a player view's viewport
// report reaches the DM room only, as the shape the TV frame follows.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let h: LiveHarness;

afterEach(async () => {
  await h.close();
});

const steered: PlayerCamera = { centre_x: 0.25, centre_y: 0.4, width: 0.5, height: 0.3 };
const isDmCamera = compileSchema(DmCameraPayloadSchema);
const isPlayerCamera = compileSchema(PlayerCameraPayloadSchema);
const isDmSnapshot = compileSchema(DmSnapshotSchema);
const isPlayerSnapshot = compileSchema(PlayerSnapshotSchema);

async function liveScene(snapshotIntervalMs = 0): Promise<{ scene: Scene; mapless: Scene; dm: Client; tv: Client }> {
  h = await startLive({ snapshotIntervalMs });
  const scene = await h.scene('The watchtower', (await h.image('camera map', 96)).id);
  const mapless = await h.scene('The fog');
  const dm = await h.connect({ cookie: h.cookie });
  const tv = await h.connect();
  expect(await h.command(dm, 'scene.activate', { scene_id: scene.id })).toEqual({ ok: true });
  await dm.settle();
  await tv.settle();
  return { scene, mapless, dm, tv };
}

const report = (client: Client, viewport: unknown) =>
  client.socket.timeout(5_000).emitWithAck(SOCKET_CHANNELS.viewport, viewport) as Promise<unknown>;
const snapshotOf = <S>(client: Client) => client.events.at(-1)!.payload as S;

describe('camera.setPlayer (specs/04-live-sync.md §2, §3, §9)', () => {
  it('reaches both rooms as camera.player, one version each, the players without the screen', async () => {
    const { scene, dm, tv } = await liveScene();
    const versions = [h.versions.dm.current(), h.versions.players.current()];
    expect(await h.command(dm, 'camera.setPlayer', { scene_id: scene.id, camera: steered })).toEqual({ ok: true });
    const [dmEvents, tvEvents] = [await dm.settle(), await tv.settle()];
    expect(dmEvents.map((event) => [event.type, event.version])).toEqual([['camera.player', versions[0]! + 1]]);
    expect(tvEvents.map((event) => [event.type, event.version])).toEqual([['camera.player', versions[1]! + 1]]);
    expect(dmEvents[0]!.payload).toEqual({ camera: steered, screen: null });
    expect(isDmCamera(dmEvents[0]!.payload)).toBe(true);
    expect(tvEvents[0]!.payload).toEqual({ camera: steered });
    expect(isPlayerCamera(tvEvents[0]!.payload)).toBe(true);
    // The snapshot each asked for agrees.
    expect(snapshotOf<DmSnapshot>(dm).scene?.camera).toEqual(steered);
    expect(snapshotOf<PlayerSnapshot>(tv).scene?.camera).toEqual(steered);
  });

  it('tells nobody when the camera is already the one sent, and takes no version', async () => {
    const { scene, dm, tv } = await liveScene();
    expect(await h.command(dm, 'camera.setPlayer', { scene_id: scene.id, camera: FIT_CAMERA })).toEqual({ ok: true });
    expect(await dm.settle()).toEqual([]);
    expect(await tv.settle()).toEqual([]);
  });

  it('refuses a camera for a scene that is not live, an invalid camera and a camera outside sane bounds', async () => {
    const { scene, mapless, dm, tv } = await liveScene();
    const code = async (payload: unknown) =>
      ((await h.command(dm, 'camera.setPlayer', payload)) as ErrorEnvelope).error.code;
    expect(await code({ scene_id: mapless.id, camera: steered })).toBe('scene_not_live');
    for (const camera of [
      { ...steered, width: 0 },
      { ...steered, width: 1_000 },
      { ...steered, centre_x: -1 },
      { ...steered, centre_y: 1.5 },
      { ...steered, extra: true },
      { centre_x: 0.5, centre_y: 0.5, width: 1 },
    ]) {
      expect(await code({ scene_id: scene.id, camera }), JSON.stringify(camera)).toBe('validation_failed');
    }
    expect(await code({ scene_id: scene.id, camera: steered, screen: { width: 1, height: 1 } })).toBe(
      'validation_failed',
    );
    expect(await dm.settle()).toEqual([]);
    expect(await tv.settle()).toEqual([]);
    expect(snapshotOf<PlayerSnapshot>(tv).scene?.camera).toEqual(FIT_CAMERA);
  });

  it('gives a player view connecting or reconnecting the current camera with its snapshot', async () => {
    const { scene, dm } = await liveScene();
    await h.command(dm, 'camera.setPlayer', { scene_id: scene.id, camera: steered });
    const late = await h.connect();
    expect(isPlayerSnapshot(late.first.payload)).toBe(true);
    expect((late.first.payload as PlayerSnapshot).scene?.camera).toEqual(steered);
    // The TV of the DM's own laptop too (D-105), and a second DM browser, whose frame follows it.
    const laptop = await h.connect({ cookie: h.cookie }, { ...PLAYER_VIEW_AUTH });
    expect((laptop.first.payload as PlayerSnapshot).scene?.camera).toEqual(steered);
    const other = await h.connect({ cookie: h.cookie });
    expect(isDmSnapshot(other.first.payload)).toBe(true);
    expect((other.first.payload as DmSnapshot).scene?.camera).toEqual(steered);
  });

  it('resets both rooms to fit on activation of another scene, of the live scene again, and after Blank TV', async () => {
    const { scene, mapless, dm, tv } = await liveScene();
    const steer = async (id: string) => {
      expect(await h.command(dm, 'camera.setPlayer', { scene_id: id, camera: steered })).toEqual({ ok: true });
      await tv.settle();
      await dm.settle();
    };
    const fittedAfter = async (action: () => Promise<unknown>) => {
      await action();
      const events = await tv.settle();
      await dm.settle();
      expect(events.map((event) => event.type)).toEqual(['scene.snapshot']);
      expect((events[0]!.payload as PlayerSnapshot).scene?.camera).toEqual(FIT_CAMERA);
      expect(snapshotOf<DmSnapshot>(dm).scene?.camera).toEqual(FIT_CAMERA);
    };
    await steer(scene.id);
    await fittedAfter(() => h.command(dm, 'scene.activate', { scene_id: mapless.id }));
    await steer(mapless.id);
    await fittedAfter(() => h.command(dm, 'scene.activate', { scene_id: mapless.id }));
    await steer(mapless.id);
    await h.command(dm, 'scene.deactivate', {});
    await tv.settle();
    await dm.settle();
    await fittedAfter(() => h.command(dm, 'scene.activate', { scene_id: mapless.id }));
  });

  it('fits again when a setup edit gives the live scene another world, and keeps it through one that does not', async () => {
    const { scene, dm, tv } = await liveScene();
    const patch = async (id: string, payload: object) =>
      ok<Scene>(await h.inject({ method: 'PATCH', url: `/api/scenes/${id}`, payload }));
    await h.command(dm, 'camera.setPlayer', { scene_id: scene.id, camera: steered });
    await tv.settle();
    // A recalibration and the players' grid keep the world: the camera stays.
    await patch(scene.id, { grid: { size: 16, offset_x: 1, offset_y: 2, columns: 5, rows: 3 } });
    await patch(scene.id, { grid: { visible: false } });
    for (const event of await tv.settle()) expect((event.payload as PlayerSnapshot).scene?.camera).toEqual(steered);
    // A new map is another world: fitted again, in the snapshot it causes.
    const { id: other } = await h.image('camera map, replaced', 80);
    await patch(scene.id, { map_image_id: other });
    const events = await tv.settle();
    expect(events.map((event) => event.type)).toEqual(['scene.snapshot']);
    expect((events[0]!.payload as PlayerSnapshot).scene?.camera).toEqual(FIT_CAMERA);
    expect(snapshotOf<DmSnapshot>(dm).scene?.camera).toEqual(FIT_CAMERA);
  });

  it('fits a map-less scene again when a map is attached to it while live', async () => {
    const { mapless, dm, tv } = await liveScene();
    await h.command(dm, 'scene.activate', { scene_id: mapless.id });
    await h.command(dm, 'camera.setPlayer', { scene_id: mapless.id, camera: steered });
    await tv.settle();
    expect(snapshotOf<PlayerSnapshot>(tv).scene?.camera).toEqual(steered);
    const { id: map } = await h.image('camera map for the fog', 80);
    ok<Scene>(await h.inject({ method: 'PATCH', url: `/api/scenes/${mapless.id}`, payload: { map_image_id: map } }));
    const events = await tv.settle();
    expect((events.at(-1)!.payload as PlayerSnapshot).scene?.camera).toEqual(FIT_CAMERA);
  });
});

describe('viewport reports and the shape the TV frame follows (D-119)', () => {
  const screenEvents = (events: EventEnvelope[]) =>
    events.filter((event) => event.type === 'camera.player').map((event) => event.payload);

  it('tells the DM room the shape of the screen connected longest, and never the players', async () => {
    const { tv, dm } = await liveScene();
    const phone = await h.connect();
    expect(await report(phone, { width: 390, height: 844 })).toEqual({ ok: true });
    expect(screenEvents(await dm.settle())).toEqual([{ camera: FIT_CAMERA, screen: { width: 390, height: 844 } }]);
    // The TV connected first: once it reports, the frame follows it, and the phone's reports change nothing.
    expect(await report(tv, { width: 1920, height: 1080 })).toEqual({ ok: true });
    expect(screenEvents(await dm.settle())).toEqual([{ camera: FIT_CAMERA, screen: { width: 1920, height: 1080 } }]);
    await report(phone, { width: 844, height: 390 });
    expect(await dm.settle()).toEqual([]);
    // The DM room's snapshot carries it; a player's never does.
    expect(snapshotOf<DmSnapshot>(dm).scene?.screen).toEqual({ width: 1920, height: 1080 });
    for (const player of [tv, phone]) {
      expect(await player.settle()).toEqual([]);
      expect(JSON.stringify(player.events)).not.toMatch(/screen|1920|844/);
    }
    // The TV leaves: the frame follows the phone.
    tv.socket.disconnect();
    await vi.waitFor(async () =>
      expect(screenEvents(await dm.settle())).toEqual([{ camera: FIT_CAMERA, screen: { width: 844, height: 390 } }]),
    );
  });

  it('says nothing to the DM room while nothing is live, and the next activation carries the shape', async () => {
    const { scene, dm, tv } = await liveScene();
    await h.command(dm, 'scene.deactivate', {});
    await dm.settle();
    await report(tv, { width: 1280, height: 720 });
    expect(await dm.settle()).toEqual([]);
    await h.command(dm, 'scene.activate', { scene_id: scene.id });
    await dm.settle();
    expect(snapshotOf<DmSnapshot>(dm).scene?.screen).toEqual({ width: 1280, height: 720 });
  });

  it('refuses a report from a DM socket and an invalid report, and changes nothing', async () => {
    const { dm, tv } = await liveScene();
    expect(((await report(dm, { width: 1920, height: 1080 })) as ErrorEnvelope).error.code).toBe('forbidden');
    for (const wrong of [
      null,
      'big',
      { width: 0, height: 10 },
      { width: 10.5, height: 10 },
      { width: 10 },
      { width: 10, height: 10, x: 1 },
    ]) {
      expect(((await report(tv, wrong)) as ErrorEnvelope).error.code, JSON.stringify(wrong)).toBe('validation_failed');
    }
    expect(await dm.settle()).toEqual([]);
    expect(snapshotOf<DmSnapshot>(dm).scene?.screen).toBeNull();
  });

  it('tells the DM room at most once per interval however many screens change it, ending on the shape chosen (review S-M1)', async () => {
    const { dm } = await liveScene(200);
    const screens: Client[] = [];
    for (let n = 0; n < 20; n++) screens.push(await h.connect());
    await dm.settle();
    const start = dm.events.length;
    // Reported newest first, so each report makes another socket the one connected longest.
    for (let n = screens.length - 1; n >= 0; n--) await report(screens[n]!, { width: 100 + n, height: 1000 });
    const told = () => dm.events.slice(start).filter((event) => event.type === 'camera.player');
    await vi.waitFor(
      () => expect(told().at(-1)?.payload).toEqual({ camera: FIT_CAMERA, screen: { width: 100, height: 1000 } }),
      {
        timeout: 3_000,
      },
    );
    // Twenty changes in well under a second reached the DM room as at most a few events.
    expect(told().length).toBeLessThanOrEqual(3);
    const versions = told().map((event) => event.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('takes at most one report per interval from a socket, the latest winning', async () => {
    const { dm, tv } = await liveScene(200);
    await report(tv, { width: 1000, height: 1000 });
    for (let width = 1001; width <= 1010; width++) await report(tv, { width, height: 1000 });
    await vi.waitFor(() => expect(dm.events.filter((event) => event.type === 'camera.player')).toHaveLength(2), {
      timeout: 3_000,
    });
    const screens = dm.events.filter((event) => event.type === 'camera.player').map((event) => event.payload);
    expect(screens).toEqual([
      { camera: FIT_CAMERA, screen: { width: 1000, height: 1000 } },
      { camera: FIT_CAMERA, screen: { width: 1010, height: 1000 } },
    ]);
  });
});
