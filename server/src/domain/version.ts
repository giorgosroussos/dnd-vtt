// The live event version counter (specs/04-live-sync.md §5, D-017, Q-056): one per
// server process, held in memory, starting at 1. Every event emitted for the live
// scene takes the next value; a client that sees a gap asks for a snapshot.
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

/** The process's counter. Only the code that emits live events calls `next()`. */
export const liveVersion: VersionCounter = createVersionCounter();
