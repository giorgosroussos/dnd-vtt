// A limit on how many rejected-request lines reach the log (G-006, D-076). Without
// it, a LAN client sending rejected requests in a loop fills the log file and its
// three predecessors and rotates away the failed-PIN and lockout lines that
// specs/07-security-and-access.md §8 wants kept. Within each window, each client
// address gets `perAddress` lines and all of them together `total`; the rest are
// counted, and one summary line per window says how many were dropped and from
// which addresses. Failed PIN attempts and lockouts are not limited here: the
// lockout itself bounds them to 5 per locked period per address.

export interface LineLimiterOptions {
  perAddress?: number;
  total?: number;
  windowMs?: number;
  /** Called once per window in which lines were dropped, when that window ends. */
  onDropped: (dropped: number, addresses: { address: string; dropped: number }[]) => void;
  now?: () => number;
  /** Runs `run` after `ms`; the default timer never keeps the process alive. */
  schedule?: (run: () => void, ms: number) => void;
}

export interface LineLimiter {
  admit(address: string): boolean;
  /** Ends the current window now, reporting what it dropped. */
  flush(): void;
}

export const REJECTED_LINES_PER_ADDRESS = 20;
export const REJECTED_LINES_TOTAL = 100;
export const REJECTED_LINES_WINDOW_MS = 60_000;
// Addresses a summary names; the rest are counted under the total only.
const MAX_NAMED = 5;
const MAX_TRACKED = 10_000;

const unrefTimer = (run: () => void, ms: number): void => {
  setTimeout(run, ms).unref();
};

export function createLineLimiter(options: LineLimiterOptions): LineLimiter {
  const {
    perAddress = REJECTED_LINES_PER_ADDRESS,
    total = REJECTED_LINES_TOTAL,
    windowMs = REJECTED_LINES_WINDOW_MS,
    onDropped,
    now = Date.now,
    schedule = unrefTimer,
  } = options;
  let windowStart = -Infinity;
  let admitted = 0;
  let dropped = 0;
  let summaryScheduled = false;
  const perWindow = new Map<string, { admitted: number; dropped: number }>();

  const flush = (): void => {
    if (dropped > 0) {
      const addresses = [...perWindow.entries()]
        .filter(([, counts]) => counts.dropped > 0)
        .sort((a, b) => b[1].dropped - a[1].dropped)
        .slice(0, MAX_NAMED)
        .map(([address, counts]) => ({ address, dropped: counts.dropped }));
      onDropped(dropped, addresses);
    }
    windowStart = -Infinity;
    admitted = 0;
    dropped = 0;
    summaryScheduled = false;
    perWindow.clear();
  };

  return {
    admit(address) {
      const time = now();
      if (time - windowStart >= windowMs) {
        flush();
        windowStart = time;
      }
      let counts = perWindow.get(address);
      if (!counts && perWindow.size < MAX_TRACKED) {
        counts = { admitted: 0, dropped: 0 };
        perWindow.set(address, counts);
      }
      if (counts && counts.admitted < perAddress && admitted < total) {
        counts.admitted++;
        admitted++;
        return true;
      }
      if (counts) counts.dropped++;
      dropped++;
      if (!summaryScheduled) {
        summaryScheduled = true;
        const start = windowStart;
        schedule(
          () => {
            if (windowStart === start) flush();
          },
          Math.max(0, start + windowMs - time),
        );
      }
      return false;
    },
    flush,
  };
}
