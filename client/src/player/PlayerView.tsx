import { useEffect, useState } from 'react';
import { MapCanvas } from '../canvas/MapCanvas.js';
import type { CanvasToken } from '../canvas/tokens.js';
import { Icon } from '../ui/icons.js';
import { IdleScreen } from '../ui/IdleScreen.js';
import { CURSOR_IDLE_MS, useIdleCursor } from '../ui/useIdleCursor.js';
import { InitiativeStrip } from './InitiativeStrip.js';
import { usePlayerLive } from './usePlayerLive.js';

export { CURSOR_IDLE_MS };

/**
 * How much larger than the DM view's the TV draws labels and badges (UIX-01, specs/08-ux-journeys.md
 * §11): the design's size on a 1080-line screen, in proportion to the screen's height, never below what
 * reads from 2–3 m on a 720-line TV.
 */
export function labelScaleFor(height: number): number {
  return Math.max(1.6, (2.55 * height) / 1080);
}

function useLabelScale(): number {
  const [scale, setScale] = useState(() => labelScaleFor(window.innerHeight));
  useEffect(() => {
    const onResize = () => setScale(labelScaleFor(window.innerHeight));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return scale;
}

// Player view at / (FND-04, LIV-01, LIV-03, UIX-01): the idle screen while nothing is live
// (specs/08-ux-journeys.md §4, Q-025, Q-100), and the live scene once one is, drawn by the map canvas in
// its player mode (D-090): the map's display version, framed by the player camera the DM steers, fitted to
// the map on every activation (specs/04-live-sync.md §9, Q-038, LIV-06), the grid only when players see it
// (§4), the visible tokens with their labels (Q-032), sized to be read across a room, and the measurement
// the DM shows on the live scene, a line and its distance (specs/04-live-sync.md §11, Q-027, LIV-07), and the
// DM's pings, each for a moment (§12, TBL-01), and the fog: the painted fog drawn opaque over the map, soft at
// the edge (§13, TBL-04). Over
// it a subtle vignette and, at the bottom left, the scene's name, which fades after a few seconds; changes
// between idle and live, and between scenes, fade (specs/08-ux-journeys.md §11). It has no controls and
// nothing that takes focus, and hides the pointer after two seconds still (Q-054). It keeps the live
// connection, reconnecting by itself and resynchronising from a fresh snapshot (§5, §6); meanwhile it
// keeps its last picture and says nothing, since nobody operates the TV (D-104). The data attributes are
// for the end-to-end tests: the connection state, how many snapshots arrived and whether a scene is drawn.
export function PlayerView() {
  const live = usePlayerLive();
  const cursorHidden = useIdleCursor(CURSOR_IDLE_MS);
  const labelScale = useLabelScale();
  const scene = live.scene ?? null;
  const tokens: CanvasToken[] = scene?.tokens.map((token) => ({ ...token, hidden: false })) ?? [];
  // What counts as another scene for the fade and the name plate: players are told no scene id.
  const identity = scene ? `${scene.name}\u0000${scene.map?.id ?? 'none'}` : 'idle';
  return (
    <main
      data-view="player"
      data-live={live.status}
      data-snapshots={live.snapshots}
      data-scene={scene ? 'live' : 'idle'}
      data-cursor={cursorHidden ? 'hidden' : 'shown'}
    >
      <div key={identity} className="eg-player__fade">
        {scene ? (
          <>
            <MapCanvas
              mode="player"
              map={scene.map}
              grid={scene.grid}
              tokens={tokens}
              camera={scene.camera}
              ruler={{ shown: scene.ruler }}
              ping={{ shown: live.pings }}
              fog={{ fog: scene.fog }}
              labelScale={labelScale}
            />
            <div className="eg-player__vignette" aria-hidden="true" />
            <p className="eg-player__plate">
              <span className="eg-player__plate-logo" aria-hidden="true">
                <Icon name="logo" size={26} />
              </span>
              <span className="eg-player__plate-name">{scene.name}</span>
            </p>
            <InitiativeStrip encounter={scene.encounter} tokens={scene.tokens} />
          </>
        ) : (
          <IdleScreen />
        )}
      </div>
    </main>
  );
}
