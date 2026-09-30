import { Type, type Static } from 'typebox';
import { TOKEN_FOOTPRINT } from './assets.js';
import { RegionSchema, RegionShapeSchema, type RegionShape, type TokenSize } from './entities.js';

// Fog regions (TBL-03, specs/04-live-sync.md §4, §13, specs/03-domain-model.md §1, Q-099): the rule that
// decides what players see, shared by the server, which filters with it, and the DM view, which counts
// with it. A token is seen by players when it is not hidden and its centre is not inside a fogged region;
// a centre on a region's edge counts as inside, so the rule errs toward hiding. The fog itself is a mask
// the player view draws over the map: the map's pixels are never withheld (the table is trusted).

const strict = { additionalProperties: false } as const;

export const API_REGION_PATHS = {
  sceneRegions: '/api/scenes/:id/regions',
  region: '/api/regions/:id',
} as const;

// Drawn in preparation over REST; on the live scene the region commands of LIV (specs/04-live-sync.md §2).
export const RegionCreateBodySchema = Type.Object(
  {
    name: RegionSchema.properties.name,
    shape: RegionShapeSchema,
    hidden: Type.Optional(Type.Boolean()),
  },
  strict,
);
export const RegionUpdateBodySchema = Type.Object(
  { name: Type.Optional(RegionSchema.properties.name), hidden: Type.Optional(Type.Boolean()) },
  { ...strict, minProperties: 1 },
);

export type RegionCreateBody = Static<typeof RegionCreateBodySchema>;
export type RegionUpdateBody = Static<typeof RegionUpdateBodySchema>;

export interface Point {
  x: number;
  y: number;
}

/** A token's centre in grid units: its position is its footprint's top-left corner. */
export function tokenCentre(token: { x: number; y: number }, size: TokenSize): Point {
  const side = TOKEN_FOOTPRINT[size];
  return { x: token.x + side / 2, y: token.y + side / 2 };
}

// How far off an edge, in grid units, a point still counts as on it: a centre that decimals put a hair's
// breadth from a slanted edge is inside, as the rule errs toward hiding.
const EDGE = 1e-9;

/** Whether `p` lies on the segment from `a` to `b`, within EDGE of it. */
function onSegment(p: Point, a: Point, b: Point): boolean {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (Math.abs(cross) > EDGE * length) return false;
  return (
    Math.min(a.x, b.x) - EDGE <= p.x &&
    p.x <= Math.max(a.x, b.x) + EDGE &&
    Math.min(a.y, b.y) - EDGE <= p.y &&
    p.y <= Math.max(a.y, b.y) + EDGE
  );
}

/** Whether `point` is inside the shape or on its edge. A polygon's inside is by the even-odd rule. */
export function insideShape(point: Point, shape: RegionShape): boolean {
  if (shape.kind === 'rect') {
    return (
      point.x >= shape.x && point.x <= shape.x + shape.width && point.y >= shape.y && point.y <= shape.y + shape.height
    );
  }
  const { points } = shape;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if (onSegment(point, a, b)) return true;
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Whether a point is under any of the fogged shapes. */
export const inFog = (point: Point, fogged: readonly RegionShape[]): boolean =>
  fogged.some((shape) => insideShape(point, shape));

/** Whether players see a token: not hidden, and its centre under no fogged shape. */
export function seenByPlayers(
  token: { x: number; y: number; hidden: boolean },
  size: TokenSize,
  fogged: readonly RegionShape[],
): boolean {
  return !token.hidden && !inFog(tokenCentre(token, size), fogged);
}

/** The fogged regions' shapes, which is all players are told of the fog. */
export const foggedShapes = (regions: readonly { shape: RegionShape; hidden: boolean }[]): RegionShape[] =>
  regions.filter((region) => region.hidden).map((region) => region.shape);
