import { useEffect, useState } from 'react';
import type { PlayerSnapshot } from '@emberglass/shared';
import { connectLive, type LiveStatus } from '../live/connection.js';
import { applyPlayerEvent, fromSnapshot, type PlayerScene } from './scene.js';

/** How long the window must keep its size before it is reported: a resize fires many events. */
export const VIEWPORT_SETTLE_MS = 250;

export interface PlayerLive {
  status: LiveStatus;
  /** What to draw: undefined until the first snapshot, null while nothing is live. */
  scene: PlayerScene | undefined;
  /** How many snapshots arrived: one per connection, per gap and per activation. */
  snapshots: number;
}

// The player view's live connection (LIV-01, LIV-03; specs/04-live-sync.md §5, §6, D-104, D-105):
// a snapshot replaces the scene, and each players' event that is exactly the next version is
// applied to it (scene.ts). The connection hands the player view players' snapshots only, so a DM
// snapshot is never drawn (D-105). While reconnecting the last picture stays. The window's size is
// reported to the server, at once and after each resize settles, so the DM's TV frame has this
// screen's shape (LIV-06, D-119).
export function usePlayerLive(): PlayerLive {
  const [state, setState] = useState<PlayerLive>({ status: 'connecting', scene: undefined, snapshots: 0 });
  useEffect(() => {
    const connection = connectLive('player', {
      onStatus: (status) => setState((current) => ({ ...current, status })),
      onSnapshot: (snapshot) =>
        setState((current) => ({
          ...current,
          scene: fromSnapshot(snapshot as PlayerSnapshot),
          snapshots: current.snapshots + 1,
        })),
      onEvent: (event) =>
        setState((current) =>
          current.scene === undefined ? current : { ...current, scene: applyPlayerEvent(current.scene, event) },
        ),
    });
    const report = () => connection.reportViewport({ width: window.innerWidth, height: window.innerHeight });
    report();
    let settling: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(settling);
      settling = setTimeout(report, VIEWPORT_SETTLE_MS);
    };
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(settling);
      window.removeEventListener('resize', onResize);
      connection.close();
    };
  }, []);
  return state;
}
