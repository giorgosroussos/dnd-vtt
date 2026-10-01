import { describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import {
  applyStroke,
  EMPTY_FOG,
  fillFog,
  fogExtent,
  FogMaskSchema,
  FogStrokeSchema,
  FogWriteBodySchema,
  FOG_STROKE_MAX_WORK,
  fogRuns,
  inFog,
  isFogMask,
  sameFog,
  seenByPlayers,
  strokeCells,
  strokeWork,
  tokenCentre,
  type FogExtent,
  type FogMask,
  type FogStroke,
  type Grid,
} from './index.js';

// The painted fog's rule (TBL-04, specs/04-live-sync.md §4, §13, Q-101): cells of a quarter square, painted
// and erased by a round brush; a token is seen by players when it is not hidden and its centre is under no
// fogged cell, a centre on a cell's edge counting as under each cell it touches.

const extent: FogExtent = { x0: 0, y0: 0, x1: 40, y1: 40 };
const paint = (points: { x: number; y: number }[], radius = 1): FogStroke => ({ mode: 'paint', radius, points });
const erase = (points: { x: number; y: number }[], radius = 1): FogStroke => ({ mode: 'erase', radius, points });
const cellCentre = (cx: number, cy: number) => ({ x: (cx + 0.5) / 4, y: (cy + 0.5) / 4 });

describe('a stroke of the brush', () => {
  it('covers the cells whose centre is within its radius, the radius itself included', () => {
    // A dab at (5, 5) with a radius of a quarter square: the four cells around the point have centres an
    // eighth of a square off each way, about 0.18 away, so they are covered; the next ring is not.
    const rows = strokeCells(paint([{ x: 5, y: 5 }], 0.25), extent);
    expect([...rows.entries()]).toEqual([
      [19, [19, 21]],
      [20, [19, 21]],
    ]);
    // A cell centre exactly at the radius counts: centre (5.125, 5.125) from (5.125, 4.625) is 0.5 away.
    const exact = strokeCells(paint([{ x: 5.125, y: 4.625 }], 0.5), extent);
    expect(exact.get(20)).toEqual([20, 21]);
    // And one a hair beyond does not.
    const beyond = strokeCells(paint([{ x: 5.125, y: 4.624 }], 0.5), extent);
    expect(beyond.get(20)).toBeUndefined();
  });

  it('covers every cell along a slanted line, as a capsule', () => {
    const stroke = paint([
      { x: 1, y: 1 },
      { x: 6, y: 4 },
    ]);
    const rows = strokeCells(stroke, extent);
    for (const [cy, runs] of rows) {
      for (let i = 0; i < runs.length; i += 2) {
        for (let cx = runs[i]!; cx < runs[i + 1]!; cx++) {
          const centre = cellCentre(cx, cy);
          // Distance to the segment, worked out here independently.
          const [ax, ay, bx, by] = [1, 1, 6, 4];
          const t = Math.max(0, Math.min(1, ((centre.x - ax) * (bx - ax) + (centre.y - ay) * (by - ay)) / 34));
          const d = Math.hypot(centre.x - (ax + t * (bx - ax)), centre.y - (ay + t * (by - ay)));
          expect(d, JSON.stringify([cx, cy])).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    }
    // A cell far off the line but inside its bounding box is not covered.
    expect(inFog({ x: 5.5, y: 1.2 }, applyStroke(EMPTY_FOG, stroke, extent))).toBe(false);
    expect(inFog({ x: 3.5, y: 2.5 }, applyStroke(EMPTY_FOG, stroke, extent))).toBe(true);
  });

  it('is clipped to the map’s extent', () => {
    const mask = applyStroke(EMPTY_FOG, paint([{ x: 0, y: 0 }], 2), extent);
    expect(mask.every((row) => row.y >= 0 && row.runs[0]! >= 0)).toBe(true);
    expect(mask[0]).toEqual({ y: 0, runs: [0, 8] });
    expect(applyStroke(EMPTY_FOG, paint([{ x: -50, y: -50 }]), extent)).toEqual([]);
  });

  it('paints, then erases, merging the runs it leaves', () => {
    const line = paint(
      [
        { x: 1, y: 2 },
        { x: 9, y: 2 },
      ],
      0.25,
    );
    let mask = applyStroke(EMPTY_FOG, line, extent);
    expect(mask).toEqual([
      { y: 7, runs: [3, 37] },
      { y: 8, runs: [3, 37] },
    ]);
    // Erase a hole in the middle: two runs per row.
    mask = applyStroke(mask, erase([{ x: 5, y: 2 }], 0.5), extent);
    expect(mask.map((row) => row.runs.length)).toEqual([4, 4]);
    expect(inFog({ x: 5, y: 2 }, mask)).toBe(false);
    expect(inFog({ x: 2, y: 2 }, mask)).toBe(true);
    // Paint it again: one run per row, exactly as before.
    mask = applyStroke(mask, paint([{ x: 5, y: 2 }], 0.5), extent);
    expect(isFogMask(mask)).toBe(true);
    expect(mask.every((row) => row.runs.length === 2)).toBe(true);
    // Erasing everything leaves no row at all.
    const cleared = applyStroke(mask, erase([{ x: 5, y: 2 }], 5), extent);
    expect(cleared).toEqual([]);
  });

  it('answers the same mask when it changes nothing', () => {
    const mask = applyStroke(EMPTY_FOG, paint([{ x: 5, y: 5 }]), extent);
    expect(sameFog(applyStroke(mask, paint([{ x: 5, y: 5 }]), extent), mask)).toBe(true);
    expect(sameFog(applyStroke(mask, erase([{ x: 30, y: 30 }]), extent), mask)).toBe(true);
    expect(sameFog(mask, EMPTY_FOG)).toBe(false);
  });
});

describe('what a stroke costs (TBL-04 review)', () => {
  it('counts the rows each segment crosses, so a stroke drawn by hand is cheap and a zigzag across the map is not', () => {
    // A dab of radius 1: 8 rows and one more.
    expect(strokeWork(paint([{ x: 5, y: 5 }]))).toBe(9);
    const byHand = paint(
      Array.from({ length: 1000 }, (_, i) => ({ x: i * 0.25, y: 10 + Math.sin(i / 20) })),
      1,
    );
    expect(strokeWork(byHand)).toBeLessThan(FOG_STROKE_MAX_WORK / 10);
    const zigzag = paint(
      Array.from({ length: 1000 }, (_, i) => ({ x: i * 2, y: i % 2 === 0 ? 0 : 2000 })),
      0.25,
    );
    expect(strokeWork(zigzag)).toBeGreaterThan(FOG_STROKE_MAX_WORK);
  });

  it('erases many runs in one pass, leaving the runs between the cuts', () => {
    const wide: FogExtent = { x0: 0, y0: 0, x1: 4000, y1: 4 };
    let mask = applyStroke(
      EMPTY_FOG,
      paint(
        [
          { x: 0, y: 0.5 },
          { x: 999, y: 0.5 },
        ],
        0.25,
      ),
      wide,
    );
    for (let x = 1; x < 999; x += 2) mask = applyStroke(mask, erase([{ x: x + 0.5, y: 0.5 }], 0.25), wide);
    expect(isFogMask(mask)).toBe(true);
    expect(fogRuns(mask)).toBeGreaterThan(900);
    expect(inFog({ x: 1.5, y: 0.5 }, mask)).toBe(false);
    expect(inFog({ x: 2.5, y: 0.5 }, mask)).toBe(true);
  });
});

describe('inFog and seenByPlayers', () => {
  const mask: FogMask = [{ y: 8, runs: [8, 12] }]; // grid (2, 2) to (3, 2.25)

  it('takes a point inside a fogged cell, and one on the edge of one, as under the fog', () => {
    expect(inFog({ x: 2.5, y: 2.1 }, mask)).toBe(true);
    // On the cells' left edge, top edge and outer corner.
    expect(inFog({ x: 2, y: 2.1 }, mask)).toBe(true);
    expect(inFog({ x: 2.5, y: 2 }, mask)).toBe(true);
    expect(inFog({ x: 3, y: 2.25 }, mask)).toBe(true);
    // Just past them.
    expect(inFog({ x: 1.99, y: 2.1 }, mask)).toBe(false);
    expect(inFog({ x: 2.5, y: 2.26 }, mask)).toBe(false);
    expect(inFog({ x: 2.5, y: 1.99 }, mask)).toBe(false);
    expect(inFog({ x: 0, y: 0 }, EMPTY_FOG)).toBe(false);
  });

  it('judges a token by its centre, and a hidden token is never seen', () => {
    // A medium token at (1.5, 1.5) has its centre at (2, 2): the corner of the fogged cells.
    expect(tokenCentre({ x: 1.5, y: 1.5 }, 'medium')).toEqual({ x: 2, y: 2 });
    expect(seenByPlayers({ x: 1.5, y: 1.5, hidden: false }, 'medium', mask)).toBe(false);
    expect(seenByPlayers({ x: 0, y: 0, hidden: false }, 'medium', mask)).toBe(true);
    expect(seenByPlayers({ x: 0, y: 0, hidden: true }, 'medium', EMPTY_FOG)).toBe(false);
    // A large token at (1, 1) has its centre at (2, 2) as well.
    expect(seenByPlayers({ x: 1, y: 1, hidden: false }, 'large', mask)).toBe(false);
  });
});

describe('fogExtent and fillFog', () => {
  const grid: Grid = {
    type: 'square',
    size: 100,
    offset_x: 50,
    offset_y: 0,
    visible: true,
    feet_per_square: 5,
    columns: 10,
    rows: 8,
  };

  it('covers a map’s whole image, offsets included, in cells', () => {
    // 1000 by 800 pixels, squares of 100 from x = 50: from -0.5 squares to 9.5 across, 0 to 8 down.
    expect(fogExtent(grid, { width: 1000, height: 800 })).toEqual({ x0: -2, y0: 0, x1: 38, y1: 32 });
    // Before calibration the square is the width over the columns.
    expect(fogExtent({ ...grid, size: null, offset_x: 0 }, { width: 1000, height: 800 })).toEqual({
      x0: 0,
      y0: 0,
      x1: 40,
      y1: 32,
    });
  });

  it('covers a scene without a map by its columns and rows, at most 2000 squares each way', () => {
    expect(fogExtent(grid, null)).toEqual({ x0: 0, y0: 0, x1: 40, y1: 32 });
    expect(fogExtent({ ...grid, columns: 100_000 }, null).x1).toBe(8000);
  });

  it('stays within the cell indices a mask may hold, whatever the offsets (TBL-04 review)', () => {
    const far = fogExtent({ ...grid, size: 2, offset_x: 1e6, offset_y: -1e6 }, { width: 1000, height: 800 });
    for (const value of [far.x0, far.y0, far.x1, far.y1]) expect(Math.abs(value)).toBeLessThanOrEqual(32_000);
    expect(Value.Check(FogMaskSchema, fillFog({ ...far, y1: Math.min(far.y1, far.y0 + 2) }))).toBe(true);
  });

  it('fills every row of the extent with one run', () => {
    const mask = fillFog({ x0: -2, y0: 0, x1: 6, y1: 3 });
    expect(mask).toEqual([
      { y: 0, runs: [-2, 6] },
      { y: 1, runs: [-2, 6] },
      { y: 2, runs: [-2, 6] },
    ]);
    expect(inFog({ x: 1, y: 0.5 }, mask)).toBe(true);
    expect(inFog({ x: 1, y: 1 }, mask)).toBe(false);
  });
});

describe('the fog contract', () => {
  it('takes a stroke of 1 to 1000 points, its radius from a quarter square to five in quarter steps', () => {
    expect(Value.Check(FogStrokeSchema, paint([{ x: 1, y: 1 }], 0.25))).toBe(true);
    expect(Value.Check(FogStrokeSchema, paint([{ x: 1, y: 1 }], 5))).toBe(true);
    for (const radius of [0, 0.1, 5.25, 1.3]) {
      expect(Value.Check(FogStrokeSchema, paint([{ x: 1, y: 1 }], radius)), String(radius)).toBe(false);
    }
    expect(Value.Check(FogStrokeSchema, paint([]))).toBe(false);
    expect(Value.Check(FogStrokeSchema, paint(Array.from({ length: 1001 }, () => ({ x: 0, y: 0 }))))).toBe(false);
    expect(Value.Check(FogStrokeSchema, { ...paint([{ x: 1, y: 1 }]), mode: 'fog' })).toBe(false);
  });

  it('writes in preparation by a stroke or by filling, nothing else', () => {
    expect(Value.Check(FogWriteBodySchema, { stroke: paint([{ x: 1, y: 1 }]) })).toBe(true);
    expect(Value.Check(FogWriteBodySchema, { fill: true })).toBe(true);
    expect(Value.Check(FogWriteBodySchema, { fill: true, stroke: paint([{ x: 1, y: 1 }]) })).toBe(false);
    expect(Value.Check(FogWriteBodySchema, { mask: [] })).toBe(false);
  });

  it('describes a mask as rows of runs, and isFogMask knows a normalised one', () => {
    expect(Value.Check(FogMaskSchema, [{ y: 0, runs: [0, 4] }])).toBe(true);
    expect(
      isFogMask([
        { y: 0, runs: [0, 4, 6, 8] },
        { y: 3, runs: [1, 2] },
      ]),
    ).toBe(true);
    for (const bad of [
      [{ y: 0, runs: [] }],
      [{ y: 0, runs: [4, 0] }],
      [{ y: 0, runs: [0, 4, 4, 8] }],
      [{ y: 0, runs: [0, 4, 2, 8] }],
      [
        { y: 3, runs: [0, 1] },
        { y: 1, runs: [0, 1] },
      ],
      [{ y: 0.5, runs: [0, 1] }],
      { y: 0, runs: [0, 1] },
    ]) {
      expect(isFogMask(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});
