import { createElement, type ComponentType } from 'react';
import { viewForPath } from '@emberglass/shared';
import { ErrorBoundary } from './ui/ErrorBoundary.js';

export async function loadView(pathname: string): Promise<ComponentType> {
  if (viewForPath(pathname) === 'dm') return (await import('./dm/DmView.js')).DmView;
  return (await import('./player/PlayerView.js')).PlayerView;
}

// Each view's fallback lives in its own chunk, with the view.
async function loadFallback(pathname: string): Promise<ComponentType> {
  if (viewForPath(pathname) === 'dm') return (await import('./ui/ErrorScreen.js')).DmErrorScreen;
  return (await import('./ui/IdleScreen.js')).IdleScreen;
}

/** The view for `pathname`, wrapped in its error boundary (D-069). */
export async function loadGuardedView(pathname: string): Promise<ComponentType> {
  const [View, Fallback] = await Promise.all([loadView(pathname), loadFallback(pathname)]);
  return function GuardedView() {
    return createElement(ErrorBoundary, { fallback: createElement(Fallback), children: createElement(View) });
  };
}
