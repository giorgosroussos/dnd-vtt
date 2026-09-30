import { describe, expect, it } from 'vitest';
import {
  FIT_CAMERA,
  type DmSnapshot,
  type EventEnvelope,
  type Region,
  type Scene,
  type SceneToken,
} from '@emberglass/shared';
import { applyDmEvent, fromDmSnapshot, type DmScene } from './dmScene.js';

// The DM view's copy of the live scene (LIV-04, specs/04-live-sync.md §3, §5, D-109, G-018).

const scene = { id: '00000000-0000-4000-8000-000000000001', name: 'Cave' } as Scene;
const token = (id: string, z_order: number, fields: Partial<SceneToken> = {}): SceneToken => ({
  id,
  scene_id: scene.id,
  asset_id: 'a',
  label: `T${id}`,
  x: 0,
  y: 0,
  hidden: false,
  z_order,
  markers: [],
  character_id: null,
  asset: { name: 'Goblin', image_id: 'f'.repeat(64), size: 'medium', category: 'monster' },
  ...fields,
});
const snapshot = (tokens: SceneToken[]): DmSnapshot => ({
  role: 'dm',
  scene: {
    scene,
    map: null,
    tokens,
    camera: FIT_CAMERA,
    screen: null,
    ruler: null,
    history: { can_undo: false, can_redo: false },
    regions: [],
  },
});
let version = 1;
const event = (type: EventEnvelope['type'], payload: object): EventEnvelope =>
  ({ type, version: ++version, payload }) as EventEnvelope;
const ids = (value: DmScene) => value?.tokens.map((each) => each.id);

describe('the DM live scene', () => {
  it('holds a snapshot bottom of the stack first, and nothing while nothing is live', () => {
    expect(ids(fromDmSnapshot(snapshot([token('b', 5), token('a', -1), token('c', 2)])))).toEqual(['a', 'c', 'b']);
    expect(fromDmSnapshot({ role: 'dm', scene: null })).toBeNull();
  });

  it('adds, updates with the lone token renamed beside it, and removes', () => {
    let live = fromDmSnapshot(snapshot([token('a', 0, { label: 'Goblin' })]));
    live = applyDmEvent(
      live,
      event('token.added', {
        token: token('b', 1, { label: 'Goblin 2' }),
        relabelled: [token('a', 0, { label: 'Goblin 1' })],
      }),
    );
    expect(live?.tokens.map((each) => each.label)).toEqual(['Goblin 1', 'Goblin 2']);
    live = applyDmEvent(
      live,
      event('token.updated', { token: token('b', 1, { label: 'Goblin 2', x: 3, hidden: true }), relabelled: [] }),
    );
    expect(live?.tokens[1]).toMatchObject({ x: 3, hidden: true });
    live = applyDmEvent(live, event('token.removed', { id: 'a' }));
    expect(ids(live)).toEqual(['b']);
  });

  it('goes idle on scene.cleared and ignores events while idle, malformed ones and later packages’', () => {
    const live = fromDmSnapshot(snapshot([token('a', 0)]));
    expect(applyDmEvent(live, event('scene.cleared', {}))).toBeNull();
    expect(applyDmEvent(null, event('token.added', { token: token('b', 1), relabelled: [] }))).toBeNull();
    expect(applyDmEvent(live, event('token.added', {}))).toBe(live);
    expect(applyDmEvent(live, event('camera.player', {}))).toBe(live);
    // LIV-06: camera.player replaces the camera and the screen the TV frame follows.
    const camera = { centre_x: 0.2, centre_y: 0.3, width: 0.4, height: 0.5 };
    const steered = applyDmEvent(live, event('camera.player', { camera, screen: { width: 1024, height: 768 } }));
    expect(steered?.camera).toEqual(camera);
    expect(steered?.screen).toEqual({ width: 1024, height: 768 });
    expect(steered?.tokens).toBe(live?.tokens);
    expect(applyDmEvent(steered, event('camera.player', { camera: FIT_CAMERA }))?.screen).toBeNull();
    // A rename of a token this scene does not hold adds nothing.
    expect(
      ids(applyDmEvent(live, event('token.updated', { token: token('a', 0), relabelled: [token('z', 9)] }))),
    ).toEqual(['a']);
  });
});

describe('the ruler in the DM live scene (LIV-07)', () => {
  const measurement = { from: { column: 0, row: 0 }, to: { column: 2, row: 2 }, feet: 10 };

  it('follows ruler.shown and ruler.cleared, keeping the tokens, and skips a malformed event', () => {
    const live = fromDmSnapshot(snapshot([token('a', 0)]));
    expect(live?.ruler).toBeNull();
    const shown = applyDmEvent(live, event('ruler.shown', { ruler: measurement }));
    expect(shown?.ruler).toEqual(measurement);
    expect(shown?.tokens).toBe(live?.tokens);
    expect(applyDmEvent(shown, event('ruler.cleared', {}))?.ruler).toBeNull();
    expect(applyDmEvent(live, event('ruler.shown', {}))).toBe(live);
    expect(applyDmEvent(live, event('ruler.shown', { ruler: { ...measurement, feet: undefined } }))).toBe(live);
    expect(applyDmEvent(live, event('ruler.shown', { ruler: { from: measurement.from, feet: 5 } }))).toBe(live);
    expect(applyDmEvent(null, event('ruler.shown', { ruler: measurement }))).toBeNull();
  });
});

describe('the undo state (UIX-01, specs/04-live-sync.md §8)', () => {
  it('follows history.changed, skipping a malformed one', () => {
    const scene = fromDmSnapshot(snapshot([]));
    const next = applyDmEvent(scene, event('history.changed', { can_undo: true, can_redo: false }));
    expect(next?.history).toEqual({ can_undo: true, can_redo: false });
    expect(applyDmEvent(next, event('history.changed', { can_undo: 'yes' }))?.history).toEqual({
      can_undo: true,
      can_redo: false,
    });
  });
});

describe('the fog regions (TBL-03, specs/04-live-sync.md §3)', () => {
  const region = (n: number, fields: Partial<Region> = {}): Region => ({
    id: `r${n}`,
    scene_id: scene.id,
    name: `Region ${n}`,
    order: n,
    shape: { kind: 'rect', x: n, y: 0, width: 2, height: 2 },
    hidden: true,
    ...fields,
  });

  it('adds, replaces and removes regions from their events, kept in the order drawn', () => {
    let live = fromDmSnapshot(snapshot([]));
    live = applyDmEvent(live, event('region.added', { region: region(2) }));
    live = applyDmEvent(live, event('region.added', { region: region(1) }));
    expect(live?.regions.map((each) => each.id)).toEqual(['r1', 'r2']);
    live = applyDmEvent(live, event('region.updated', { region: region(2, { hidden: false, name: 'Study' }) }));
    expect(live?.regions[1]).toMatchObject({ id: 'r2', hidden: false, name: 'Study' });
    live = applyDmEvent(live, event('region.removed', { id: 'r1' }));
    expect(live?.regions.map((each) => each.id)).toEqual(['r2']);
    // A malformed event changes nothing.
    expect(applyDmEvent(live, event('region.added', {}))).toBe(live);
  });
});
