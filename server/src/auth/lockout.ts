// Guessing protection for PIN entry (specs/07-security-and-access.md §6, Q-009, Q-097, Q-098):
// after 5 failed attempts from one client address, PIN entry from that address is
// refused for 1 minute, and the lockout doubles on each further run of 5 failures.
// Beside it, a budget for the whole server: after 20 failed attempts from any addresses
// but the server machine's own within 10 minutes, PIN entry is paused for every address
// but loopback for 10 minutes, doubling on each further run, so that a device changing its
// address gets no fresh guesses (G-010). A second budget of 100 such failures within 24 hours
// pauses PIN entry in the same way, with one run count for both, so that a device keeping just
// under 20 per 10 minutes is paused too (Q-098). An IPv6 address counts by its /64, since one
// device can take any address of its prefix.
//
// An attempt is counted as a failure when it starts, before the PIN is hashed,
// and forgiven if the PIN turns out right. Otherwise a burst of parallel guesses
// would all pass the check while the first ones were still being hashed.

export const FAILURES_PER_LOCKOUT = 5;
export const FIRST_LOCKOUT_MS = 60_000;
// Bounds the memory a client cycling through addresses can take; the oldest entry goes first.
export const MAX_TRACKED_ADDRESSES = 10_000;
// 2^30 minutes is two thousand years; past it the lockout stops growing, not shrinking.
const MAX_DOUBLINGS = 30;

export const GLOBAL_FAILURES_PER_PAUSE = 20;
export const GLOBAL_WINDOW_MS = 10 * 60_000;
export const FIRST_PAUSE_MS = 10 * 60_000;
export const DAILY_FAILURES_PER_PAUSE = 100;
export const DAILY_WINDOW_MS = 24 * 60 * 60_000;

/** A pause of PIN entry for every address but loopback, started by the attempt that returned it. */
export interface Pause {
  ms: number;
  /** Which budget it was: 20 failures within 10 minutes, or 100 within 24 hours. */
  budget: '10m' | '24h';
  /** The client addresses of the failures that made it, each once. */
  addresses: string[];
}

export type AttemptStart =
  | { allowed: true; failures: number; lockedMs: number | null; paused: Pause | null }
  | { allowed: false; retryAfterMs: number };

export interface Lockout {
  /**
   * Starts an attempt from `address`: refused while it is locked out, else counted
   * as a failure at once. `lockedMs` is set when this attempt started a lockout.
   */
  begin(address: string): AttemptStart;
  /** The attempt's PIN was right: the address starts afresh, and its failure leaves the server's budget. */
  succeeded(address: string): void;
}

interface Failure {
  key: string;
  address: string;
  time: number;
}

interface Entry {
  failures: number;
  lockouts: number;
  lockedUntil: number;
}

export function lockoutDuration(lockouts: number): number {
  return FIRST_LOCKOUT_MS * 2 ** Math.min(lockouts - 1, MAX_DOUBLINGS);
}

export function pauseDuration(pauses: number): number {
  return FIRST_PAUSE_MS * 2 ** Math.min(pauses - 1, MAX_DOUBLINGS);
}

/**
 * `address` is a normalised client address (normalizeAddress). The server machine is never
 * paused and its failures do not count towards the budget: the DM can always sign in there.
 */
export function createLockout(now: () => number = Date.now): Lockout {
  const entries = new Map<string, Entry>();
  // Each budget's failures within its window, oldest first. A pause empties the 10-minute
  // window; the day's window only when the day's budget opened it, since the failures before a
  // 10-minute pause are still guesses made that day. So they are at most 20 and 100 long.
  let window: Failure[] = [];
  let day: Failure[] = [];
  let pauses = 0;
  let pausedUntil = 0;
  return {
    begin(address) {
      const time = now();
      const key = lockoutKey(address);
      const counted = !isLoopback(address);
      let entry = entries.get(key);
      const lockedFor = entry && time < entry.lockedUntil ? entry.lockedUntil - time : 0;
      const pausedFor = counted && time < pausedUntil ? pausedUntil - time : 0;
      // Refused without counting; the answer names the longer wait.
      if (lockedFor > 0 || pausedFor > 0) return { allowed: false, retryAfterMs: Math.max(lockedFor, pausedFor) };
      if (!entry) {
        if (entries.size >= MAX_TRACKED_ADDRESSES) entries.delete(entries.keys().next().value!);
        entry = { failures: 0, lockouts: 0, lockedUntil: 0 };
        entries.set(key, entry);
      }
      entry.failures++;
      let lockedMs: number | null = null;
      if (entry.failures % FAILURES_PER_LOCKOUT === 0) {
        entry.lockouts++;
        lockedMs = lockoutDuration(entry.lockouts);
        entry.lockedUntil = time + lockedMs;
      }
      let paused: Pause | null = null;
      if (counted) {
        const failure = { key, address, time };
        window = window.filter((earlier) => time - earlier.time < GLOBAL_WINDOW_MS);
        window.push(failure);
        day = day.filter((earlier) => time - earlier.time < DAILY_WINDOW_MS);
        day.push(failure);
        // Both budgets may be spent by one attempt; it opens one pause, named after the day's.
        const opener =
          day.length >= DAILY_FAILURES_PER_PAUSE ? day : window.length >= GLOBAL_FAILURES_PER_PAUSE ? window : null;
        if (opener) {
          pauses++;
          paused = {
            ms: pauseDuration(pauses),
            budget: opener === day ? '24h' : '10m',
            addresses: [...new Set(opener.map((earlier) => earlier.address))],
          };
          pausedUntil = time + paused.ms;
          window = [];
          if (opener === day) day = [];
        }
      }
      return { allowed: true, failures: entry.failures, lockedMs, paused };
    },
    succeeded(address) {
      const key = lockoutKey(address);
      entries.delete(key);
      // Its own failure, counted when it started. A pause it completed stays: the wrong PINs came first.
      for (const budget of [window, day]) {
        const last = budget.findLastIndex((failure) => failure.key === key);
        if (last >= 0) budget.splice(last, 1);
      }
    },
  };
}

/**
 * What the limits count an address by: an IPv4 address itself, an IPv6 address by its /64
 * (specs/07-security-and-access.md §6, Q-097). Anything unparsable counts as itself.
 */
export function lockoutKey(address: string): string {
  if (!address.includes(':') || isLoopback(address)) return address;
  const groups = ipv6Groups(address);
  return groups ? `${groups.slice(0, 4).join(':')}::/64` : address;
}

/** The eight groups of an IPv6 address, lower-case without leading zeros, or null. */
function ipv6Groups(address: string): string[] | null {
  let text = address.toLowerCase().split('%', 1)[0]!;
  // A trailing dotted IPv4 part is two groups.
  const dotted = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (dotted) {
    const bytes = dotted.slice(2).map(Number);
    if (bytes.some((byte) => byte > 255)) return null;
    text = `${dotted[1]}${((bytes[0]! << 8) | bytes[1]!).toString(16)}:${((bytes[2]! << 8) | bytes[3]!).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const part = (half: string | undefined): string[] => (half ? half.split(':') : []);
  const head = part(halves[0]);
  const tail = part(halves[1]);
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 1 ? 0 : missing).fill('0'), ...tail];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => parseInt(group, 16).toString(16));
}

/** The address as one spelling: an IPv4 client reached over IPv6 is still that IPv4 address. */
export function normalizeAddress(address: string | undefined): string {
  if (!address) return 'unknown';
  const lower = address.toLowerCase();
  return lower.startsWith('::ffff:') && lower.includes('.') ? lower.slice(7) : lower;
}

/** The server machine itself: 127.0.0.0/8 or ::1 (specs/07-security-and-access.md §1). */
export function isLoopback(address: string): boolean {
  return address === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address);
}
