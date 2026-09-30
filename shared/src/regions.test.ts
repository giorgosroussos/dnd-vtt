import { describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import {
  foggedShapes,
  inFog,
  insideShape,
  RegionCreateBodySchema,
  RegionShapeSchema,
  seenByPlayers,
  tokenCentre,
  type RegionShape,
} from './index.js';

// The fog's rule (TBL-03, specs/04-live-sync.md §4, §13, Q-099): a token is seen by players when it is not
// hidden and its centre is not inside a fogged region; a centre on the edge counts as inside.

const rect: RegionShape = { kind: 'rect', x: 2, y: 3, width: 4, height: 2 };
// An L: the square from (0, 0) to (4, 4) without its top-right quarter.
const ell: RegionShape = {
  kind: 'polygon',
  points: [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 4, y: 2 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ],
};

describe('insideShape', () => {
  it('takes a rectangle’s inside and its edge, corners included, and nothing past it', () => {
    for (const point of [
      { x: 4, y: 4 },
      { x: 2, y: 3 },
      { x: 6, y: 5 },
      { x: 2, y: 4.5 },
      { x: 5.99, y: 3.01 },
    ]) {
      expect(insideShape(point, rect), JSON.stringify(point)).toBe(true);
    }
    for (const point of [
      { x: 1.99, y: 4 },
      { x: 6.01, y: 4 },
      { x: 4, y: 2.99 },
      { x: 4, y: 5.01 },
    ]) {
      expect(insideShape(point, rect), JSON.stringify(point)).toBe(false);
    }
  });

  it('takes a concave polygon’s inside by the even-odd rule, and its edges and corners', () => {
    expect(insideShape({ x: 1, y: 1 }, ell)).toBe(true);
    expect(insideShape({ x: 3, y: 3 }, ell)).toBe(true);
    // The missing quarter is outside.
    expect(insideShape({ x: 3, y: 1 }, ell)).toBe(false);
    // Edges and corners, the inner corner included.
    for (const point of [
      { x: 2, y: 1 },
      { x: 3, y: 2 },
      { x: 2, y: 2 },
      { x: 0, y: 4 },
      { x: 4, y: 3 },
    ]) {
      expect(insideShape(point, ell), JSON.stringify(point)).toBe(true);
    }
    expect(insideShape({ x: -0.5, y: 2 }, ell)).toBe(false);
    expect(insideShape({ x: 5, y: 3 }, ell)).toBe(false);
  });

  it('takes a triangle’s slanted edge as inside', () => {
    const triangle: RegionShape = {
      kind: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 0, y: 4 },
      ],
    };
    expect(insideShape({ x: 2, y: 2 }, triangle)).toBe(true);
    expect(insideShape({ x: 2.01, y: 2 }, triangle)).toBe(false);
    expect(insideShape({ x: 1, y: 1 }, triangle)).toBe(true);
    // On the slanted edge by decimals that floating point cannot hold exactly (review).
    const slant: RegionShape = {
      kind: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 0, y: 7 },
      ],
    };
    const t = 0.1;
    expect(insideShape({ x: 3 * (1 - t), y: 7 * t }, slant)).toBe(true);
  });
});

describe('seenByPlayers', () => {
  it('tests the centre of the token’s footprint, whatever its size', () => {
    expect(tokenCentre({ x: 1, y: 1 }, 'medium')).toEqual({ x: 1.5, y: 1.5 });
    expect(tokenCentre({ x: 1, y: 1 }, 'tiny')).toEqual({ x: 1.25, y: 1.25 });
    expect(tokenCentre({ x: 1, y: 1 }, 'huge')).toEqual({ x: 2.5, y: 2.5 });
    // A huge token whose corner is outside the fog but whose centre is inside it is not seen.
    expect(seenByPlayers({ x: 0.5, y: 2, hidden: false }, 'huge', [rect])).toBe(false);
    // A medium token overlapping the fog with its centre outside it is seen.
    expect(seenByPlayers({ x: 5.6, y: 3, hidden: false }, 'medium', [rect])).toBe(true);
  });

  it('is not hidden and under no fogged shape; a hidden token is never seen, fog or none', () => {
    const token = { x: 3, y: 3, hidden: false };
    expect(seenByPlayers(token, 'medium', [])).toBe(true);
    expect(seenByPlayers(token, 'medium', [rect])).toBe(false);
    expect(seenByPlayers(token, 'medium', [ell])).toBe(false);
    expect(seenByPlayers({ ...token, hidden: true }, 'medium', [])).toBe(false);
    expect(inFog({ x: 10, y: 10 }, [rect, ell])).toBe(false);
  });

  it('counts only the fogged regions, and tells players their shapes alone', () => {
    const regions = [
      { id: 'a', name: 'Back room', shape: rect, hidden: true },
      { id: 'b', name: 'Cellar', shape: ell, hidden: false },
    ];
    expect(foggedShapes(regions)).toEqual([rect]);
  });
});

describe('the region contract', () => {
  it('takes shapes on grid corners only: whole numbers, a rectangle of a square at least, 3 to 64 corners', () => {
    expect(Value.Check(RegionShapeSchema, rect)).toBe(true);
    expect(Value.Check(RegionShapeSchema, ell)).toBe(true);
    for (const shape of [
      { kind: 'rect', x: 0.5, y: 0, width: 2, height: 2 },
      { kind: 'rect', x: 0, y: 0, width: 0, height: 2 },
      { kind: 'rect', x: 0, y: 0, width: 2, height: -1 },
      { kind: 'rect', x: 0, y: 0, width: 2, height: 2, name: 'Back room' },
      {
        kind: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      },
      { kind: 'polygon', points: Array.from({ length: 65 }, (_, x) => ({ x, y: x % 2 })) },
      {
        kind: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0.5 },
          { x: 0, y: 1 },
        ],
      },
      { kind: 'circle', x: 0, y: 0, r: 2 },
      { kind: 'rect', x: 1e9, y: 0, width: 2, height: 2 },
    ]) {
      expect(Value.Check(RegionShapeSchema, shape), JSON.stringify(shape)).toBe(false);
    }
  });

  it('names a region with 1 to 100 characters, not all white space nor any control one, and refuses any other field', () => {
    expect(Value.Check(RegionCreateBodySchema, { name: 'Back room', shape: rect })).toBe(true);
    expect(Value.Check(RegionCreateBodySchema, { name: 'Back room', shape: rect, hidden: false })).toBe(true);
    for (const body of [
      { name: '', shape: rect },
      { name: '   ', shape: rect },
      { name: 'Back\u0000room', shape: rect },
      { name: 'x'.repeat(101), shape: rect },
      { name: 'Back room', shape: rect, scene_id: 'a' },
      { shape: rect },
    ]) {
      expect(Value.Check(RegionCreateBodySchema, body), JSON.stringify(body)).toBe(false);
    }
  });
});
