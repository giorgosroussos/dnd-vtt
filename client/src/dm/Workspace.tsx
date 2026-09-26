import { useEffect, useRef, useState } from 'react';
import { API_PATHS, DEFAULT_SETTINGS, type AuthState, type Scene, type Settings } from '@emberglass/shared';
import { Notice } from '../ui/Notice.js';
import { errorMessage } from '../ui/errorMessage.js';
import { t } from '../ui/messages.js';
import { errorCode, request } from './api.js';
import { Button } from '../ui/Button.js';
import { ConnectDialog } from './ConnectDialog.js';
import { LiveBar } from './LiveBar.js';
import { ScenePanel } from './ScenePanel.js';
import { Library } from './library/Library.js';
import { useDmLive } from './live/useDmLive.js';
import { SceneTree } from './tree/SceneTree.js';

// The DM workspace (specs/08-ux-journeys.md §1, Q-023): the live bar on top, the
// Campaign → Session → Scene tree on the left, the selected scene in the centre and
// the asset library on the right. The centre is the selected scene's setup and canvas
// (ScenePanel, PRP-02), in live mode when it is the live scene and in prep mode otherwise
// (LIV-04, specs/08-ux-journeys.md §2, Q-024). Settings give the upload limit.
//
// The workspace keeps the live connection open (LIV-01, LIV-04, specs/04-live-sync.md §6): the live
// scene comes from the `dm` room's snapshots and events, so the live bar and the live canvas follow
// another DM browser (G-018). The live bar returns the canvas to the live scene in one click, blanks
// the TV (`scene.deactivate`, specs/04-live-sync.md §2) and opens Connect a screen (LIV-03). A
// snapshot for the players room means the server no longer knows this browser's session (a PIN
// change or a sign-out elsewhere dropped its socket), so the DM view goes back to the PIN form; but
// first it asks the server, since a reconnection racing a sign-in in another tab can carry the
// cookie of a moment ago: a browser that still holds a session reconnects once instead (G-027).
export function Workspace({ mainId, onSignedOut }: { mainId: string; onSignedOut?: () => void }) {
  const live = useDmLive();
  const [selected, setSelected] = useState<Scene>();
  const [settings, setSettings] = useState<Settings>();
  const [failure, setFailure] = useState<string>();
  const [connecting, setConnecting] = useState(false);
  // Focus returns to the button that opened the panel when it closes, as for the other dialogs.
  const connectButton = useRef<HTMLButtonElement>(null);
  const closeConnect = () => {
    setConnecting(false);
    connectButton.current?.focus();
  };

  useEffect(() => {
    request<Settings>('GET', API_PATHS.settings).then(
      (value) => {
        setSettings(value);
        setFailure(undefined);
      },
      (error: unknown) => setFailure(errorMessage(errorCode(error))),
    );
  }, []);

  // G-027: count the players snapshots already answered, so each is checked once and a session that
  // really ended after a reconnection does sign out.
  const demoted = live.role === 'players';
  const checked = useRef({ snapshots: -1, reconnected: false });
  const { reconnect } = live;
  useEffect(() => {
    if (!demoted) {
      checked.current.reconnected = false;
      return;
    }
    if (checked.current.snapshots === live.snapshots) return;
    checked.current.snapshots = live.snapshots;
    if (checked.current.reconnected) {
      onSignedOut?.();
      return;
    }
    let active = true;
    request<AuthState>('GET', API_PATHS.auth).then(
      (auth) => {
        if (!active) return;
        if (auth.dm) {
          checked.current.reconnected = true;
          reconnect();
        } else onSignedOut?.();
      },
      () => {
        if (active) onSignedOut?.();
      },
    );
    return () => {
      active = false;
    };
  }, [demoted, live.snapshots, onSignedOut, reconnect]);

  const liveScene = live.scene;
  const showingLive = liveScene != null && selected?.id === liveScene.scene.id;

  // Go live on the scene being edited (specs/08-ux-journeys.md §2): in the live bar, which has the
  // room; the scene's own head stays one line, so the canvas keeps its place (G-022).
  async function goLive(scene: Scene) {
    setFailure(undefined);
    const outcome = await live.command('scene.activate', { scene_id: scene.id });
    if (!outcome.ok) setFailure(t('scene.goLiveFailed', { reason: errorMessage(outcome.code) }));
  }

  async function blank() {
    setFailure(undefined);
    const outcome = await live.command('scene.deactivate', {});
    if (!outcome.ok) setFailure(t('liveBar.blankFailed', { reason: errorMessage(outcome.code) }));
  }

  return (
    <div className="eg-workspace">
      <LiveBar
        scene={liveScene}
        connection={live.status}
        actions={
          <>
            {selected && !showingLive && liveScene !== undefined ? (
              <Button
                variant="primary"
                size="small"
                aria-label={t('liveBar.goLiveWith', { name: selected.name })}
                onClick={() => void goLive(selected)}
              >
                {t('liveBar.goLive')}
              </Button>
            ) : null}
            {liveScene && !showingLive ? (
              <Button size="small" onClick={() => setSelected(liveScene.scene)}>
                {t('liveBar.showLive')}
              </Button>
            ) : null}
            {liveScene ? (
              <Button size="small" onClick={() => void blank()}>
                {t('liveBar.blank')}
              </Button>
            ) : null}
            <Button ref={connectButton} size="small" onClick={() => setConnecting(true)}>
              {t('connect.open')}
            </Button>
          </>
        }
      />
      {connecting ? <ConnectDialog onClose={closeConnect} /> : null}
      {failure ? <Notice>{failure}</Notice> : null}
      <div className="eg-workspace__columns">
        <nav className="eg-workspace__sidebar" aria-label={t('tree.label')}>
          <SceneTree
            selectedSceneId={selected?.id}
            onSelectScene={setSelected}
            onScenesRemoved={(ids) => {
              if (selected && ids.includes(selected.id)) setSelected(undefined);
            }}
            onSceneRenamed={(scene) => {
              if (selected?.id === scene.id) setSelected(scene);
            }}
          />
        </nav>
        <main id={mainId} tabIndex={-1} className="eg-workspace__main" data-view="dm">
          {selected ? (
            <ScenePanel
              key={selected.id}
              sceneId={selected.id}
              name={selected.name}
              uploadLimit={settings?.upload_limit_bytes ?? DEFAULT_SETTINGS.upload_limit_bytes}
              live={live}
            />
          ) : (
            <>
              <h1 className="eg-dm__heading">{t('workspace.noScene')}</h1>
              <p className="eg-dm__status">{t('workspace.noSceneHint')}</p>
            </>
          )}
        </main>
        <aside className="eg-workspace__library" aria-label={t('library.label')}>
          <Library uploadLimit={settings?.upload_limit_bytes ?? DEFAULT_SETTINGS.upload_limit_bytes} />
        </aside>
      </div>
    </div>
  );
}
