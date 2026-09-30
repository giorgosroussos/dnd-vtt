import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIT_CAMERA,
  type CommandEnvelope,
  type ErrorEnvelope,
  type LibraryAsset,
  type PlayerCamera,
  type Scene,
} from '@emberglass/shared';
import { readSnapshot } from '../ws/snapshot.js';
import { startLive, type LiveHarness } from '../ws/testing/harness.js';
import { PlayerCameraState, ScreenRegistry, sameCamera, sameScreen } from './camera.js';
import { validateCommand } from './commands.js';
import { createLiveCommands, type LiveCommands, type LiveEffect } from './live.js';

// LIV-06: the player camera held in memory for the live scene and the screens the TV frame follows
// (specs/04-live-sync.md §2, §9, Q-038, D-018, D-119). The pure parts on plain values; the commands and
// the snapshots against a real SQLite file (specs/10-testing-acceptance.md §2), prepared over REST.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const steered: PlayerCamera = { centre_x: 0.3, centre_y: 0.6, width: 0.4, height: 0.25 };
const command = (type: CommandEnvelope['type'], payload: Record<string, unknown> = {}): CommandEnvelope => ({
  type,
  payload,
});

describe('the player camera in memory (specs/04-live-sync.md §9, Q-038)', () => {
  it('is fitted for any scene but the one it was set on, and fitted again once reset', () => {
    const camera = new PlayerCameraState();
    expect(camera.of(id(1))).toEqual(FIT_CAMERA);
    expect(camera.of(null)).toEqual(FIT_CAMERA);
    camera.set(id(1), steered);
    expect(camera.of(id(1))).toEqual(steered);
    expect(camera.of(id(2))).toEqual(FIT_CAMERA);
    expect(camera.of(null)).toEqual(FIT_CAMERA);
    camera.reset();
    expect(camera.of(id(1))).toEqual(FIT_CAMERA);
  });

  it('keeps its own copy of the camera it was given', () => {
    const camera = new PlayerCameraState();
    const given = { ...steered };
    camera.set(id(1), given);
    given.width = 0.9;
    expect(camera.of(id(1))).toEqual(steered);
  });

  it('compares cameras and screens by value', () => {
    expect(sameCamera(steered, { ...steered })).toBe(true);
    expect(sameCamera(steered, { ...steered, height: 0.26 })).toBe(false);
    expect(sameScreen(null, null)).toBe(true);
    expect(sameScreen({ width: 1920, height: 1080 }, { width: 1920, height: 1080 })).toBe(true);
    expect(sameScreen({ width: 1920, height: 1080 }, null)).toBe(false);
    expect(sameScreen({ width: 1920, height: 1080 }, { width: 1280, height: 1080 })).toBe(false);
  });
});

describe('the screens the TV frame follows (D-119)', () => {
  it('follows the screen connected longest among those that reported, and the next one when it leaves', () => {
    const screens = new ScreenRegistry();
    expect(screens.chosen()).toBeNull();
    screens.connected('tv');
    screens.connected('phone');
    // The TV has not reported yet: the phone's shape is the only one known.
    screens.report('phone', { width: 390, height: 844 });
    expect(screens.chosen()).toEqual({ width: 390, height: 844 });
    screens.report('tv', { width: 1920, height: 1080 });
    expect(screens.chosen()).toEqual({ width: 1920, height: 1080 });
    // A later report from the phone changes nothing; one from the TV does.
    screens.report('phone', { width: 844, height: 390 });
    expect(screens.chosen()).toEqual({ width: 1920, height: 1080 });
    screens.report('tv', { width: 1280, height: 720 });
    expect(screens.chosen()).toEqual({ width: 1280, height: 720 });
    screens.disconnected('tv');
    expect(screens.chosen()).toEqual({ width: 844, height: 390 });
    screens.disconnected('phone');
    expect(screens.chosen()).toBeNull();
  });

  it('ignores a report from a socket it does not know, and a TV that reconnects is the newest', () => {
    const screens = new ScreenRegistry();
    screens.report('stranger', { width: 100, height: 100 });
    expect(screens.chosen()).toBeNull();
    screens.connected('tv');
    screens.report('tv', { width: 1920, height: 1080 });
    screens.connected('laptop');
    screens.report('laptop', { width: 1440, height: 900 });
    screens.disconnected('tv');
    screens.connected('tv again');
    screens.report('tv again', { width: 1920, height: 1080 });
    expect(screens.chosen()).toEqual({ width: 1440, height: 900 });
  });
});

describe('camera.setPlayer and the reset on activation, against a real SQLite file (specs/04-live-sync.md §2, §9)', () => {
  let h: LiveHarness;
  let live: LiveCommands;
  let screens: ScreenRegistry;
  let mapped: Scene;
  let mapless: Scene;
  let goblin: LibraryAsset;

  beforeEach(async () => {
    h = await startLive();
    live = createLiveCommands(h.data.db);
    screens = new ScreenRegistry();
    mapped = await h.scene('Camera with a map', (await h.image('camera map', 96)).id);
    mapless = await h.scene('Camera without a map');
    goblin = await h.asset('Goblin');
  });

  afterEach(async () => {
    await h.close();
  });

  const effects = (result: ReturnType<LiveCommands['apply']>): LiveEffect[] => {
    expect(Array.isArray(result), JSON.stringify(result)).toBe(true);
    return result as LiveEffect[];
  };
  const refusal = (result: ReturnType<LiveCommands['apply']>): string => (result as ErrorEnvelope).error.code;
  const memory = () => ({ camera: live.camera, screens, ruler: live.ruler, history: live.history });
  const cameras = () => ({
    dm: readSnapshot(h.data.db, 'dm', memory()).scene?.camera,
    players: readSnapshot(h.data.db, 'players', memory()).scene?.camera,
  });
  const activate = (scene: Scene) => effects(live.apply(command('scene.activate', { scene_id: scene.id })));
  const steer = (scene: Scene, camera: PlayerCamera) =>
    live.apply(command('camera.setPlayer', { scene_id: scene.id, camera }));

  it('fits a scene with a map to the whole map, and a map-less scene to its whole grid extent', () => {
    activate(mapped);
    expect(cameras()).toEqual({ dm: FIT_CAMERA, players: FIT_CAMERA });
    activate(mapless);
    expect(cameras()).toEqual({ dm: FIT_CAMERA, players: FIT_CAMERA });
    // Neither room carries a camera while nothing is live.
    effects(live.apply(command('scene.deactivate')));
    expect(cameras()).toEqual({ dm: undefined, players: undefined });
  });

  it('sets the camera of the live scene for both rooms, and tells nobody when it is already that one', () => {
    activate(mapped);
    expect(effects(steer(mapped, steered))).toEqual([{ type: 'camera' }]);
    expect(cameras()).toEqual({ dm: steered, players: steered });
    expect(effects(steer(mapped, { ...steered }))).toEqual([]);
  });

  it('is refused as scene_not_live for a scene that is not live, or with nothing live, and changes nothing', () => {
    expect(refusal(steer(mapped, steered))).toBe('scene_not_live');
    activate(mapped);
    expect(refusal(steer(mapless, steered))).toBe('scene_not_live');
    expect(refusal(steer({ ...mapless, id: id(77) }, steered))).toBe('scene_not_live');
    expect(cameras()).toEqual({ dm: FIT_CAMERA, players: FIT_CAMERA });
  });

  it('resets to fit-to-map on every activation, of another scene or of the live scene itself, and on Blank TV', () => {
    activate(mapped);
    steer(mapped, steered);
    activate(mapless);
    expect(cameras().players).toEqual(FIT_CAMERA);
    steer(mapless, steered);
    activate(mapless);
    expect(cameras().players).toEqual(FIT_CAMERA);
    steer(mapless, steered);
    effects(live.apply(command('scene.deactivate')));
    activate(mapless);
    expect(cameras().players).toEqual(FIT_CAMERA);
    // A refused activation changes nothing.
    steer(mapless, steered);
    expect(refusal(live.apply(command('scene.activate', { scene_id: id(78) })))).toBe('not_found');
    expect(cameras().players).toEqual(steered);
  });

  it('keeps the camera through the token commands and undo, and is not itself undoable', () => {
    activate(mapped);
    steer(mapped, steered);
    const [added] = effects(live.apply(command('token.add', { scene_id: mapped.id, asset_id: goblin.id, x: 1, y: 1 })));
    const token = (added as { token: { id: string } }).token;
    effects(live.apply(command('token.move', { token_id: token.id, x: 3, y: 2 })));
    effects(live.apply(command('token.setVisibility', { token_id: token.id, hidden: true })));
    expect(cameras().players).toEqual(steered);
    // Two undos take back the hide and the move; a third the add; nothing is left for the camera.
    expect(live.history.size).toBe(3);
    for (let n = 0; n < 3; n++) effects(live.apply(command('undo')));
    expect(effects(live.apply(command('undo')))).toEqual([]);
    expect(cameras().players).toEqual(steered);
  });

  it('carries the screen shape in the DM room only', () => {
    activate(mapped);
    screens.connected('tv');
    screens.report('tv', { width: 1920, height: 1080 });
    expect(readSnapshot(h.data.db, 'dm', memory()).scene?.screen).toEqual({ width: 1920, height: 1080 });
    expect(JSON.stringify(readSnapshot(h.data.db, 'players', memory()))).not.toContain('1920');
  });

  it('validates the payload strictly before anything applies', () => {
    const scene_id = id(5);
    const valid = validateCommand({ type: 'camera.setPlayer', payload: { scene_id, camera: steered } });
    expect(valid.ok).toBe(true);
    for (const payload of [
      {},
      { scene_id },
      { scene_id, camera: { ...steered, width: 0 } },
      { scene_id, camera: { ...steered, centre_x: 3 } },
      { scene_id, camera: { ...steered, height: 1e6 } },
      { scene_id, camera: { ...steered, zoom: 2 } },
      { scene_id, camera: steered, screen: { width: 10, height: 10 } },
      { scene_id, camera: { ...steered, width: Number.NaN } },
    ]) {
      const result = validateCommand({ type: 'camera.setPlayer', payload });
      expect(result.ok, JSON.stringify(payload)).toBe(false);
      if (!result.ok) expect(result.error.error.code).toBe('validation_failed');
    }
  });
});
