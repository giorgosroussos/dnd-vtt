import { TOKEN_FOOTPRINT, type Grid, type TokenSize } from '@emberglass/shared';
import { CELL_PX, squareSize, type MapInfo } from './geometry.js';

// Where tokens go on the map canvas (PRP-04, specs/03-domain-model.md §4,
// specs/05-assets-and-images.md §2, specs/06-grid-and-measurement.md §4, D-023, D-100), free of
// React and Konva. A token's x and y are decimal grid units: the top-left corner of its footprint,
// in squares from the grid's origin, the first grid line. On a map that origin and the square are
// the calibration's, in original pixels times display ÷ original width, like the overlay's lines
// (specs/06-grid-and-measurement.md §2); a map-less scene's square is CELL_PX world pixels from 0.
// Pixels are never stored: a recalibration moves every token with the grid.

export interface Point {
  x: number;
  y: number;
}

/** A token as the canvas draws it: its own state and its asset's size and image. */
export interface CanvasToken {
  id: string;
  label: string;
  x: number;
  y: number;
  hidden: boolean;
  z_order: number;
  size: TokenSize;
  image_id: string;
}

/** World pixels per square, and where grid unit (0, 0) lies. */
export interface GridFrame {
  square: number;
  origin: Point;
}

export function gridFrame(grid: Grid, map: MapInfo | undefined): GridFrame {
  if (!map) return { square: CELL_PX, origin: { x: 0, y: 0 } };
  const scale = map.display.width / map.original.width;
  return { square: squareSize(grid, map) * scale, origin: { x: grid.offset_x * scale, y: grid.offset_y * scale } };
}

/** The footprint's side in squares (specs/05-assets-and-images.md §2). */
export const footprint = (size: TokenSize): number => TOKEN_FOOTPRINT[size];

export const toWorld = (frame: GridFrame, at: Point): Point => ({
  x: frame.origin.x + at.x * frame.square,
  y: frame.origin.y + at.y * frame.square,
});

export const toGrid = (frame: GridFrame, at: Point): Point => ({
  x: (at.x - frame.origin.x) / frame.square,
  y: (at.y - frame.origin.y) / frame.square,
});

// A free position is kept to a thousandth of a square, well under a pixel at any size a map is
// drawn, so that float noise such as 2.0000000004 is not stored as the DM's choice.
const FREE_PRECISION = 1000;
const free = (value: number): number => Math.round(value * FREE_PRECISION) / FREE_PRECISION;

/** The step a footprint's corner snaps to: whole squares, half squares for Tiny (D-023). */
export const snapStep = (size: TokenSize): number => (footprint(size) < 1 ? 0.5 : 1);

/**
 * Where a token dropped with its corner at `at` stays: snapped so its footprint covers whole
 * squares (Tiny half squares), or where it is, holding Alt (specs/06-grid-and-measurement.md §4).
 */
export function dropPosition(at: Point, size: TokenSize, alt: boolean): Point {
  if (alt) return { x: free(at.x), y: free(at.y) };
  const step = snapStep(size);
  const snap = (value: number) => Math.round(value / step) * step + 0;
  return { x: snap(at.x), y: snap(at.y) };
}

/** Where a token placed by a click at world point `at` goes: centred on it, then dropped there. */
export function placePosition(frame: GridFrame, at: Point, size: TokenSize, alt: boolean): Point {
  const centre = toGrid(frame, at);
  const half = footprint(size) / 2;
  return dropPosition({ x: centre.x - half, y: centre.y - half }, size, alt);
}

/**
 * A placement kept on the map: the footprint moved inside the world's extent, by whole steps when
 * `snapped`, so a click in the void around the map or Enter with the map panned away places the token
 * at the nearest edge of the map rather than off it (review).
 */
export function clampToWorld(
  frame: GridFrame,
  world: { width: number; height: number },
  at: Point,
  size: TokenSize,
  snapped: boolean,
): Point {
  const side = footprint(size);
  const step = snapStep(size);
  const low = toGrid(frame, { x: 0, y: 0 });
  const high = toGrid(frame, { x: world.width, y: world.height });
  const clamp = (value: number, min: number, max: number) => {
    const [lo, hi] = snapped ? [Math.ceil(min / step - 1e-9) * step, Math.floor(max / step + 1e-9) * step] : [min, max];
    if (hi < lo) return value;
    return Math.min(hi, Math.max(lo, value)) + 0;
  };
  return { x: clamp(at.x, low.x, high.x - side), y: clamp(at.y, low.y, high.y - side) };
}

/** A keyboard move by whole steps, snapping first so the token lands on the grid (D-100). */
export function nudge(at: Point, size: TokenSize, dx: number, dy: number): Point {
  const step = snapStep(size);
  const snapped = dropPosition(at, size, false);
  return { x: snapped.x + dx * step, y: snapped.y + dy * step };
}

/** Bottom of the stack first, as the server lists them. */
export const stacked = (tokens: readonly CanvasToken[]): CanvasToken[] =>
  [...tokens].sort((a, b) => a.z_order - b.z_order || a.id.localeCompare(b.id));
