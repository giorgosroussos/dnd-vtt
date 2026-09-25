import { describe, expect, it } from 'vitest';
import type { Grid } from '@emberglass/shared';
import { CELL_PX, type MapInfo } from './geometry.js';
import {
  clampToWorld,
  dropPosition,
  footprint,
  gridFrame,
  nudge,
  placePosition,
  snapStep,
  toGrid,
  toWorld,
} from './tokens.js';

// Token positions and snapping (PRP-04, specs/03-domain-model.md §4, specs/05-assets-and-images.md §2,
// specs/06-grid-and-measurement.md §2, §4, D-023, D-100), as pure arithmetic.

const GRID: Grid = {
  type: 'square',
  size: 70.4,
  offset_x: 12.5,
  offset_y: -3.25,
  visible: true,
  feet_per_square: 5,
  columns: 40,
  rows: 30,
};
// The display version is half the original.
const MAP: MapInfo = { original: { width: 4000, height: 3000 }, display: { width: 2000, height: 1500 } };

describe('the grid frame', () => {
  it('reads the calibration in original pixels times display ÷ original width', () => {
    expect(gridFrame(GRID, MAP)).toEqual({ square: 35.2, origin: { x: 6.25, y: -1.625 } });
  });

  it('reads an uncalibrated map as original width ÷ columns, as the overlay does (D-090)', () => {
    expect(gridFrame({ ...GRID, size: null, offset_x: 0, offset_y: 0 }, MAP)).toEqual({
      square: 50,
      origin: { x: 0, y: 0 },
    });
  });

  it('gives a map-less scene CELL_PX squares from 0', () => {
    expect(gridFrame(GRID, undefined)).toEqual({ square: CELL_PX, origin: { x: 0, y: 0 } });
  });

  it('converts grid units to world pixels and back', () => {
    const frame = gridFrame(GRID, MAP);
    expect(toWorld(frame, { x: 2, y: 3 })).toEqual({ x: 6.25 + 2 * 35.2, y: -1.625 + 3 * 35.2 });
    const back = toGrid(frame, toWorld(frame, { x: 2.5, y: -1.25 }));
    expect(back.x).toBeCloseTo(2.5, 12);
    expect(back.y).toBeCloseTo(-1.25, 12);
  });

  it('moves a stored position with the grid when the calibration changes, never storing pixels (specs/03-domain-model.md §4)', () => {
    const at = { x: 4, y: 2 };
    const before = toWorld(gridFrame(GRID, MAP), at);
    const after = toWorld(gridFrame({ ...GRID, size: 80, offset_x: 0 }, MAP), at);
    expect(after).toEqual({ x: 160, y: -1.625 + 80 });
    expect(after).not.toEqual(before);
  });
});

describe('footprints and snapping (specs/05-assets-and-images.md §2, specs/06-grid-and-measurement.md §4)', () => {
  it('covers the squares of each size', () => {
    expect(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'].map((size) => footprint(size as never))).toEqual([
      0.5, 1, 1, 2, 3, 4,
    ]);
  });

  it('snaps a footprint to whole squares, Tiny to half squares', () => {
    expect(snapStep('tiny')).toBe(0.5);
    expect(snapStep('large')).toBe(1);
    expect(dropPosition({ x: 2.4, y: 3.6 }, 'medium', false)).toEqual({ x: 2, y: 4 });
    expect(dropPosition({ x: 2.4, y: 3.6 }, 'large', false)).toEqual({ x: 2, y: 4 });
    expect(dropPosition({ x: 2.4, y: 3.6 }, 'tiny', false)).toEqual({ x: 2.5, y: 3.5 });
    expect(dropPosition({ x: -0.2, y: -2.74 }, 'tiny', false)).toEqual({ x: 0, y: -2.5 });
    expect(Object.is(dropPosition({ x: -0.2, y: 0 }, 'medium', false).x, 0)).toBe(true);
  });

  it('keeps a free position with Alt, to a thousandth of a square', () => {
    expect(dropPosition({ x: 2.4, y: 3.6 }, 'medium', true)).toEqual({ x: 2.4, y: 3.6 });
    expect(dropPosition({ x: 0.1 + 0.2, y: 2.00049 }, 'large', true)).toEqual({ x: 0.3, y: 2 });
  });

  it('places a token centred on the point clicked, then snaps it', () => {
    const frame = gridFrame(GRID, MAP);
    const click = toWorld(frame, { x: 5.3, y: 7.9 });
    expect(placePosition(frame, click, 'medium', false)).toEqual({ x: 5, y: 7 });
    // A Large token centred on the click covers the four squares around it.
    expect(placePosition(frame, click, 'large', false)).toEqual({ x: 4, y: 7 });
    expect(placePosition(frame, click, 'tiny', false)).toEqual({ x: 5, y: 7.5 });
    const free = placePosition(frame, click, 'medium', true);
    expect(free.x).toBeCloseTo(4.8, 3);
    expect(free.y).toBeCloseTo(7.4, 3);
  });

  it('moves by keyboard a whole step from the grid, snapping a free token first', () => {
    expect(nudge({ x: 2, y: 3 }, 'medium', 1, 0)).toEqual({ x: 3, y: 3 });
    expect(nudge({ x: 2.3, y: 3 }, 'large', 0, -1)).toEqual({ x: 2, y: 2 });
    expect(nudge({ x: 1, y: 1 }, 'tiny', -1, 1)).toEqual({ x: 0.5, y: 1.5 });
  });
});

describe('keeping a placement on the map (review)', () => {
  const frame = gridFrame(GRID, MAP);
  const world = MAP.display;

  it('moves a snapped footprint to the nearest whole squares inside the map', () => {
    // The first whole square inside is 0 (the grid starts 6.25 px in); the last one a Large token
    // fits in ends before 2,000 px: (2000 − 6.25) ÷ 35.2 − 2 ≈ 54.6, so 54.
    expect(clampToWorld(frame, world, { x: -3, y: 2 }, 'medium', true)).toEqual({ x: 0, y: 2 });
    expect(clampToWorld(frame, world, { x: 90, y: 90 }, 'large', true)).toEqual({ x: 54, y: 40 });
    expect(clampToWorld(frame, world, { x: 3, y: 4 }, 'medium', true)).toEqual({ x: 3, y: 4 });
  });

  it('keeps a free footprint inside the map exactly', () => {
    const at = clampToWorld(frame, world, { x: -3, y: 2.5 }, 'medium', false);
    expect(at.x).toBeCloseTo(-6.25 / 35.2, 9);
    expect(at.y).toBe(2.5);
  });

  it('keeps a map-less scene to its extent', () => {
    const bare = gridFrame(GRID, undefined);
    expect(clampToWorld(bare, { width: 40 * CELL_PX, height: 30 * CELL_PX }, { x: 45, y: -1 }, 'huge', true)).toEqual({
      x: 37,
      y: 0,
    });
  });
});
