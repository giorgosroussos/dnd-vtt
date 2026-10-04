import { useEffect, useState, type Ref } from 'react';
import type { LiveStatus } from '../live/connection.js';
import { Icon } from '../ui/icons.js';
import { t } from '../ui/messages.js';
import type { DmScene } from './live/dmScene.js';

// The live indicator in the middle of the header (specs/08-ux-journeys.md §1, §2, §11, Q-023, Q-024, Q-100,
// UIX-01): "LIVE · Players see {scene}" with Go idle while a scene is live, or the idle state with Go live,
// read from the `dm` room's snapshots and events, so it follows a scene made live or idle from another DM
// browser as it happens (LIV-04, G-018). The scene's name is a button that returns the canvas to the live
// scene in one click. While the live connection is down it says so instead, since what it would name may
// no longer be true (specs/04-live-sync.md §6, LIV-01): only after CONNECTION_NOTICE_DELAY_MS, so a blip is
// not announced twice, as connecting until a first connection succeeds and as lost after one did, in the
// warning style (D-106). While Follow my view is on (DMT-03, Q-113, Q-120) a small note says the TV follows
// the DM, or that following is paused while another scene is open.
export const CONNECTION_NOTICE_DELAY_MS = 1_000;

export function LiveBar({
  scene,
  connection,
  onShowLive,
  goIdle,
  goIdleRef,
  goLive,
  goLiveRef,
  showingLive,
  following = false,
}: {
  /** The live scene: undefined until the first snapshot, null while nothing is live. */
  scene: DmScene | undefined;
  connection?: LiveStatus | undefined;
  /** Returns the canvas to the live scene. */
  onShowLive?: (() => void) | undefined;
  /** Clears the live scene (`scene.deactivate`). */
  goIdle?: (() => void) | undefined;
  goIdleRef?: Ref<HTMLButtonElement> | undefined;
  /** Go live on the scene being edited, while nothing is live or another scene is. */
  goLive?: { name: string; onGoLive: () => void } | undefined;
  goLiveRef?: Ref<HTMLButtonElement> | undefined;
  /** Whether the canvas shows the live scene already. */
  showingLive?: boolean;
  /** Follow my view is on: paused while the canvas shows another scene. */
  following?: boolean | undefined;
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
  const refused = down || undefined;

  const goLiveButton = goLive ? (
    <button
      ref={goLiveRef}
      type="button"
      className="eg-button eg-button--primary eg-button--small"
      aria-label={t('liveBar.goLiveWith', { name: goLive.name })}
      aria-disabled={refused}
      onClick={goLive.onGoLive}
    >
      {t('liveBar.goLive')}
    </button>
  ) : null;

  if (connectionText) {
    return (
      <section className="eg-live eg-live--warning" aria-label={t('liveBar.label')}>
        <p className="eg-live__text" role="status">
          {connectionText}
        </p>
      </section>
    );
  }
  if (scene === undefined) {
    return (
      <section className="eg-live" aria-label={t('liveBar.label')}>
        <p className="eg-live__text" role="status">
          {t('dm.loading')}
        </p>
      </section>
    );
  }
  if (scene === null) {
    return (
      <section className="eg-live eg-live--idle" aria-label={t('liveBar.label')}>
        <span className="eg-live__badge eg-live__badge--idle" aria-hidden="true">
          {t('liveBar.idleBadge')}
        </span>
        <p className="eg-live__text" role="status">
          {t('liveBar.none')}
        </p>
        {goLiveButton}
      </section>
    );
  }
  return (
    <section className="eg-live eg-live--on" aria-label={t('liveBar.label')}>
      <span className="eg-live__badge" aria-hidden="true">
        <span className="eg-live__dot" />
        {t('liveBar.liveBadge')}
      </span>
      <p className="eg-live__text" role="status">
        {showingLive || !onShowLive ? (
          <span className="eg-live__scene" title={scene.scene.name}>
            {t('liveBar.playersSee')} <strong>{scene.scene.name}</strong>
          </span>
        ) : (
          <button
            type="button"
            className="eg-live__scene eg-live__show"
            title={scene.scene.name}
            aria-label={t('liveBar.showLiveOf', { name: scene.scene.name })}
            onClick={onShowLive}
          >
            {t('liveBar.playersSee')} <strong>{scene.scene.name}</strong>
          </button>
        )}
      </p>
      {following ? (
        <span className={showingLive ? 'eg-live__follow' : 'eg-live__follow eg-live__follow--paused'}>
          <Icon name="follow" size={12} strokeWidth={2} />
          {t(showingLive ? 'liveBar.follows' : 'liveBar.followPaused')}
        </span>
      ) : null}
      {goLive ? goLiveButton : null}
      {goIdle ? (
        <button
          ref={goIdleRef}
          type="button"
          className="eg-button eg-button--small"
          aria-disabled={refused}
          onClick={goIdle}
        >
          <Icon name="stop" size={12} />
          {t('liveBar.blank')}
        </button>
      ) : null}
    </section>
  );
}
