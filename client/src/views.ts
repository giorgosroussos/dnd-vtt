import { createElement, type ComponentType } from 'react';
import { viewForPath } from '@emberglass/shared';
import { ErrorBoundary } from './ui/ErrorBoundary.js';
import { IdleScreen } from './ui/IdleScreen.js';

export async function loadView(pathname: string): Promise<ComponentType> {
  if (viewForPath(pathname) === 'dm') return (await import('./dm/DmView.js')).DmView;
  return (await import('./player/PlayerView.js')).PlayerView;
}

// The DM view's fallback lives in its own chunk, with the view; the player view's is the idle
// screen, which the entry chunk already holds for its loading state (D-113).
async function loadFallback(pathname: string): Promise<ComponentType> {
  if (viewForPath(pathname) === 'dm') return (await import('./ui/ErrorScreen.js')).DmErrorScreen;
  return IdleScreen;
}

/** The view for `pathname`, wrapped in its error boundary (D-069). */
export async function loadGuardedView(pathname: string): Promise<ComponentType> {
  const [View, Fallback] = await Promise.all([loadView(pathname), loadFallback(pathname)]);
  return function GuardedView() {
    return createElement(ErrorBoundary, { fallback: createElement(Fallback), children: createElement(View) });
  };
}
