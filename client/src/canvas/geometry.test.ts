import { describe, expect, it } from 'vitest';
import { CAMERA_BOUNDS, FIT_CAMERA, type Grid, type Image } from '@emberglass/shared';
import {
  CELL_PX,
  DEFAULT_ASPECT,
  frameForKey,
  frameOf,
  rectOf,
  resizeBox,
  scaleBox,
  screenAspect,
  viewOf,
  MAX_LINES_PER_AXIS,
  MAX_SCALE,
  MIN_SCALE,
  cameraForKey,
  fitCamera,
  gridLines,
  mapInfo,
  squareSize,
  worldSize,
  zoomAt,
} from './geometry.js';

// The canvas geometry (PRP-02, specs/06-grid-and-measurement.md §2, specs/03-domain-model.md §6,
// specs/04-live-sync.md §9, D-090).

const GRID: Grid = {
  type: 'square',
  size: null,
  offset_x: 0,
  offset_y: 0,
  visible: true,
  feet_per_square: 5,
  columns: 30,
  rows: 20,
};

// A 4,000 × 3,000 original shown at half size.
const MAP = { original: { width: 4000, height: 3000 }, display: { width: 2000, height: 1500 } };

describe('grid lines from original-image dimensions (specs/06-grid-and-measurement.md §2)', () => {
  it('multiplies size and offsets by display ÷ original width, never reading them as display pixels', () => {
    const lines = gridLines({ ...GRID, size: 100, offset_x: 30, offset_y: 250 }, MAP);
    // 100 original px is 50 display px; offsets 30 and 250 become 15 and 125, taken modulo 50.
    expect(lines.xs.slice(0, 3)).toEqual([15, 65, 115]);
    expect(lines.ys.slice(0, 3)).toEqual([25, 75, 125]);
    expect(lines.xs).toHaveLength(40);
    expect(lines.ys).toHaveLength(30);
    expect(lines.xs.at(-1)).toBe(1965);
  });

  it('keeps a decimal square size exact, without drifting at the far edge', () => {
    const lines = gridLines(
      { ...GRID, size: 70.4 },
      { original: { width: 2816, height: 1408 }, display: { width: 1408, height: 704 } },
    );
    expect(lines.xs).toHaveLength(41);
    expect(lines.xs.at(-1)).toBeCloseTo(1408, 6);
  });

  it('wraps a negative offset into the first square', () => {
    expect(gridLines({ ...GRID, size: 100, offset_x: -30 }, MAP).xs[0]).toBeCloseTo(35, 9);
  });

  it('reads the stored columns as the width in squares while the map is not calibrated (D-090)', () => {
    expect(squareSize(GRID, MAP)).toBeCloseTo(4000 / 30, 9);
    const lines = gridLines(GRID, MAP);
    expect(lines.xs).toHaveLength(31);
    expect(lines.xs[1]).toBeCloseTo(2000 / 30, 9);
  });

  it('draws a map-less scene as its columns × rows extent, 30 × 20 by default (specs/03-domain-model.md §6)', () => {
    expect(worldSize(GRID, undefined)).toEqual({ width: 30 * CELL_PX, height: 20 * CELL_PX });
    const lines = gridLines(GRID, undefined);
    expect(lines.xs).toEqual(Array.from({ length: 31 }, (_, n) => n * CELL_PX));
    expect(lines.ys).toEqual(Array.from({ length: 21 }, (_, n) => n * CELL_PX));
    expect(gridLines({ ...GRID, columns: 12, rows: 9 }, undefined).ys).toHaveLength(10);
  });

  it('draws no lines for a grid finer than the canvas can show line by line', () => {
    const size = 4000 / (MAX_LINES_PER_AXIS + 1);
    expect(gridLines({ ...GRID, size }, MAP).xs).toEqual([]);
    expect(gridLines({ ...GRID, size: 0.001 }, MAP)).toEqual({ xs: [], ys: [] });
  });

  it('takes the display size from the image record, or from the loaded display version for a record without one', () => {
    const image: Image = {
      id: 'a'.repeat(64),
      mime: 'image/png',
      width: 4000,
      height: 3000,
      variants: { display: { width: 2000, height: 1500 } },
      grid_preset: null,
    };
    expect(mapInfo(image)).toEqual(MAP);
    const old = { ...image, variants: {} };
    expect(mapInfo(old)).toBeUndefined();
    expect(mapInfo(old, { width: 0, height: 0 })).toBeUndefined();
    expect(mapInfo(old, { width: 1000, height: 750 })?.display).toEqual({ width: 1000, height: 750 });
  });
});

describe('the camera (specs/08-ux-journeys.md §3, specs/04-live-sync.md §9)', () => {
  const viewport = { width: 800, height: 600 };
  const world = { width: 2000, height: 1000 };

  it('fits the whole world, centred', () => {
    expect(fitCamera(world, viewport)).toEqual({ x: 0, y: 100, scale: 0.4 });
    expect(fitCamera(world, { width: 0, height: 0 })).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it('zooms about a point, keeping the world point under it in place, within bounds', () => {
    const camera = { x: 10, y: 20, scale: 0.5 };
    const at = { x: 300, y: 200 };
    const worldAt = { x: (at.x - camera.x) / camera.scale, y: (at.y - camera.y) / camera.scale };
    const zoomed = zoomAt(camera, 2, at);
    expect(zoomed.scale).toBe(1);
    expect(worldAt.x * zoomed.scale + zoomed.x).toBeCloseTo(at.x, 9);
    expect(worldAt.y * zoomed.scale + zoomed.y).toBeCloseTo(at.y, 9);
    expect(zoomAt(camera, 1000, at).scale).toBe(MAX_SCALE);
    expect(zoomAt(camera, 1e-6, at).scale).toBe(MIN_SCALE);
  });

  it('zooms with + and −, pans with the arrow keys (further with Shift) and fits with 0', () => {
    const camera = fitCamera(world, viewport);
    expect(cameraForKey(camera, '+', false, world, viewport)!.scale).toBeGreaterThan(camera.scale);
    expect(cameraForKey(camera, '=', false, world, viewport)!.scale).toBeGreaterThan(camera.scale);
    expect(cameraForKey(camera, '-', false, world, viewport)!.scale).toBeLessThan(camera.scale);
    expect(cameraForKey(camera, 'ArrowRight', false, world, viewport)!.x).toBeLessThan(camera.x);
    expect(cameraForKey(camera, 'ArrowLeft', false, world, viewport)!.x).toBeGreaterThan(camera.x);
    expect(cameraForKey(camera, 'ArrowDown', false, world, viewport)!.y).toBeLessThan(camera.y);
    expect(cameraForKey(camera, 'ArrowUp', false, world, viewport)!.y).toBeGreaterThan(camera.y);
    const step = camera.x - cameraForKey(camera, 'ArrowRight', false, world, viewport)!.x;
    expect(camera.x - cameraForKey(camera, 'ArrowRight', true, world, viewport)!.x).toBe(step * 4);
    const moved = { x: -500, y: 40, scale: 3 };
    expect(cameraForKey(moved, '0', false, world, viewport)).toEqual(camera);
    expect(cameraForKey(camera, 'a', false, world, viewport)).toBeUndefined();
  });
});

describe('the player camera (LIV-06, specs/04-live-sync.md §9, Q-038, D-119)', () => {
  const mapWorld = { width: 2000, height: 1500 };
  const maplessWorld = worldSize(GRID, undefined);
  const tv = { width: 1920, height: 1080 };

  it('draws the fitted camera exactly as fit-to-map, for a scene with a map and for a map-less scene', () => {
    for (const world of [mapWorld, maplessWorld]) {
      for (const viewport of [tv, { width: 1024, height: 768 }, { width: 600, height: 1000 }]) {
        const view = viewOf(FIT_CAMERA, world, viewport);
        const fit = fitCamera(world, viewport);
        expect(view.scale).toBeCloseTo(fit.scale, 9);
        expect(view.x).toBeCloseTo(fit.x, 6);
        expect(view.y).toBeCloseTo(fit.y, 6);
      }
    }
  });

  it('shows the whole rectangle on any screen, centred, as large as it fits', () => {
    const rect = { centre_x: 0.25, centre_y: 0.5, width: 0.4, height: 0.3 };
    for (const viewport of [tv, { width: 800, height: 800 }]) {
      const view = viewOf(rect, mapWorld, viewport);
      // The rectangle's centre is the screen's centre.
      expect(view.x + 0.25 * 2000 * view.scale).toBeCloseTo(viewport.width / 2, 6);
      expect(view.y + 0.5 * 1500 * view.scale).toBeCloseTo(viewport.height / 2, 6);
      // It fits on both axes and fills one.
      const [w, h] = [800 * view.scale, 450 * view.scale];
      expect(w).toBeLessThanOrEqual(viewport.width + 1e-6);
      expect(h).toBeLessThanOrEqual(viewport.height + 1e-6);
      expect(Math.max(w / viewport.width, h / viewport.height)).toBeCloseTo(1, 9);
    }
    // A rectangle past the zoom limits is shown at the limit.
    expect(viewOf({ ...rect, width: 1e-3, height: 1e-3 }, mapWorld, tv).scale).toBe(MAX_SCALE);
  });

  it('widens the camera to the TV’s shape for the frame, and a frame of that shape is its own camera', () => {
    const frame = frameOf(FIT_CAMERA, mapWorld, 16 / 9);
    expect(frame.height).toBe(1500);
    expect(frame.width).toBeCloseTo(1500 * (16 / 9), 9);
    expect(frame.x + frame.width / 2).toBeCloseTo(1000, 9);
    const tall = frameOf(FIT_CAMERA, mapWorld, 1);
    expect(tall).toEqual({ x: 0, y: -250, width: 2000, height: 2000 });
    const back = rectOf(frame, mapWorld);
    expect(frameOf(back, mapWorld, 16 / 9).width).toBeCloseTo(frame.width, 3);
    expect(back.centre_x).toBe(0.5);
  });

  it('keeps the camera within the contract’s bounds: the centre on the world, the size within reason', () => {
    const off = rectOf({ x: 5000, y: -9000, width: 1, height: 10 }, mapWorld);
    expect(off.centre_x).toBe(1);
    expect(off.centre_y).toBe(0);
    expect(off.width).toBe(CAMERA_BOUNDS.minSize);
    expect(rectOf({ x: 0, y: 0, width: 10, height: 1e9 }, mapWorld).height).toBe(CAMERA_BOUNDS.maxSize);
    expect(rectOf({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 0 })).toEqual(FIT_CAMERA);
  });

  it('resizes from a corner keeping the TV’s shape and the opposite corner, never below a minimum', () => {
    const anchor = { x: 100, y: 100 };
    const box = resizeBox(anchor, { x: 900, y: 300 }, 16 / 9, mapWorld);
    expect(box).toMatchObject({ x: 100, y: 100, width: 800 });
    expect(box.height).toBeCloseTo(450, 9);
    const up = resizeBox(anchor, { x: 0, y: -500 }, 16 / 9, mapWorld);
    expect(up.x + up.width).toBeCloseTo(100, 9);
    expect(up.y + up.height).toBeCloseTo(100, 9);
    expect(up.width).toBeCloseTo(600 * (16 / 9), 9);
    expect(resizeBox(anchor, anchor, 16 / 9, mapWorld).width).toBe(100);
  });

  it('moves and zooms the frame by key, and 0 fits the TV to the map', () => {
    const box = { x: 0, y: 0, width: 800, height: 400 };
    expect(frameForKey(box, 'ArrowRight', false)).toEqual({ ...box, x: 50 });
    expect(frameForKey(box, 'ArrowUp', true)).toEqual({ ...box, y: -200 });
    expect(frameForKey(box, '+', false)).toEqual(scaleBox(box, 1 / 1.25));
    expect(frameForKey(box, '-', false)).toEqual(scaleBox(box, 1.25));
    expect(frameForKey(box, '0', false)).toBe('fit');
    expect(frameForKey(box, 'x', false)).toBeUndefined();
    expect(scaleBox(box, 2)).toEqual({ x: -400, y: -200, width: 1600, height: 800 });
  });

  it('takes the TV’s shape from the screen reported, 16:9 without one, within reason', () => {
    expect(screenAspect(null)).toBe(DEFAULT_ASPECT);
    expect(DEFAULT_ASPECT).toBe(16 / 9);
    expect(screenAspect({ width: 1024, height: 768 })).toBeCloseTo(4 / 3, 9);
    expect(screenAspect({ width: 10_000, height: 10 })).toBe(4);
    expect(screenAspect({ width: 10, height: 10_000 })).toBe(0.25);
  });
});
