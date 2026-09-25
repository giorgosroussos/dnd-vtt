import { useEffect, useState } from 'react';
import type { SceneSnapshot } from '@emberglass/shared';
import { connectLive, type LiveStatus } from './connection.js';

export interface LiveState {
  status: LiveStatus;
  /** The latest snapshot for this browser's room, once one arrived. */
  snapshot: SceneSnapshot | undefined;
  /** How many snapshots arrived: each connection brings one, and each gap another. */
  snapshots: number;
}

// Keeps the live connection open while the component is mounted (LIV-01, specs/04-live-sync.md §5,
// §6). Events after a snapshot (LIV-02 onward) are applied by the packages that define them.
export function useLive(): LiveState {
  const [state, setState] = useState<LiveState>({ status: 'connecting', snapshot: undefined, snapshots: 0 });
  useEffect(
    () =>
      connectLive({
        onStatus: (status) => setState((current) => ({ ...current, status })),
        onSnapshot: (snapshot) => setState((current) => ({ ...current, snapshot, snapshots: current.snapshots + 1 })),
        onEvent: () => {},
      }),
    [],
  );
  return state;
}
