import { describe, expect, it } from 'vitest';
import { bounded, compose, isIdentity, pan, pinch, TOUCH_IDENTITY, TOUCH_MAX_ZOOM } from './touchView.js';

// A handheld's own view over the DM's camera (UXR-05, specs/08-ux-journeys.md §14, Q-125).

const camera = { x: 100, y: 50, scale: 0.5 };
const world = { width: 2000, height: 1000 };
const viewport = { width: 1200, height: 600 };

describe('the touch view', () => {
  it('is the DM camera itself at the identity', () => {
    expect(compose(camera, TOUCH_IDENTITY)).toEqual(camera);
    expect(isIdentity(TOUCH_IDENTITY)).toBe(true);
  });

  it('pinches around its focus: the world point under the fingers stays under them', () => {
    const focus = { x: 400, y: 300 };
    const view = pinch(TOUCH_IDENTITY, focus, 2, 0.5, TOUCH_MAX_ZOOM);
    const before = compose(camera, TOUCH_IDENTITY);
    const after = compose(camera, view);
    const worldAt = (cam: typeof camera) => ({ x: (focus.x - cam.x) / cam.scale, y: (focus.y - cam.y) / cam.scale });
    expect(worldAt(after).x).toBeCloseTo(worldAt(before).x, 9);
    expect(worldAt(after).y).toBeCloseTo(worldAt(before).y, 9);
    expect(after.scale).toBe(1);
  });

  it('bounds the zoom between the whole map and eight times the DM camera', () => {
    expect(pinch(TOUCH_IDENTITY, { x: 0, y: 0 }, 100, 0.5, TOUCH_MAX_ZOOM).zoom).toBe(8);
    expect(pinch(TOUCH_IDENTITY, { x: 0, y: 0 }, 0.01, 0.5, TOUCH_MAX_ZOOM).zoom).toBe(0.5);
    expect(bounded({ zoom: 20, x: 0, y: 0 }, camera, world, viewport, 0.5).zoom).toBe(8);
  });

  it('keeps the screen centre over the map, however far a drag goes', () => {
    const far = bounded(pan(TOUCH_IDENTITY, 5000, -5000), camera, world, viewport, 0.5);
    const drawn = compose(camera, far);
    expect(drawn.x).toBeCloseTo(viewport.width / 2, 6);
    expect(drawn.y + world.height * drawn.scale).toBeCloseTo(viewport.height / 2, 6);
  });

  it('is the identity again once back at the DM camera', () => {
    expect(bounded({ zoom: 1, x: 0.2, y: -0.1 }, camera, world, viewport, 0.5)).toBe(TOUCH_IDENTITY);
  });
});
