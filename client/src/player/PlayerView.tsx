import { MapCanvas } from '../canvas/MapCanvas.js';
import type { CanvasToken } from '../canvas/tokens.js';
import { IdleScreen } from '../ui/IdleScreen.js';
import { useIdleCursor } from './useIdleCursor.js';
import { usePlayerLive } from './usePlayerLive.js';
import './player.css';

// How long the pointer stays still before the TV hides it (specs/08-ux-journeys.md §9, Q-054).
export const CURSOR_IDLE_MS = 2_000;

// Player view at / (FND-04, LIV-01, LIV-03): the dark idle screen with the product name while
// nothing is live (specs/08-ux-journeys.md §4, Q-025), and the live scene once one is, drawn by
// the map canvas in its player mode (D-090): the map's display version, fitted to it
// (specs/04-live-sync.md §9, Q-038), the grid only when players see it (§4), and the visible
// tokens with their labels (Q-032). It has no controls and nothing that takes focus, and hides
// the pointer after two seconds still (Q-054). It keeps the live connection, reconnecting by
// itself and resynchronising from a fresh snapshot (§5, §6); meanwhile it keeps its last picture
// and says nothing, since nobody operates the TV (D-104). The data attributes are for the
// end-to-end tests: the connection state, how many snapshots arrived and whether a scene is drawn.
export function PlayerView() {
  const live = usePlayerLive();
  const cursorHidden = useIdleCursor(CURSOR_IDLE_MS);
  const scene = live.scene ?? null;
  const tokens: CanvasToken[] = scene?.tokens.map((token) => ({ ...token, hidden: false })) ?? [];
  return (
    <main
      data-view="player"
      data-live={live.status}
      data-snapshots={live.snapshots}
      data-scene={scene ? 'live' : 'idle'}
      data-cursor={cursorHidden ? 'hidden' : 'shown'}
    >
      {scene ? <MapCanvas mode="player" map={scene.map} grid={scene.grid} tokens={tokens} /> : <IdleScreen />}
    </main>
  );
}
