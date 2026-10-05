import { useEffect, useRef, useState } from 'react';
import { MapCanvas } from '../canvas/MapCanvas.js';
import type { CanvasToken } from '../canvas/tokens.js';
import { Icon } from '../ui/icons.js';
import { Logo } from '../ui/Logo.js';
import { IdleScreen } from '../ui/IdleScreen.js';
import { t } from '../ui/messages.js';
import { CURSOR_IDLE_MS, useIdleCursor } from '../ui/useIdleCursor.js';
import { InitiativeStrip } from './InitiativeStrip.js';
import { isIdentity, TOUCH_IDENTITY, type TouchView } from './touchView.js';
import { canFullscreen, fullscreenElement, toggleFullscreen, useHandheld } from './useHandheld.js';
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

/**
 * The same on a handheld (UXR-05): read at arm's length, not across a room, so in proportion to the screen's
 * shorter side, portrait or landscape, and never below the DM view's own size.
 */
export function handheldLabelScaleFor(width: number, height: number): number {
  return Math.max(1, (2.55 * Math.min(width, height)) / 1080);
}

function useLabelScale(handheld: boolean): number {
  const scaleNow = () =>
    handheld ? handheldLabelScaleFor(window.innerWidth, window.innerHeight) : labelScaleFor(window.innerHeight);
  const [scale, setScale] = useState(scaleNow);
  useEffect(() => {
    const onResize = () => setScale(scaleNow());
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scaleNow reads only `handheld`.
  }, [handheld]);
  return scale;
}

/** How long the handheld's buttons stay after the last touch (UXR-05). */
export const CONTROLS_IDLE_MS = 3_000;

// The handheld's buttons show on a touch and fade a few seconds after the last one.
function useShownOnTouch(enabled: boolean): boolean {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    let timer = setTimeout(() => setShown(false), CONTROLS_IDLE_MS);
    const touched = () => {
      clearTimeout(timer);
      setShown(true);
      timer = setTimeout(() => setShown(false), CONTROLS_IDLE_MS);
    };
    window.addEventListener('pointerdown', touched);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', touched);
    };
  }, [enabled]);
  return shown;
}

function useFullscreen(): boolean {
  const [on, setOn] = useState(() => fullscreenElement() !== null);
  useEffect(() => {
    const changed = () => setOn(fullscreenElement() !== null);
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('webkitfullscreenchange', changed);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      document.removeEventListener('webkitfullscreenchange', changed);
    };
  }, []);
  return on;
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
// nothing that takes focus, and hides the pointer after two seconds still (Q-054). On a handheld, a phone or a
// tablet (UXR-05, specs/08-ux-journeys.md §14, Q-125), and only there, it has a fullscreen button where the browser
// can, and the screen's own pinch zoom and pan over the DM's camera, returned to it by a button shown while zoomed,
// a double tap and every activation; it sends nothing either way. It keeps the live
// connection, reconnecting by itself and resynchronising from a fresh snapshot (§5, §6); meanwhile it
// keeps its last picture and says nothing, since nobody operates the TV (D-104). The data attributes are
// for the end-to-end tests: the connection state, how many snapshots arrived and whether a scene is drawn.
export function PlayerView() {
  const live = usePlayerLive();
  const cursorHidden = useIdleCursor(CURSOR_IDLE_MS);
  const handheld = useHandheld();
  const labelScale = useLabelScale(handheld);
  const controlsShown = useShownOnTouch(handheld);
  const fullscreen = useFullscreen();
  const main = useRef<HTMLElement>(null);
  const scene = live.scene ?? null;
  const tokens: CanvasToken[] = scene?.tokens.map((token) => ({ ...token, hidden: false })) ?? [];
  // What counts as another scene for the fade and the name plate: players are told no scene id.
  const identity = scene ? `${scene.name}\u0000${scene.map?.id ?? 'none'}` : 'idle';
  // The handheld's own view, kept for the scene it was made on: another scene going live starts at the DM's camera.
  const viewKey = identity;
  const [touch, setTouch] = useState<{ key: string; view: TouchView }>({ key: viewKey, view: TOUCH_IDENTITY });
  const touchView = touch.key === viewKey ? touch.view : TOUCH_IDENTITY;
  const zoomed = !isIdentity(touchView);
  return (
    <main
      ref={main}
      data-view="player"
      data-handheld={handheld || undefined}
      data-zoomed={zoomed || undefined}
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
              touch={handheld ? { view: touchView, onView: (view) => setTouch({ key: viewKey, view }) } : undefined}
            />
            <div className="eg-player__vignette" aria-hidden="true" />
            <p className="eg-player__plate">
              <span className="eg-player__plate-logo" aria-hidden="true">
                <Logo size={26} />
              </span>
              <span className="eg-player__plate-name">{scene.name}</span>
            </p>
            <InitiativeStrip encounter={scene.encounter} tokens={scene.tokens} />
          </>
        ) : (
          <IdleScreen />
        )}
      </div>
      {handheld ? (
        <div
          className={controlsShown || zoomed ? 'eg-player__controls' : 'eg-player__controls eg-player__controls--faded'}
        >
          {zoomed ? (
            <button
              type="button"
              className="eg-player__control"
              aria-label={t('player.reset')}
              onClick={() => setTouch({ key: viewKey, view: TOUCH_IDENTITY })}
            >
              <Icon name="reset" size={20} />
            </button>
          ) : null}
          {canFullscreen() ? (
            <button
              type="button"
              className="eg-player__control"
              aria-label={fullscreen ? t('player.exitFullscreen') : t('player.fullscreen')}
              aria-pressed={fullscreen}
              onClick={() => main.current && toggleFullscreen(main.current)}
            >
              <Icon name={fullscreen ? 'minimize' : 'maximize'} size={20} />
            </button>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
