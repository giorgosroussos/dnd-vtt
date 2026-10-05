import { useRef, type PointerEvent } from 'react';
import { pan, pinch, TOUCH_IDENTITY, TOUCH_MAX_ZOOM, type TouchView } from './touchView.js';

// The gestures of a handheld's player view (UXR-05, specs/08-ux-journeys.md §14, Q-125): two fingers pinch to zoom
// around their midpoint, one finger drags to pan, a double tap returns to the DM's camera. Read from pointer events on
// the canvas's element, whose `touch-action: none` keeps the browser from zooming the page; nothing is sent.

/** Two taps this close in time and place are a double tap. */
export const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;

type Point = { x: number; y: number };

export function useTouchGestures(
  touch: { view: TouchView; onView: (view: TouchView) => void; min: number } | undefined,
) {
  const pointers = useRef(new Map<number, Point>());
  const lastTap = useRef<{ at: Point; time: number }>(undefined);
  if (!touch) return {};

  const local = (event: PointerEvent<HTMLElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const release = (event: PointerEvent<HTMLElement>) => {
    pointers.current.delete(event.pointerId);
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      const at = local(event);
      // Kept on the map when a finger slides off it; a pointer the browser no longer knows is refused, which costs
      // nothing but the capture.
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // Not captured.
      }
      pointers.current.set(event.pointerId, at);
      if (pointers.current.size !== 1) return;
      const tap = lastTap.current;
      const now = event.timeStamp;
      if (tap && now - tap.time < DOUBLE_TAP_MS && Math.hypot(at.x - tap.at.x, at.y - tap.at.y) < DOUBLE_TAP_PX) {
        lastTap.current = undefined;
        touch.onView(TOUCH_IDENTITY);
        return;
      }
      lastTap.current = { at, time: now };
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = touch;
      const before = pointers.current.get(event.pointerId);
      if (!before) return;
      const at = local(event);
      if (pointers.current.size === 1) {
        pointers.current.set(event.pointerId, at);
        current.onView(pan(current.view, at.x - before.x, at.y - before.y));
        return;
      }
      const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1];
      pointers.current.set(event.pointerId, at);
      if (!other) return;
      const was = Math.hypot(before.x - other.x, before.y - other.y);
      const now = Math.hypot(at.x - other.x, at.y - other.y);
      if (was < 1) return;
      // The midpoint moves too: a pinch also pans with the fingers.
      const moved = pan(current.view, (at.x - before.x) / 2, (at.y - before.y) / 2);
      const focus = { x: (at.x + other.x) / 2, y: (at.y + other.y) / 2 };
      current.onView(pinch(moved, focus, now / was, current.min, TOUCH_MAX_ZOOM));
    },
    onPointerUp: release,
    onPointerCancel: release,
  };
}
