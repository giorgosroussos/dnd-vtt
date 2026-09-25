// Gap detection for the live events (specs/04-live-sync.md §5, D-017, D-104). A snapshot sets
// the version the client holds; an event applies only when it is exactly the next one. Anything
// else, a version skipped or one lower than the last (the server restarted), is a gap: the client
// asks for a fresh snapshot and ignores events until it arrives, since the snapshot contains them.

export type Verdict = 'apply' | 'gap' | 'wait';

export interface VersionTracker {
  /** A snapshot of `version` replaced the client's state. */
  snapshot(version: number): void;
  /** Judge an event: apply it, or a gap was found (ask for a snapshot), or one is awaited (drop it). */
  event(version: number): Verdict;
  /** The connection was lost: nothing is held until the next snapshot. */
  reset(): void;
  /** True between a gap or a reset and the snapshot that ends it. */
  readonly awaiting: boolean;
  /** The version the client holds, if any. */
  readonly version: number | undefined;
}

export function createVersionTracker(): VersionTracker {
  let last: number | undefined;
  let awaiting = true;
  return {
    snapshot(version) {
      last = version;
      awaiting = false;
    },
    event(version) {
      if (awaiting || last === undefined) return 'wait';
      if (version === last + 1) {
        last = version;
        return 'apply';
      }
      awaiting = true;
      return 'gap';
    },
    reset() {
      last = undefined;
      awaiting = true;
    },
    get awaiting() {
      return awaiting;
    },
    get version() {
      return last;
    },
  };
}
