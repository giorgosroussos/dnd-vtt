import type { Camera } from '../canvas/geometry.js';

// A handheld screen's own view of the live scene (UXR-05, specs/08-ux-journeys.md §14, Q-125): a zoom and an offset
// in screen pixels laid over the camera the DM steers, so that a pinch and a drag look around on that screen only
// and send nothing. The identity is the DM's camera itself.

export interface TouchView {
  /** How much larger than the DM's camera the screen draws. */
  zoom: number;
  /** Where the zoomed picture moved, in screen pixels. */
  x: number;
  y: number;
}

export const TOUCH_IDENTITY: TouchView = { zoom: 1, x: 0, y: 0 };
/** As far as a pinch zooms in, from the DM's camera. */
export const TOUCH_MAX_ZOOM = 8;

export const isIdentity = (view: TouchView): boolean => view.zoom === 1 && view.x === 0 && view.y === 0;

/** The camera drawn: the DM's, under the screen's own view. */
export const compose = (camera: Camera, view: TouchView): Camera => ({
  scale: camera.scale * view.zoom,
  x: camera.x * view.zoom + view.x,
  y: camera.y * view.zoom + view.y,
});

/** A pinch by `factor` around `focus` (screen pixels), zoom bounded to `[min, max]`. */
export function pinch(view: TouchView, focus: { x: number; y: number }, factor: number, min: number, max: number) {
  const zoom = Math.min(max, Math.max(min, view.zoom * factor));
  const applied = zoom / view.zoom;
  return { zoom, x: focus.x - applied * (focus.x - view.x), y: focus.y - applied * (focus.y - view.y) };
}

export const pan = (view: TouchView, dx: number, dy: number): TouchView => ({
  ...view,
  x: view.x + dx,
  y: view.y + dy,
});

/**
 * The view kept so that the map is never lost: the screen's centre stays over the map, and the zoom stays between
 * the whole map (`min`) and `max`. Zoomed back to the DM's camera and centred on it, it is the identity again.
 */
export function bounded(
  view: TouchView,
  camera: Camera,
  world: { width: number; height: number },
  viewport: { width: number; height: number },
  min: number,
  max = TOUCH_MAX_ZOOM,
): TouchView {
  const zoom = Math.min(max, Math.max(min, view.zoom));
  const drawn = compose(camera, { ...view, zoom });
  const centre = { x: viewport.width / 2, y: viewport.height / 2 };
  const left = drawn.x;
  const top = drawn.y;
  const right = drawn.x + world.width * drawn.scale;
  const bottom = drawn.y + world.height * drawn.scale;
  const dx = centre.x < left ? centre.x - left : centre.x > right ? centre.x - right : 0;
  const dy = centre.y < top ? centre.y - top : centre.y > bottom ? centre.y - bottom : 0;
  const next = { zoom, x: view.x + dx, y: view.y + dy };
  return Math.abs(next.zoom - 1) < 1e-6 && Math.abs(next.x) < 0.5 && Math.abs(next.y) < 0.5 ? TOUCH_IDENTITY : next;
}
