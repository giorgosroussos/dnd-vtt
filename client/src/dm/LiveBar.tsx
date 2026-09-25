import { useEffect, useState } from 'react';
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
// browser changes it (G-018). While the live connection is lost it says so instead,
// since what it would name may no longer be true (specs/04-live-sync.md §6, LIV-01).
export function LiveBar({
  liveSceneId,
  refreshKey,
  connection,
}: {
  liveSceneId: string | null | undefined;
  refreshKey: number;
  connection?: LiveStatus | undefined;
}) {
  const [name, setName] = useState<{ id: string; name: string }>();
  const [failure, setFailure] = useState<string>();

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
  if (connection === 'reconnecting') text = t('liveBar.reconnecting');
  else if (liveSceneId === null) text = t('liveBar.none');
  else if (liveSceneId && failure) text = failure;
  else if (liveSceneId && name?.id === liveSceneId) text = t('liveBar.live', { name: name.name });

  return (
    <section className="eg-livebar" aria-label={t('liveBar.label')}>
      <p className={liveSceneId ? 'eg-livebar__text eg-livebar__text--live' : 'eg-livebar__text'} role="status">
        {text ?? t('dm.loading')}
      </p>
    </section>
  );
}
