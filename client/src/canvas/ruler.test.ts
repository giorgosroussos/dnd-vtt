import { describe, expect, it } from 'vitest';
import type { Grid } from '@emberglass/shared';
import { CELL_PX } from './geometry.js';
import { labelOffset, rulerForKey, samePath, squareAt, squareCentre } from './ruler.js';
import { gridFrame } from './tokens.js';

// The ruler's geometry (LIV-07, specs/06-grid-and-measurement.md §5, Q-048): the end points taken at
// square centres, on a calibrated map and on a map-less scene.

const GRID: Grid = {
  type: 'square',
  size: 100,
  offset_x: 30,
  offset_y: 250,
  visible: true,
  feet_per_square: 5,
  columns: 40,
  rows: 30,
};
// The display version is half the original, so a square is 50 world pixels from (15, 125).
const MAP = { original: { width: 4000, height: 3000 }, display: { width: 2000, height: 1500 } };
const frame = gridFrame(GRID, MAP);

describe('squares and their centres (Q-048)', () => {
  it('takes the square a point lies in, from the grid’s origin, and draws from its centre', () => {
    expect(squareAt(frame, { x: 15, y: 125 })).toEqual({ column: 0, row: 0 });
    expect(squareAt(frame, { x: 64.9, y: 174.9 })).toEqual({ column: 0, row: 0 });
    expect(squareAt(frame, { x: 140, y: 300 })).toEqual({ column: 2, row: 3 });
    expect(squareCentre(frame, { column: 2, row: 3 })).toEqual({ x: 140, y: 300 });
    expect(squareCentre(frame, { column: 0, row: 0 })).toEqual({ x: 40, y: 150 });
    // Every point of a square measures from the same centre.
    for (const point of [
      { x: 115, y: 275 },
      { x: 164.99, y: 324.99 },
      { x: 140, y: 300 },
    ]) {
      expect(squareCentre(frame, squareAt(frame, point))).toEqual({ x: 140, y: 300 });
    }
  });

  it('names a square before the first grid line with a negative index, never -0', () => {
    const square = squareAt(frame, { x: 5, y: 100 });
    expect(square).toEqual({ column: -1, row: -1 });
    expect(Object.is(squareAt(frame, { x: 15, y: 125 }).column, 0)).toBe(true);
    expect(squareCentre(frame, square)).toEqual({ x: -10, y: 100 });
  });

  it('uses the map-less scene’s own squares', () => {
    const plain = gridFrame({ ...GRID, size: null, offset_x: 0, offset_y: 0 }, undefined);
    expect(squareAt(plain, { x: CELL_PX * 3.2, y: CELL_PX * 0.9 })).toEqual({ column: 3, row: 0 });
    expect(squareCentre(plain, { column: 3, row: 0 })).toEqual({ x: CELL_PX * 3.5, y: CELL_PX * 0.5 });
  });
});

describe('the keyboard ruler (specs/08-ux-journeys.md §8)', () => {
  const start = { column: 5, row: 5 };
  const path = { from: { column: 1, row: 1 }, to: { column: 3, row: 2 } };

  it('starts at the given square and moves the end a square per arrow', () => {
    expect(rulerForKey(null, 'ArrowRight', false, start)).toEqual({ from: start, to: { column: 6, row: 5 } });
    expect(rulerForKey(path, 'ArrowLeft', false, start)).toEqual({ from: path.from, to: { column: 2, row: 2 } });
    expect(rulerForKey(path, 'ArrowUp', false, start)).toEqual({ from: path.from, to: { column: 3, row: 1 } });
    expect(rulerForKey(path, 'ArrowDown', false, start)).toEqual({ from: path.from, to: { column: 3, row: 3 } });
  });

  it('moves the whole ruler with Shift, and ignores other keys', () => {
    expect(rulerForKey(path, 'ArrowRight', true, start)).toEqual({
      from: { column: 2, row: 1 },
      to: { column: 4, row: 2 },
    });
    expect(rulerForKey(path, 'Enter', false, start)).toBeUndefined();
    expect(rulerForKey(path, '+', false, start)).toBeUndefined();
  });

  it('compares paths by their squares', () => {
    expect(samePath(path, structuredClone(path))).toBe(true);
    expect(samePath(path, { ...path, to: { column: 3, row: 3 } })).toBe(false);
    expect(samePath(null, null)).toBe(true);
    expect(samePath(path, null)).toBe(false);
  });
});

describe('where the distance label goes (LIV-07 review U-M3)', () => {
  const label = { width: 100, height: 48 };
  const view = { width: 1280, height: 720 };
  const gap = { x: 18, y: 8 };

  it('sits above and to the right of the end, in screen pixels', () => {
    expect(labelOffset({ x: 400, y: 300 }, label, view, gap)).toEqual({ offsetX: -18, offsetY: 56 });
  });

  it('flips below near the top and to the left near the right edge, so it stays on the screen', () => {
    expect(labelOffset({ x: 400, y: 30 }, label, view, gap)).toEqual({ offsetX: -18, offsetY: -8 });
    expect(labelOffset({ x: 1200, y: 300 }, label, view, gap)).toEqual({ offsetX: 118, offsetY: 56 });
    expect(labelOffset({ x: 1250, y: 10 }, label, view, gap)).toEqual({ offsetX: 118, offsetY: -8 });
  });
});
