import { describe, expect, it } from 'vitest';
import type { Grid, Image } from '@emberglass/shared';
import {
  CELL_PX,
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
