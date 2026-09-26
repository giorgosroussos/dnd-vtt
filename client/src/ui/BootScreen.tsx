import { useEffect } from 'react';
import type { View } from '@emberglass/shared';
import { Button } from './Button.js';
import { IdleScreen } from './IdleScreen.js';
import { t } from './messages.js';

// What a view shows before its code has arrived, and when its code could not be loaded
// (G-007, LIV-03, D-113): part of the entry chunk, so it needs nothing that could fail to load.
// The DM view says it is loading, and on a failure says what may have happened and offers Reload.
// The TV keeps the idle screen's look, since nobody reads it (Q-025), and on a failure asks the
// server every few seconds whether it answers again, reloading once it does: a TV whose server
// restarted comes back by itself, where a reload while the server is down would leave the
// browser's own error page, which never retries.

export type BootState = 'loading' | 'failed';

export const BOOT_RETRY_MS = 5_000;

/** Resolves once the server answers the player view's page again. */
async function serverAnswers(): Promise<boolean> {
  try {
    const response = await fetch('/', { method: 'HEAD', cache: 'no-store' });
    return response.ok;
  } catch {
    return false;
  }
}

function useRetryUntilServerAnswers(active: boolean, reload: () => void): void {
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      timer = setTimeout(() => {
        void serverAnswers().then((ok) => {
          if (stopped) return;
          if (ok) reload();
          else attempt();
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

export function BootScreen({
  view,
  state,
  reload = defaultReload,
}: {
  view: View;
  state: BootState;
  reload?: () => void;
}) {
  useRetryUntilServerAnswers(view === 'player' && state === 'failed', reload);
  if (view === 'player') {
    return (
      <main data-view="boot" data-boot={state}>
        <IdleScreen />
      </main>
    );
  }
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
