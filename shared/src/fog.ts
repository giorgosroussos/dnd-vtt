import { Type, type Static } from 'typebox';
import { TOKEN_FOOTPRINT } from './assets.js';
import { MAX_GRID_LINES_PER_AXIS } from './campaigns.js';
import type { Grid, TokenSize } from './entities.js';

// Painted fog (TBL-04, specs/04-live-sync.md §4, §13, specs/03-domain-model.md §1, Q-101): one mask per
// scene, painted with a round brush and erased the same way, and the rule that decides what players see,
// shared by the server, which filters with it, and the DM view, which previews and counts with it. A token
// is seen by players when it is not hidden and its centre is under no fogged cell; a centre on a cell's
// edge counts as under every cell it touches, so the rule errs toward hiding. The fog itself is a mask the
// player view draws over the map: the map's pixels are never withheld (the table is trusted).
//
// The mask is kept in grid units, in cells of a quarter square each way: cell (cx, cy) covers the grid
// units [cx/4, (cx+1)/4) by [cy/4, (cy+1)/4). It is a run-length encoding by row: each row lists its fogged
// cells as [start, end) pairs, sorted, apart and merged, and the rows come in ascending order, none empty.

const strict = { additionalProperties: false } as const;

/** Cells per grid square, each way. */
export const FOG_CELLS_PER_SQUARE = 4;
/** The brush's radius in squares: a slider from a quarter square to five, in quarter steps (Q-101). */
export const FOG_BRUSH_RADIUS = { min: 0.25, max: 5, step: 0.25 } as const;
/** The most points one stroke carries, which keeps a command well under the socket's message limit. */
export const FOG_STROKE_MAX_POINTS = 1000;
/**
 * The most work one stroke may cost: rows of cells summed over its segments (`strokeWork`). A stroke drawn by
 * hand, a point every quarter of the radius, costs a few thousand; the canvas sends a longer one in parts.
 * Past it a stroke is refused, so one command can never hold the server for long (TBL-04 review).
 */
export const FOG_STROKE_MAX_WORK = 250_000;
/** The most runs a scene's fog may hold, about a megabyte of JSON; a write past it is refused. */
export const FOG_MAX_RUNS = 100_000;

// The extent is at most MAX_GRID_LINES_PER_AXIS squares each way, so a row index and a run's ends are
// bounded by a calibrated map's (offsets included) and a mask has at most that many rows.
const MAX_CELLS = MAX_GRID_LINES_PER_AXIS * FOG_CELLS_PER_SQUARE;
const LIMIT = 4 * MAX_CELLS;
const CellIndex = Type.Integer({ minimum: -LIMIT, maximum: LIMIT });
export const FogRowSchema = Type.Object(
  { y: CellIndex, runs: Type.Array(CellIndex, { minItems: 2, maxItems: MAX_CELLS }) },
  strict,
);
export const FogMaskSchema = Type.Array(FogRowSchema, { maxItems: MAX_CELLS + 1 });

const StrokeCoordinate = Type.Number({ minimum: -1e6, maximum: 1e6 });
export const FogStrokeSchema = Type.Object(
  {
    mode: Type.Union([Type.Literal('paint'), Type.Literal('erase')]),
    radius: Type.Number({
      minimum: FOG_BRUSH_RADIUS.min,
      maximum: FOG_BRUSH_RADIUS.max,
      multipleOf: FOG_BRUSH_RADIUS.step,
    }),
    points: Type.Array(Type.Object({ x: StrokeCoordinate, y: StrokeCoordinate }, strict), {
      minItems: 1,
      maxItems: FOG_STROKE_MAX_POINTS,
    }),
  },
  strict,
);

export type FogRow = Static<typeof FogRowSchema>;
export type FogMask = Static<typeof FogMaskSchema>;
export type FogStroke = Static<typeof FogStrokeSchema>;

export const API_FOG_PATHS = { sceneFog: '/api/scenes/:id/fog' } as const;

// Painted in preparation over REST; on the live scene by `fog.paint` and `fog.fill` (specs/04-live-sync.md
// §2): a stroke, or the whole map fogged (`fill: true`) or cleared (`fill: false`).
export const FogWriteBodySchema = Type.Union([
  Type.Object({ stroke: FogStrokeSchema }, strict),
  Type.Object({ fill: Type.Boolean() }, strict),
]);
export type FogWriteBody = Static<typeof FogWriteBodySchema>;

export const EMPTY_FOG: FogMask = [];

export interface Point {
  x: number;
  y: number;
}

/** A rectangle of cells, [x0, x1) by [y0, y1): where a scene's fog may lie. */
export interface FogExtent {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The scene's map in cells: a map's whole image, by the grid's square size and offset in its original
 * pixels (the size read from the columns until it is calibrated, as the canvas reads it); a scene without
 * a map, its columns and rows from the origin. At most MAX_GRID_LINES_PER_AXIS squares each way.
 */
export function fogExtent(grid: Grid, map: { width: number; height: number } | null): FogExtent {
  const cells = (squares: number) => squares * FOG_CELLS_PER_SQUARE;
  let x0 = 0;
  let y0 = 0;
  let x1 = cells(grid.columns);
  let y1 = cells(grid.rows);
  if (map) {
    const size = grid.size ?? map.width / grid.columns;
    // `+ 0` turns a -0 into 0.
    x0 = Math.floor(cells(-grid.offset_x / size)) + 0;
    y0 = Math.floor(cells(-grid.offset_y / size)) + 0;
    x1 = Math.ceil(cells((map.width - grid.offset_x) / size));
    y1 = Math.ceil(cells((map.height - grid.offset_y) / size));
  }
  // Kept within the cell indices a mask may hold, whatever the offsets (TBL-04 review).
  const bound = (value: number) => Math.min(LIMIT, Math.max(-LIMIT, value));
  [x0, y0] = [bound(x0), bound(y0)];
  return { x0, y0, x1: bound(Math.min(x1, x0 + MAX_CELLS)), y1: bound(Math.min(y1, y0 + MAX_CELLS)) };
}

/** The whole extent fogged. */
export function fillFog(extent: FogExtent): FogMask {
  if (extent.x1 <= extent.x0) return [];
  const rows: FogMask = [];
  for (let y = extent.y0; y < extent.y1; y++) rows.push({ y, runs: [extent.x0, extent.x1] });
  return rows;
}

// Runs are flat [start, end) pairs. `union` and `subtract` take sorted, apart runs and answer the same.
function union(a: readonly number[], b: readonly number[]): number[] {
  const pairs: [number, number][] = [];
  for (const runs of [a, b]) for (let i = 0; i < runs.length; i += 2) pairs.push([runs[i]!, runs[i + 1]!]);
  pairs.sort((p, q) => p[0] - q[0]);
  const out: number[] = [];
  for (const [start, end] of pairs) {
    if (out.length > 0 && start <= out[out.length - 1]!) out[out.length - 1] = Math.max(out[out.length - 1]!, end);
    else out.push(start, end);
  }
  return out;
}

function subtract(a: readonly number[], b: readonly number[]): number[] {
  // Both sorted and apart, so one pass over each: a cut wholly before the run is passed for good.
  const out: number[] = [];
  let j = 0;
  for (let i = 0; i < a.length; i += 2) {
    let start = a[i]!;
    const end = a[i + 1]!;
    while (j < b.length && b[j + 1]! <= start) j += 2;
    for (let k = j; k < b.length && b[k]! < end && start < end; k += 2) {
      if (b[k]! > start) out.push(start, b[k]!);
      start = Math.max(start, b[k + 1]!);
    }
    if (start < end) out.push(start, end);
  }
  return out;
}

// How far past the radius a cell's centre still counts as under the brush: decimals put a centre exactly
// at the radius a hair's breadth either side of it.
const EDGE = 1e-9;

/** Where the horizontal line at `y` crosses the capsule around a segment: an interval of x, if any. */
function slice(a: Point, b: Point, radius: number, y: number): [number, number] | undefined {
  const xs: number[] = [];
  for (const centre of [a, b]) {
    const dy = y - centre.y;
    const half = radius * radius - dy * dy;
    if (half >= -EDGE) {
      const w = Math.sqrt(Math.max(0, half));
      xs.push(centre.x - w, centre.x + w);
    }
  }
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length > 0) {
    // The two sides of the capsule, offset by the radius along the segment's normal.
    const nx = (-(b.y - a.y) / length) * radius;
    const ny = ((b.x - a.x) / length) * radius;
    for (const side of [1, -1]) {
      const p = { x: a.x + side * nx, y: a.y + side * ny };
      const q = { x: b.x + side * nx, y: b.y + side * ny };
      if (p.y === q.y) continue;
      const t = (y - p.y) / (q.y - p.y);
      if (t >= 0 && t <= 1) xs.push(p.x + t * (q.x - p.x));
    }
  }
  if (xs.length === 0) return undefined;
  return [Math.min(...xs), Math.max(...xs)];
}

const segmentsOf = (points: readonly Point[]): [Point, Point][] =>
  points.length === 1 ? [[points[0]!, points[0]!]] : points.slice(1).map((p, i) => [points[i]!, p]);

/** What a stroke costs to apply: the rows of cells each of its segments crosses, summed. */
export function strokeWork(stroke: FogStroke): number {
  const n = FOG_CELLS_PER_SQUARE;
  return segmentsOf(stroke.points).reduce(
    (sum, [a, b]) => sum + Math.ceil((Math.abs(b.y - a.y) + 2 * stroke.radius) * n) + 1,
    0,
  );
}

/** The cells a stroke covers, row by row, within the extent: those whose centre is within its radius. */
export function strokeCells(stroke: FogStroke, extent: FogExtent): Map<number, number[]> {
  const n = FOG_CELLS_PER_SQUARE;
  const { radius } = stroke;
  // Each segment's spans, row by row over the rows it crosses only; then each row's spans merged once.
  const spans = new Map<number, [number, number][]>();
  for (const [a, b] of segmentsOf(stroke.points)) {
    const first = Math.max(extent.y0, Math.ceil((Math.min(a.y, b.y) - radius) * n - 0.5 - EDGE));
    const last = Math.min(extent.y1 - 1, Math.floor((Math.max(a.y, b.y) + radius) * n - 0.5 + EDGE));
    for (let cy = first; cy <= last; cy++) {
      const span = slice(a, b, radius, (cy + 0.5) / n);
      if (!span) continue;
      const start = Math.max(extent.x0, Math.ceil(span[0] * n - 0.5 - EDGE));
      const end = Math.min(extent.x1, Math.floor(span[1] * n - 0.5 + EDGE) + 1);
      if (start >= end) continue;
      const row = spans.get(cy);
      if (row) row.push([start, end]);
      else spans.set(cy, [[start, end]]);
    }
  }
  const rows = new Map<number, number[]>();
  for (const [cy, row] of [...spans.entries()].sort((p, q) => p[0] - q[0])) {
    rows.set(cy, union(row.flat(), []));
  }
  return rows;
}

/** How many runs a mask holds. */
export const fogRuns = (mask: FogMask): number => mask.reduce((sum, row) => sum + row.runs.length / 2, 0);

/** The mask after a stroke: painting fogs the cells it covers, erasing clears them. */
export function applyStroke(mask: FogMask, stroke: FogStroke, extent: FogExtent): FogMask {
  const cells = strokeCells(stroke, extent);
  if (cells.size === 0) return mask;
  const rows = new Map(mask.map((row) => [row.y, row.runs]));
  for (const [y, runs] of cells) {
    const before = rows.get(y) ?? [];
    const after = stroke.mode === 'paint' ? union(before, runs) : subtract(before, runs);
    if (after.length > 0) rows.set(y, after);
    else rows.delete(y);
  }
  return [...rows.entries()].sort((p, q) => p[0] - q[0]).map(([y, runs]) => ({ y, runs }));
}

/** Whether two masks fog the same cells. Masks are normalised, so this is equality of their rows. */
export function sameFog(a: FogMask, b: FogMask): boolean {
  return (
    a.length === b.length &&
    a.every(
      (row, i) =>
        row.y === b[i]!.y && row.runs.length === b[i]!.runs.length && row.runs.every((x, j) => x === b[i]!.runs[j]),
    )
  );
}

/** Whether a value is a normalised mask: rows ascending, each with sorted, apart, non-empty runs. */
export function isFogMask(value: unknown): value is FogMask {
  if (!Array.isArray(value)) return false;
  let lastY = -Infinity;
  for (const row of value as unknown[]) {
    if (typeof row !== 'object' || row === null) return false;
    const { y, runs } = row as { y?: unknown; runs?: unknown };
    if (!Number.isInteger(y) || (y as number) <= lastY) return false;
    if (!Array.isArray(runs) || runs.length === 0 || runs.length % 2 !== 0) return false;
    let lastEnd = -Infinity;
    for (let i = 0; i < runs.length; i += 2) {
      const [start, end] = [runs[i] as unknown, runs[i + 1] as unknown];
      if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
      if ((start as number) <= lastEnd || (end as number) <= (start as number)) return false;
      lastEnd = end as number;
    }
    lastY = y as number;
  }
  return true;
}

function rowAt(mask: FogMask, y: number): readonly number[] | undefined {
  let lo = 0;
  let hi = mask.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const row = mask[mid]!;
    if (row.y === y) return row.runs;
    if (row.y < y) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

const fogged = (runs: readonly number[] | undefined, x: number): boolean => {
  if (!runs) return false;
  for (let i = 0; i < runs.length; i += 2) if (x >= runs[i]! && x < runs[i + 1]!) return true;
  return false;
};

/** The cell indices a coordinate touches: one inside a cell, both neighbours on an edge between two. */
function touching(value: number): number[] {
  const at = value * FOG_CELLS_PER_SQUARE;
  const nearest = Math.round(at);
  return Math.abs(at - nearest) <= EDGE * FOG_CELLS_PER_SQUARE ? [nearest - 1, nearest] : [Math.floor(at)];
}

/** Whether a point is under the fog: any fogged cell it lies in or on the edge of. */
export function inFog(point: Point, mask: FogMask): boolean {
  if (mask.length === 0) return false;
  const xs = touching(point.x);
  return touching(point.y).some((y) => {
    const runs = rowAt(mask, y);
    return xs.some((x) => fogged(runs, x));
  });
}

/** A token's centre in grid units: its position is its footprint's top-left corner. */
export function tokenCentre(token: { x: number; y: number }, size: TokenSize): Point {
  const side = TOKEN_FOOTPRINT[size];
  return { x: token.x + side / 2, y: token.y + side / 2 };
}

/** Whether players see a token: not hidden, and its centre under no fogged cell. */
export function seenByPlayers(
  token: { x: number; y: number; hidden: boolean },
  size: TokenSize,
  mask: FogMask,
): boolean {
  return !token.hidden && !inFog(tokenCentre(token, size), mask);
}
