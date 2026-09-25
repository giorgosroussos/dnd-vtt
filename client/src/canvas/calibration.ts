import type { Grid } from '@emberglass/shared';
import { MAX_LINES_PER_AXIS, type Size } from './geometry.js';

// The arithmetic of grid calibration (PRP-03, specs/06-grid-and-measurement.md §1, §2, D-094),
// free of React and Konva. Everything here is in the original image's pixels: the canvas shows
// the display version and converts a rectangle drawn there before reporting it (MapCanvas).
// Sizes stay decimal; nothing here rounds a size the DM did not type.

/** The fields of a scene's grid that calibration sets. */
export type Calibration = Pick<Grid, 'size' | 'offset_x' | 'offset_y' | 'columns' | 'rows'> & { size: number };

export type Method = 'dimensions' | 'rectangle' | 'fine';
export const METHODS: readonly Method[] = ['dimensions', 'rectangle', 'fine'];

/** An axis-aligned rectangle. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The whole squares that cover the map at `size`, never fewer than one each way. */
export function extentFor(original: Size, size: number): Pick<Grid, 'columns' | 'rows'> {
  return {
    columns: Math.max(1, Math.ceil(original.width / size - 1e-9)),
    rows: Math.max(1, Math.ceil(original.height / size - 1e-9)),
  };
}

/** Offsets kept within one square, so the same grid always reads the same way. */
const wrap = (offset: number, size: number): number => ((offset % size) + size) % size;

/** Known dimensions: the map is `columns` squares across, the first line on its left and top edges. */
export function fromDimensions(original: Size, columns: number, rows: number): Calibration {
  return { size: original.width / columns, offset_x: 0, offset_y: 0, columns, rows };
}

/**
 * A rectangle dragged over `squares` × `squares` drawn squares: its sides divided by the
 * count, averaged across the two axes, is the square size, and its corner lies on a grid
 * line, which gives the offset.
 */
export function fromRectangle(rect: Rect, squares: number, original: Size): Calibration {
  const box = normalise(rect);
  const size = (box.width + box.height) / 2 / squares;
  return { size, offset_x: wrap(box.x, size), offset_y: wrap(box.y, size), ...extentFor(original, size) };
}

/**
 * Fine tuning: the size as typed and the offsets wrapped into one square, which draws the same
 * grid and keeps any offset within what the server takes (D-096); the extent follows the size.
 */
export function fromFine(original: Size, size: number, offsetX: number, offsetY: number): Calibration {
  return { size, offset_x: wrap(offsetX, size), offset_y: wrap(offsetY, size), ...extentFor(original, size) };
}

/**
 * Where calibration starts: the scene's own grid, its size read as the overlay reads it (D-090).
 * A stored size too fine to draw, which only a request made outside this view can have stored,
 * starts from the finest drawable size instead (D-096).
 */
export function initialCalibration(grid: Grid, original: Size): Calibration {
  const stored = grid.size ?? original.width / grid.columns;
  const finest = Math.max(original.width, original.height) / MAX_LINES_PER_AXIS;
  return {
    size: drawableSize(stored, original) ? stored : Math.max(stored, finest),
    offset_x: grid.offset_x,
    offset_y: grid.offset_y,
    columns: grid.columns,
    rows: grid.rows,
  };
}

/** A rectangle with a positive width and height, whichever way it was dragged. */
export function normalise(rect: Rect): Rect {
  return {
    x: Math.min(rect.x, rect.x + rect.width),
    y: Math.min(rect.y, rect.y + rect.height),
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

// Four decimal places: a ten-thousandth of a pixel is far below what a DM can see, and it keeps
// a stepped value such as 70.4 + 0.1 from showing as 70.50000000000001.
const DECIMALS = 1e4;
export const roundDecimal = (value: number): number => Math.round(value * DECIMALS) / DECIMALS;
export const formatDecimal = (value: number): string => String(roundDecimal(value));

/** A fine-tuning key step: 0.1 px, or 1 px with Shift. */
export const FINE_STEP = 0.1;
export const FINE_STEP_SHIFT = 1;

/** A decimal number as typed, or undefined when it is not one. */
export function parseDecimal(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

/** A whole number of at least one, as typed, or undefined. */
export function parseCount(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value >= 1 && value <= 100_000 ? value : undefined;
}

/** A square size the canvas can draw: positive, and not so fine that the overlay gives up. */
export function drawableSize(size: number | undefined, original: Size): size is number {
  return (
    size !== undefined &&
    size > 0 &&
    size <= 1e6 &&
    original.width / size <= MAX_LINES_PER_AXIS &&
    original.height / size <= MAX_LINES_PER_AXIS
  );
}

/** The magnifier's box, in CSS pixels. */
export const MAGNIFIER_PX = 144;

export interface CornerView {
  /** The region of the original shown, at its bottom-right corner. */
  crop: Rect;
  /** Magnifier pixels per original pixel, at least 1. */
  zoom: number;
  /** Every grid line inside the region, in magnifier pixels. */
  xs: number[];
  ys: number[];
}

// Counted, not stepped, and none at all past MAX_LINES_PER_AXIS, as the overlay does: a size too
// small for floating point to step past can never loop (D-096).
function linesIn(offset: number, size: number, from: number, to: number): number[] {
  const lines: number[] = [];
  if (!(size > 0) || (to - from) / size > MAX_LINES_PER_AXIS) return lines;
  const first = from + wrap(offset - from, size);
  for (let index = 0; index <= (to - from) / size + 1; index++) {
    const at = first + index * size;
    if (at > to + 1e-9) break;
    lines.push(at);
  }
  return lines;
}

/**
 * The far corner of the map, magnified: the bottom-right region the size of two squares,
 * between 40 and MAGNIFIER_PX original pixels a side and never more than the map, so the
 * magnification is at least 1 × (at most 4 ×); that corner is where a size a fraction of a
 * pixel wrong has drifted furthest from the first line (specs/06-grid-and-measurement.md §1).
 */
export function cornerView(
  calibration: Pick<Calibration, 'size' | 'offset_x' | 'offset_y'>,
  original: Size,
): CornerView {
  const side = Math.min(original.width, original.height, Math.max(40, Math.min(2 * calibration.size, MAGNIFIER_PX)));
  const crop = { x: original.width - side, y: original.height - side, width: side, height: side };
  const zoom = MAGNIFIER_PX / side;
  const toBox = (from: number) => (at: number) => (at - from) * zoom;
  return {
    crop,
    zoom,
    xs: linesIn(calibration.offset_x, calibration.size, crop.x, original.width).map(toBox(crop.x)),
    ys: linesIn(calibration.offset_y, calibration.size, crop.y, original.height).map(toBox(crop.y)),
  };
}
