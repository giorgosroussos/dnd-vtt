// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventEnvelope } from '@emberglass/shared';
import { render } from '../ui/testing/render.js';
import { MAX_PINGS, PING_MS, pingPoint, usePings, type Pings } from './pings.js';

// The pings a view draws (TBL-01, specs/04-live-sync.md §12): each for PING_MS, the latest MAX_PINGS at once.

const ping = (x: number, y: number, version = 1): EventEnvelope => ({ type: 'ping', version, payload: { x, y } });

afterEach(() => {
  vi.useRealTimers();
});

/** Renders the hook in a component and reads what it returned last. */
function renderHook() {
  const result = { current: undefined as unknown as Pings };
  function Probe() {
    result.current = usePings();
    return null;
  }
  const { unmount } = render(createElement(Probe));
  return { result, unmount };
}

describe('pingPoint', () => {
  it('reads the point of a ping event, and nothing from a malformed one or another event', () => {
    expect(pingPoint(ping(1.5, -2))).toEqual({ x: 1.5, y: -2 });
    for (const payload of [{ x: 1 }, { x: '1', y: 2 }, { x: Number.NaN, y: 2 }, { x: 1, y: Infinity }]) {
      expect(pingPoint({ type: 'ping', version: 1, payload }), JSON.stringify(payload)).toBeUndefined();
    }
    expect(pingPoint({ type: 'ruler.cleared', version: 1, payload: {} })).toBeUndefined();
  });
});

describe('usePings', () => {
  it('draws each ping for PING_MS, each on its own clock, and a ping at the same point twice twice', () => {
    vi.useFakeTimers();
    const { result } = renderHook();
    act(() => result.current.onEvent(ping(1, 1)));
    act(() => {
      vi.advanceTimersByTime(PING_MS / 2);
    });
    act(() => result.current.onEvent(ping(1, 1, 2)));
    expect(result.current.pings.map(({ x, y }) => [x, y])).toEqual([
      [1, 1],
      [1, 1],
    ]);
    expect(new Set(result.current.pings.map((each) => each.key)).size).toBe(2);
    act(() => {
      vi.advanceTimersByTime(PING_MS / 2 - 1);
    });
    expect(result.current.pings).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.pings).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(PING_MS / 2);
    });
    expect(result.current.pings).toEqual([]);
  });

  it('keeps the latest MAX_PINGS of a burst, ignores other events, and lets all go on clear', () => {
    vi.useFakeTimers();
    const { result } = renderHook();
    act(() => {
      for (let n = 0; n < MAX_PINGS + 3; n++) result.current.onEvent(ping(n, 0, n + 1));
      result.current.onEvent({ type: 'token.removed', version: 99, payload: { id: 'x' } });
    });
    expect(result.current.pings.map((each) => each.x)).toEqual(
      Array.from({ length: MAX_PINGS }, (_, index) => index + 3),
    );
    act(() => result.current.clear());
    expect(result.current.pings).toEqual([]);
    // The timers of pings let go change nothing when they run.
    act(() => {
      vi.advanceTimersByTime(PING_MS);
    });
    expect(result.current.pings).toEqual([]);
  });

  it('stops its timers when the view goes', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook();
    act(() => result.current.onEvent(ping(1, 1)));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
