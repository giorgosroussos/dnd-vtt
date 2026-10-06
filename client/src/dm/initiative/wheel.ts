import { INITIATIVE_BOUNDS } from '@emberglass/shared';

// An initiative number set by the mouse wheel over its field (specs/08-ux-journeys.md §12): up raises it by one and
// down lowers it, within the bounds; an empty field starts at 10, a d20's middle. A trackpad's many small deltas
// count as one step per WHEEL_STEP_PX. Each step is shown at once and the number is sent once the wheel has rested
// for WHEEL_REST_MS, or as soon as the pointer leaves or the field loses focus.

/** How long the wheel must rest before the number is sent. */
export const WHEEL_REST_MS = 600;
/** Pixels of a smooth (pixel-mode) scroll that make one step. */
export const WHEEL_STEP_PX = 50;
/** Where an empty field starts. */
export const WHEEL_START = 10;

export interface WheelStepper {
  /** A wheel event: its `deltaY` and `deltaMode` (0 pixels, 1 lines, 2 pages). */
  turn: (deltaY: number, deltaMode: number) => void;
  /** Sends the number stepped to, if any, now. */
  rest: () => void;
}

export function createWheelStepper({
  start,
  onStep,
  onRest,
}: {
  /** The field's number when the wheel starts turning, null when empty. */
  start: () => number | null;
  onStep: (value: number) => void;
  onRest: (value: number) => void;
}): WheelStepper {
  let value: number | undefined;
  let travelled = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const rest = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    travelled = 0;
    if (value === undefined) return;
    const done = value;
    value = undefined;
    onRest(done);
  };
  return {
    turn: (deltaY, deltaMode) => {
      if (deltaY === 0) return;
      let steps: number;
      if (deltaMode === 0) {
        travelled += deltaY;
        steps = Math.trunc(travelled / WHEEL_STEP_PX);
        travelled -= steps * WHEEL_STEP_PX;
      } else {
        steps = Math.sign(deltaY);
      }
      if (steps !== 0) {
        const from = value ?? start();
        // Wheel up (a negative delta) raises the number.
        const next =
          from === null ? WHEEL_START : Math.min(INITIATIVE_BOUNDS.max, Math.max(INITIATIVE_BOUNDS.min, from - steps));
        value = next;
        onStep(next);
      }
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(rest, WHEEL_REST_MS);
    },
    rest,
  };
}
