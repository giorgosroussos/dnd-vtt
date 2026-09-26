import { useEffect, useState, type ReactNode } from 'react';
import type { LiveStatus } from '../live/connection.js';
import { t } from '../ui/messages.js';
import type { DmScene } from './live/dmScene.js';

// The live bar on top of the workspace (specs/08-ux-journeys.md §1, §2, Q-023, Q-024): which
// scene the TV shows, or that nothing is live, read from the `dm` room's snapshots and events, so
// it follows a scene made live or blanked from another DM browser as it happens (LIV-04, G-018).
// Its controls (`actions`) return the canvas to the live scene, blank the TV and connect a screen.
// While the live connection is down it says so instead,
// since what it would name may no longer be true (specs/04-live-sync.md §6, LIV-01): only
// after CONNECTION_NOTICE_DELAY_MS, so a blip is not announced twice, as connecting until a
// first connection succeeds and as lost after one did, in the warning style (D-106).
export const CONNECTION_NOTICE_DELAY_MS = 1_000;

export function LiveBar({
  scene,
  connection,
  actions,
}: {
  /** The live scene: undefined until the first snapshot, null while nothing is live. */
  scene: DmScene | undefined;
  connection?: LiveStatus | undefined;
  /** The bar's controls after its status: Show live scene, Blank TV, Connect a screen. */
  actions?: ReactNode;
}) {
  const down = connection !== undefined && connection !== 'connected';
  // The down period that has lasted long enough to be told, counted from each connection change.
  const [lateFor, setLateFor] = useState<LiveStatus>();
  useEffect(() => {
    if (!down) return;
    const timer = setTimeout(() => setLateFor(connection), CONNECTION_NOTICE_DELAY_MS);
    return () => {
      clearTimeout(timer);
      setLateFor(undefined);
    };
  }, [down, connection]);
  const connectionText =
    down && lateFor === connection
      ? t(connection === 'reconnecting' ? 'liveBar.reconnecting' : 'liveBar.connecting')
      : undefined;

  let text: string | undefined;
  if (connectionText) text = connectionText;
  else if (scene === null) text = t('liveBar.none');
  else if (scene) text = t('liveBar.live', { name: scene.scene.name });

  return (
    <section className="eg-livebar" aria-label={t('liveBar.label')}>
      <p
        className={
          connectionText
            ? 'eg-livebar__text eg-livebar__text--warning'
            : scene
              ? 'eg-livebar__text eg-livebar__text--live'
              : 'eg-livebar__text'
        }
        role="status"
      >
        {text ?? t('dm.loading')}
      </p>
      {actions ? <div className="eg-livebar__actions">{actions}</div> : null}
    </section>
  );
}
