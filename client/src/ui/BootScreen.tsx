import { useEffect } from 'react';
import type { View } from '@emberglass/shared';
import { Button } from './Button.js';
import { IdleScreen } from './IdleScreen.js';
import { t } from './messages.js';
import { CURSOR_IDLE_MS, useIdleCursor } from './useIdleCursor.js';

// What a view shows before its code has arrived, and when its code could not be loaded
// (G-007, LIV-03, D-113, D-114): part of the entry chunk, so it needs nothing that could fail to
// load. The DM view says it is loading, and on a failure says what may have happened and offers
// Reload. The TV keeps the idle screen's look, since nobody reads it (Q-025), hides the pointer
// like the player view (Q-054), and on a failure recovers by itself: it asks the server for the
// page every few seconds and reloads when that can help, that is once the server answers after
// having been unreachable (it restarted) or answers with another build (its chunks changed). A
// reload while the server is down would leave the browser's own error page, which never retries,
// and reloading while the same build keeps failing would loop, so otherwise it reloads only after
// a wait that doubles with each such reload in this tab, up to five minutes.

export type BootState = 'loading' | 'failed';

export const BOOT_RETRY_MS = 5_000;
/** Waits before reloading a build that failed although the server stayed up, one per reload. */
export const BOOT_FALLBACK_MS = [30_000, 60_000, 120_000, 300_000] as const;
export const BOOT_RELOADS_KEY = 'emberglass.bootReloads';

type Probe = 'down' | 'same' | 'changed';

/** The entry script a page of the player view loads, which names the build. */
export function entryScript(html: string): string | undefined {
  return /<script[^>]*type="module"[^>]*src="([^"]+)"/.exec(html)?.[1];
}

function currentEntry(): string | undefined {
  return document.querySelector('script[type="module"][src]')?.getAttribute('src') ?? undefined;
}

async function probe(): Promise<Probe> {
  try {
    const response = await fetch('/', { cache: 'no-store' });
    if (!response.ok) return 'down';
    return entryScript(await response.text()) === currentEntry() ? 'same' : 'changed';
  } catch {
    return 'down';
  }
}

// The count lives in the tab's session storage, which may be refused; without it every wait is the first.
function storedReloads(): number {
  try {
    return Number(window.sessionStorage.getItem(BOOT_RELOADS_KEY)) || 0;
  } catch {
    return 0;
  }
}

function storeReloads(count: number | undefined): void {
  try {
    if (count === undefined) window.sessionStorage.removeItem(BOOT_RELOADS_KEY);
    else window.sessionStorage.setItem(BOOT_RELOADS_KEY, String(count));
  } catch {
    // Nothing to keep: the next wait is the first again.
  }
}

/** A view loaded: the next failure starts from the shortest wait. */
export const clearBootReloads = (): void => storeReloads(undefined);

function useRecover(active: boolean, reload: () => void): void {
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let wasDown = false;
    const reloads = storedReloads();
    const fallback = BOOT_FALLBACK_MS[Math.min(reloads, BOOT_FALLBACK_MS.length - 1)]!;
    const started = Date.now();
    const attempt = () => {
      timer = setTimeout(() => {
        void probe().then((result) => {
          if (stopped) return;
          if (result === 'down') wasDown = true;
          const helps = result === 'changed' || (result === 'same' && wasDown);
          const waited = result === 'same' && Date.now() - started >= fallback;
          if (helps || waited) {
            if (!helps) storeReloads(reloads + 1);
            reload();
            return;
          }
          attempt();
        });
      }, BOOT_RETRY_MS);
    };
    attempt();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active, reload]);
}

const defaultReload = () => window.location.reload();

function PlayerBoot({ state, reload }: { state: BootState; reload: () => void }) {
  const cursorHidden = useIdleCursor(CURSOR_IDLE_MS);
  useRecover(state === 'failed', reload);
  return (
    <main data-view="boot" data-boot={state} data-cursor={cursorHidden ? 'hidden' : 'shown'}>
      <IdleScreen />
    </main>
  );
}

export function BootScreen({
  view,
  state,
  reload = defaultReload,
}: {
  view: View;
  state: BootState;
  reload?: () => void;
}) {
  if (view === 'player') return <PlayerBoot state={state} reload={reload} />;
  return (
    <main className="eg-boot" data-view="boot" data-boot={state}>
      {state === 'loading' ? (
        <p className="eg-boot__status" role="status">
          {t('boot.loading')}
        </p>
      ) : (
        <>
          <p className="eg-boot__failure" role="alert">
            {t('boot.failed')}
          </p>
          <div>
            <Button variant="primary" onClick={reload}>
              {t('boot.reload')}
            </Button>
          </div>
        </>
      )}
    </main>
  );
}
