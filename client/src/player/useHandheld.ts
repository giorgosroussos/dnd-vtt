import { useEffect, useState } from 'react';

// A handheld screen (UXR-05, specs/08-ux-journeys.md §7, §14, Q-125): one whose primary pointer is coarse and cannot
// hover, a phone or a tablet. A TV, its remote's pointer and a desktop are not: they keep the player view without
// controls (Q-054).
export const HANDHELD_QUERY = '(pointer: coarse) and (hover: none)';

export const isHandheld = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia(HANDHELD_QUERY).matches;

export function useHandheld(): boolean {
  const [handheld, setHandheld] = useState(isHandheld);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(HANDHELD_QUERY);
    const changed = () => setHandheld(query.matches);
    query.addEventListener?.('change', changed);
    return () => query.removeEventListener?.('change', changed);
  }, []);
  return handheld;
}

/** Whether the page can be put in fullscreen: not on an iPhone, whose Safari has no element fullscreen. */
export const canFullscreen = (): boolean =>
  document.fullscreenEnabled ||
  (document as Document & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled === true;

export const fullscreenElement = (): Element | null =>
  document.fullscreenElement ??
  (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement ??
  null;

export function toggleFullscreen(target: HTMLElement): void {
  const ask = target as HTMLElement & { webkitRequestFullscreen?: () => void };
  const leave = document as Document & { webkitExitFullscreen?: () => void };
  if (fullscreenElement()) {
    if (document.exitFullscreen) void document.exitFullscreen().catch(() => undefined);
    else leave.webkitExitFullscreen?.();
    return;
  }
  if (ask.requestFullscreen) void ask.requestFullscreen().catch(() => undefined);
  else ask.webkitRequestFullscreen?.();
}
