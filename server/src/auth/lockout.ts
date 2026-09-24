// Guessing protection for PIN entry (specs/07-security-and-access.md §6, Q-009):
// after 5 failed attempts from one client address, PIN entry from that address is
// refused for 1 minute, and the lockout doubles on each further run of 5 failures.
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

export type AttemptStart =
  { allowed: true; failures: number; lockedMs: number | null } | { allowed: false; retryAfterMs: number };

export interface Lockout {
  /**
   * Starts an attempt from `address`: refused while it is locked out, else counted
   * as a failure at once. `lockedMs` is set when this attempt started a lockout.
   */
  begin(address: string): AttemptStart;
  /** The attempt's PIN was right: the address starts afresh. */
  succeeded(address: string): void;
}

interface Entry {
  failures: number;
  lockouts: number;
  lockedUntil: number;
}

export function lockoutDuration(lockouts: number): number {
  return FIRST_LOCKOUT_MS * 2 ** Math.min(lockouts - 1, MAX_DOUBLINGS);
}

export function createLockout(now: () => number = Date.now): Lockout {
  const entries = new Map<string, Entry>();
  return {
    begin(address) {
      const time = now();
      let entry = entries.get(address);
      if (entry && time < entry.lockedUntil) return { allowed: false, retryAfterMs: entry.lockedUntil - time };
      if (!entry) {
        if (entries.size >= MAX_TRACKED_ADDRESSES) entries.delete(entries.keys().next().value!);
        entry = { failures: 0, lockouts: 0, lockedUntil: 0 };
        entries.set(address, entry);
      }
      entry.failures++;
      let lockedMs: number | null = null;
      if (entry.failures % FAILURES_PER_LOCKOUT === 0) {
        entry.lockouts++;
        lockedMs = lockoutDuration(entry.lockouts);
        entry.lockedUntil = time + lockedMs;
      }
      return { allowed: true, failures: entry.failures, lockedMs };
    },
    succeeded(address) {
      entries.delete(address);
    },
  };
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
