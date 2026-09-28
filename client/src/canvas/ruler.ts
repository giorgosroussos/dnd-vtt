import type { RulerSquare } from '@emberglass/shared';
import { toGrid, toWorld, type GridFrame, type Point } from './tokens.js';

// The ruler's geometry on the map canvas (LIV-07; specs/06-grid-and-measurement.md §5, Q-048), free of
// React and Konva. A measurement runs between the centres of two squares; a square is named by its
// column and row from the grid's origin, the first grid line, as token positions are in grid units, so
// the square a point lies in is the whole part of its grid position and its centre is half a square in.

/** A measurement's two ends. */
export interface RulerPath {
  from: RulerSquare;
  to: RulerSquare;
}

/** The square the world point `at` lies in. */
export function squareAt(frame: GridFrame, at: Point): RulerSquare {
  const grid = toGrid(frame, at);
  // `+ 0` turns -0 into 0, which JSON would otherwise send as 0 while Object.is tells them apart.
  return { column: Math.floor(grid.x) + 0, row: Math.floor(grid.y) + 0 };
}

/** Where a square's centre lies in the world. */
export const squareCentre = (frame: GridFrame, square: RulerSquare): Point =>
  toWorld(frame, { x: square.column + 0.5, y: square.row + 0.5 });

export const sameSquare = (a: RulerSquare, b: RulerSquare): boolean => a.column === b.column && a.row === b.row;

export const samePath = (a: RulerPath | null | undefined, b: RulerPath | null | undefined): boolean =>
  a === b || (!!a && !!b && sameSquare(a.from, b.from) && sameSquare(a.to, b.to));

const STEPS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * The measurement after an arrow key (specs/08-ux-journeys.md §8): the end moves a square, or with
 * Shift the whole ruler does; with nothing measured yet, it starts at `start`. Undefined for any other key.
 */
export function rulerForKey(
  path: RulerPath | null,
  key: string,
  shift: boolean,
  start: RulerSquare,
): RulerPath | undefined {
  const step = STEPS[key];
  if (!step) return undefined;
  const [dx, dy] = step;
  const current = path ?? { from: start, to: start };
  const moved = (square: RulerSquare) => ({ column: square.column + dx, row: square.row + dy });
  return shift ? { from: moved(current.from), to: moved(current.to) } : { from: current.from, to: moved(current.to) };
}
