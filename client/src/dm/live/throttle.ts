// The sending of Follow my view (DMT-03, specs/04-live-sync.md §9, Q-113), free of React: the DM's view
// changes at every frame of a pan or a zoom, and the TV camera follows it at most once per interval. The
// first change after a quiet interval goes at once (leading), the latest change during the interval goes
// when it ends (trailing), so the camera sent last is always the one the DM stopped on. A value equal to
// the one sent last is not sent: the server would ignore it anyway (`sameCamera`).

/** How often Follow my view sends the TV camera: about ten times a second. */
export const FOLLOW_INTERVAL_MS = 100;

export interface Throttle<T> {
  /** A new value: sent now, or when the interval ends with the latest value then. */
  push: (value: T) => void;
  /** Drops the value waiting and forgets the one sent, so the next push goes at once. */
  cancel: () => void;
}

export function throttle<T>(send: (value: T) => void, intervalMs: number, same: (a: T, b: T) => boolean): Throttle<T> {
  let last: { value: T } | undefined;
  let waiting: { value: T } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const sendNow = (value: T) => {
    if (last && same(last.value, value)) return;
    last = { value };
    send(value);
    timer = setTimeout(flush, intervalMs);
  };
  const flush = () => {
    timer = undefined;
    const next = waiting;
    waiting = undefined;
    if (next) sendNow(next.value);
  };

  return {
    push: (value) => {
      if (timer !== undefined) waiting = { value };
      else sendNow(value);
    },
    cancel: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      waiting = undefined;
      last = undefined;
    },
  };
}
