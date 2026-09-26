import { useEffect, useState, type ReactNode } from 'react';
import type { Scene } from '@emberglass/shared';
import type { LiveStatus } from '../live/connection.js';
import { errorMessage } from '../ui/errorMessage.js';
import { t } from '../ui/messages.js';
import { errorCode, request } from './api.js';
import { entityPath } from './tree/paths.js';

// The live bar on top of the workspace (specs/08-ux-journeys.md §1, Q-023): which
// scene the TV shows, or that nothing is live. Going live, Blank TV and the one-click
// return to the live scene are LIV-04 (specs/08-ux-journeys.md §2). It reads the live
// scene when the workspace opens and after a change in the tree, not when another
// browser changes it (G-018). While the live connection is down it says so instead,
// since what it would name may no longer be true (specs/04-live-sync.md §6, LIV-01): only
// after CONNECTION_NOTICE_DELAY_MS, so a blip is not announced twice, as connecting until a
// first connection succeeds and as lost after one did, in the warning style (D-106).
export const CONNECTION_NOTICE_DELAY_MS = 1_000;

export function LiveBar({
  liveSceneId,
  refreshKey,
  connection,
  actions,
}: {
  liveSceneId: string | null | undefined;
  refreshKey: number;
  connection?: LiveStatus | undefined;
  /** The bar's controls after its status, such as Connect a screen (LIV-03). */
  actions?: ReactNode;
}) {
  const [name, setName] = useState<{ id: string; name: string }>();
  const [failure, setFailure] = useState<string>();
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

  useEffect(() => {
    if (!liveSceneId) return;
    request<Scene>('GET', entityPath('scene', liveSceneId)).then(
      (scene) => {
        setName({ id: scene.id, name: scene.name });
        setFailure(undefined);
      },
      (error: unknown) => setFailure(errorMessage(errorCode(error))),
    );
  }, [liveSceneId, refreshKey]);

  let text: string | undefined;
  if (connectionText) text = connectionText;
  else if (liveSceneId === null) text = t('liveBar.none');
  else if (liveSceneId && failure) text = failure;
  else if (liveSceneId && name?.id === liveSceneId) text = t('liveBar.live', { name: name.name });

  return (
    <section className="eg-livebar" aria-label={t('liveBar.label')}>
      <p
        className={
          connectionText
            ? 'eg-livebar__text eg-livebar__text--warning'
            : liveSceneId
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
