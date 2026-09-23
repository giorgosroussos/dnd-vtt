import type { ComponentType } from 'react';
import { viewForPath } from '@emberglass/shared';

export async function loadView(pathname: string): Promise<ComponentType> {
  if (viewForPath(pathname) === 'dm') return (await import('./dm/DmView.js')).DmView;
  return (await import('./player/PlayerView.js')).PlayerView;
}
