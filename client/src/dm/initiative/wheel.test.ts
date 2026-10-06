import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIATIVE_BOUNDS } from '@emberglass/shared';
import { createWheelStepper, WHEEL_REST_MS, WHEEL_START, WHEEL_STEP_PX } from './wheel.js';

// An initiative number set by the mouse wheel (specs/08-ux-journeys.md §12, Q-127).

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const stepper = (start: number | null) => {
  const steps: number[] = [];
  const rests: number[] = [];
  const wheel = createWheelStepper({ start: () => start, onStep: (v) => steps.push(v), onRest: (v) => rests.push(v) });
  return { wheel, steps, rests };
};

describe('createWheelStepper', () => {
  it('raises the number on wheel up and lowers it on wheel down, one per notch, shown at once', () => {
    const { wheel, steps, rests } = stepper(12);
    wheel.turn(-100, 1);
    wheel.turn(-100, 1);
    wheel.turn(100, 1);
    expect(steps).toEqual([13, 14, 13]);
    expect(rests).toEqual([]);
  });

  it('sends the number once, when the wheel has rested', () => {
    const { wheel, rests } = stepper(12);
    wheel.turn(-1, 1);
    vi.advanceTimersByTime(WHEEL_REST_MS - 1);
    wheel.turn(-1, 1);
    vi.advanceTimersByTime(WHEEL_REST_MS - 1);
    expect(rests).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(rests).toEqual([14]);
    vi.advanceTimersByTime(5 * WHEEL_REST_MS);
    expect(rests).toEqual([14]);
  });

  it('sends at once when asked (the pointer leaving, a blur), and nothing when nothing was stepped', () => {
    const { wheel, rests } = stepper(5);
    wheel.rest();
    expect(rests).toEqual([]);
    wheel.turn(1, 1);
    wheel.rest();
    expect(rests).toEqual([4]);
    vi.advanceTimersByTime(WHEEL_REST_MS);
    expect(rests).toEqual([4]);
  });

  it('starts an empty field at 10', () => {
    const { wheel, steps } = stepper(null);
    wheel.turn(100, 1);
    wheel.turn(-100, 1);
    expect(steps).toEqual([WHEEL_START, WHEEL_START + 1]);
  });

  it("counts a trackpad's small deltas as one step per 50 px, either way", () => {
    const { wheel, steps } = stepper(10);
    for (let i = 0; i < 4; i++) wheel.turn(-12, 0);
    expect(steps).toEqual([]);
    wheel.turn(-2, 0);
    expect(steps).toEqual([11]);
    wheel.turn(-WHEEL_STEP_PX * 3, 0);
    expect(steps).toEqual([11, 14]);
  });

  it('keeps within the bounds', () => {
    const high = stepper(INITIATIVE_BOUNDS.max);
    high.wheel.turn(-1, 1);
    expect(high.steps).toEqual([INITIATIVE_BOUNDS.max]);
    const low = stepper(INITIATIVE_BOUNDS.min);
    low.wheel.turn(1, 2);
    expect(low.steps).toEqual([INITIATIVE_BOUNDS.min]);
  });
});
