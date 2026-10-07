import type { Point } from './tokens.js';

// When the pointer rests on a token long enough to mean it (UXR-06, specs/08-ux-journeys.md §14): the
// token's preview is asked for only after the pointer has stayed within REST_TOLERANCE_PX of one spot for
// PREVIEW_DELAY_MS. Any larger move starts the wait again, so a pointer sweeping across the map while the
// DM prepares a scene never opens one; leaving the token, pressing it, dragging, zooming or a tool taking
// over hides it at once.

/** How long the pointer must rest on a token before its preview shows. */
export const PREVIEW_DELAY_MS = 500;
/** How far the pointer may drift while resting, in screen pixels. */
export const REST_TOLERANCE_PX = 6;

export interface HoverIntent {
  /** The pointer came onto a token, or moved over it. */
  over: (id: string, at: Point) => void;
  /** The pointer left the token, pressed it or the map moved under it: no preview until it rests again. */
  cancel: () => void;
  /** The tokens there are now: one that went, deleted or hidden away, takes its wait and its preview with it. */
  keep: (ids: ReadonlySet<string>) => void;
  /** Stops the timer for good. */
  dispose: () => void;
}

export function createHoverIntent(
  onPreview: (id: string | undefined) => void,
  delayMs = PREVIEW_DELAY_MS,
): HoverIntent {
  let resting: { id: string; at: Point } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shown: string | undefined;
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const hide = () => {
    if (shown === undefined) return;
    shown = undefined;
    onPreview(undefined);
  };
  const wait = (id: string, at: Point) => {
    clear();
    resting = { id, at };
    timer = setTimeout(() => {
      timer = undefined;
      shown = id;
      onPreview(id);
    }, delayMs);
  };
  const cancel = () => {
    clear();
    resting = undefined;
    hide();
  };
  return {
    over: (id, at) => {
      if (resting?.id === id && Math.hypot(at.x - resting.at.x, at.y - resting.at.y) <= REST_TOLERANCE_PX) return;
      // A preview already shown stays while the pointer moves over its own token.
      if (shown === id) {
        resting = { id, at };
        return;
      }
      hide();
      wait(id, at);
    },
    cancel,
    keep: (ids) => {
      if ((resting !== undefined && !ids.has(resting.id)) || (shown !== undefined && !ids.has(shown))) cancel();
    },
    dispose: () => {
      clear();
      resting = undefined;
      shown = undefined;
    },
  };
}
