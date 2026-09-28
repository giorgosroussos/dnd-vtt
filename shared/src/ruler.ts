import type { RulerRule } from './entities.js';

// Ruler distances (LIV-07; specs/06-grid-and-measurement.md §5, Q-037, Q-048, Q-087, D-045), free of
// the database and the canvas so that the server, which sends the TV the distance, and the DM view,
// which shows it while measuring, count the same way. The ruler measures a straight path between the
// centres of two squares, without waypoints. Counted in squares moved: under the PHB 2014 rule every
// diagonal square counts as one, so the count is the larger of the two offsets; under the optional
// DMG rule every second diagonal counts as two (5 ft, 10 ft, 5 ft, …). The count is then multiplied
// by the scene's feet per square, which with 5 ft squares is exactly the rules as written (D-045).

/** A square of the grid, by column and row from the grid's origin; its centre is (column + ½, row + ½). */
export interface RulerSquare {
  column: number;
  row: number;
}

/** Whether `value` is a measurement as the events carry it: two whole squares and a distance (LIV-07 review C-L3). */
export function isMeasurement(value: unknown): value is { from: RulerSquare; to: RulerSquare; feet: number } {
  const square = (each: unknown) =>
    typeof each === 'object' &&
    each !== null &&
    Number.isInteger((each as RulerSquare).column) &&
    Number.isInteger((each as RulerSquare).row);
  if (typeof value !== 'object' || value === null) return false;
  const { from, to, feet } = value as Record<string, unknown>;
  return square(from) && square(to) && typeof feet === 'number' && Number.isFinite(feet) && feet >= 0;
}

/** The squares moved from `from` to `to` under `rule`. */
export function rulerSquares(from: RulerSquare, to: RulerSquare, rule: RulerRule): number {
  const dx = Math.abs(to.column - from.column);
  const dy = Math.abs(to.row - from.row);
  const diagonal = Math.min(dx, dy);
  const straight = Math.max(dx, dy) - diagonal;
  return rule === 'dmg' ? straight + diagonal + Math.floor(diagonal / 2) : straight + diagonal;
}

/** The distance in feet, to a millionth of a foot so that a decimal scale leaves no float noise. */
export function rulerFeet(from: RulerSquare, to: RulerSquare, rule: RulerRule, feetPerSquare: number): number {
  return Math.round(rulerSquares(from, to, rule) * feetPerSquare * 1e6) / 1e6;
}
