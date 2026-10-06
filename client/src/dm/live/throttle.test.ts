import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { throttle } from './throttle.js';

// The throttle Follow my view sends through (DMT-03, specs/04-live-sync.md §9, Q-113).

describe('the Follow my view throttle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setUp = () => {
    const sent: number[] = [];
    const sender = throttle<number>(
      (value) => sent.push(value),
      100,
      (a, b) => a === b,
    );
    return { sent, sender };
  };

  it('sends the first change at once (leading)', () => {
    const { sent, sender } = setUp();
    sender.push(1);
    expect(sent).toEqual([1]);
  });

  it('sends only the latest change of an interval, when it ends (trailing)', () => {
    const { sent, sender } = setUp();
    sender.push(1);
    sender.push(2);
    sender.push(3);
    expect(sent).toEqual([1]);
    vi.advanceTimersByTime(99);
    expect(sent).toEqual([1]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([1, 3]);
  });

  it('always sends the value a gesture ended on, at most once per interval while it lasts', () => {
    const { sent, sender } = setUp();
    // A pan of 60 frames, one every 16 ms, ending on 60.
    for (let frame = 1; frame <= 60; frame += 1) {
      sender.push(frame);
      vi.advanceTimersByTime(16);
    }
    vi.advanceTimersByTime(200);
    expect(sent.at(-1)).toBe(60);
    // About a second of frames: ten sends or so, never one per frame.
    expect(sent.length).toBeLessThanOrEqual(11);
    expect(sent.length).toBeGreaterThanOrEqual(9);
  });

  it('never sends a value equal to the one sent last', () => {
    const { sent, sender } = setUp();
    sender.push(1);
    sender.push(1);
    vi.advanceTimersByTime(100);
    sender.push(1);
    vi.advanceTimersByTime(100);
    expect(sent).toEqual([1]);
    // A change and back within one interval: the interval ends on the value already sent.
    sender.push(2);
    sender.push(1);
    vi.advanceTimersByTime(100);
    expect(sent).toEqual([1, 2, 1]);
  });

  it('sends a change after a quiet interval at once again', () => {
    const { sent, sender } = setUp();
    sender.push(1);
    vi.advanceTimersByTime(250);
    sender.push(2);
    expect(sent).toEqual([1, 2]);
  });

  it('drops the waiting value on cancel, and sends the next push at once, even a value sent before', () => {
    const { sent, sender } = setUp();
    sender.push(1);
    sender.push(2);
    sender.cancel();
    vi.advanceTimersByTime(500);
    expect(sent).toEqual([1]);
    sender.push(1);
    expect(sent).toEqual([1, 1]);
  });
});
