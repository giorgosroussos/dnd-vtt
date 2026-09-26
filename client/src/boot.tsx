import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { viewForPath } from '@emberglass/shared';
import { BootScreen, clearBootReloads } from './ui/BootScreen.js';
import { loadGuardedView } from './views.js';

// Starts the view for `pathname` in `element` (G-007, D-113): its loading state at once, from the
// entry chunk, then the view once its chunk has arrived, or its load-failure state when the chunk
// cannot be loaded (the server stopped, or restarted with a new build since the page arrived).
export function boot(
  element: HTMLElement,
  pathname: string,
  load: (pathname: string) => Promise<ComponentType> = loadGuardedView,
): Promise<void> {
  const view = viewForPath(pathname);
  const root = createRoot(element);
  root.render(<BootScreen view={view} state="loading" />);
  return load(pathname).then(
    (View) => {
      clearBootReloads();
      root.render(
        <StrictMode>
          <View />
        </StrictMode>,
      );
    },
    (error: unknown) => {
      // The browser console only; nothing is sent anywhere (specs/02-architecture.md §6).
      console.error(error);
      root.render(<BootScreen view={view} state="failed" />);
    },
  );
}
