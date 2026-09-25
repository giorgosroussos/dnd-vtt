import type { Room } from '@emberglass/shared';

// The live event version counters (specs/04-live-sync.md §5, Q-056, Q-093, D-108): one per
// room per server process, held in memory, starting at 1. Every event emitted to a room
// takes the next value of that room's counter; a client that sees a gap asks for a
// snapshot. The players room's counter counts only what players receive, so an event
// about a hidden token leaves no hole in their sequence (specs/04-live-sync.md §4).
export interface VersionCounter {
  /** Take the next version: 1 the first time, then strictly ascending. */
  next(): number;
  /** The last version taken, 0 before the first. */
  current(): number;
}

export function createVersionCounter(): VersionCounter {
  let last = 0;
  return {
    next: () => ++last,
    current: () => last,
  };
}

export type VersionCounters = Record<Room, VersionCounter>;

export function createVersionCounters(): VersionCounters {
  return { dm: createVersionCounter(), players: createVersionCounter() };
}

/** The process's counters. Only the code that emits live events calls `next()`. */
export const liveVersions: VersionCounters = createVersionCounters();
