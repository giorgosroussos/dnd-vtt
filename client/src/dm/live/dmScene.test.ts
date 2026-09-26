import { describe, expect, it } from 'vitest';
import type { DmSnapshot, EventEnvelope, Scene, SceneToken } from '@emberglass/shared';
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
  character_id: null,
  asset: { name: 'Goblin', image_id: 'f'.repeat(64), size: 'medium' },
  ...fields,
});
const snapshot = (tokens: SceneToken[]): DmSnapshot => ({ role: 'dm', scene: { scene, map: null, tokens } });
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
    // A rename of a token this scene does not hold adds nothing.
    expect(
      ids(applyDmEvent(live, event('token.updated', { token: token('a', 0), relabelled: [token('z', 9)] }))),
    ).toEqual(['a']);
  });
});
