import { useCallback, useEffect, useRef, useState } from 'react';
import { API_PATHS, DEFAULT_SETTINGS, type AuthState, type Scene, type Settings } from '@emberglass/shared';
import { Notice } from '../ui/Notice.js';
import { errorMessage } from '../ui/errorMessage.js';
import { t } from '../ui/messages.js';
import { errorCode, request } from './api.js';
import { Button } from '../ui/Button.js';
import { useFocusLater } from '../ui/useFocusLater.js';
import { ConnectDialog } from './ConnectDialog.js';
import { LiveBar } from './LiveBar.js';
import { ScenePanel } from './ScenePanel.js';
import { SettingsDialog } from './SettingsDialog.js';
import { Library } from './library/Library.js';
import { useDmLive } from './live/useDmLive.js';
import { SceneTree } from './tree/SceneTree.js';

// The DM workspace (specs/08-ux-journeys.md §1, Q-023): the live bar on top, the
// Campaign → Session → Scene tree on the left, the selected scene in the centre and
// the asset library on the right. The centre is the selected scene's setup and canvas
// (ScenePanel, PRP-02), in live mode when it is the live scene and in prep mode otherwise
// (LIV-04, specs/08-ux-journeys.md §2, Q-024). Settings give the upload limit and the ruler's rule, and the
// Settings dialog in the live bar changes them without a restart (REL-01, specs/09-operations.md §7); the
// rule is read again whenever the ruler is turned on, since another browser may have changed it and the
// WebSocket carries only the live scene (specs/04-live-sync.md §1, G-036).
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
  const focusLater = useFocusLater();
  const closeConnect = () => {
    setConnecting(false);
    focusLater(() => connectButton.current);
  };

  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const closeSettings = () => {
    setSettingsOpen(false);
    focusLater(() => settingsButton.current);
  };

  // Each read and each save takes the next number, and a read's answer is applied only if nothing
  // newer began since it was sent: a slow read must not undo a save (review C-L1).
  const settingsTurn = useRef(0);
  const readSettings = useCallback((quiet: boolean) => {
    const turn = ++settingsTurn.current;
    request<Settings>('GET', API_PATHS.settings).then(
      (value) => {
        if (turn !== settingsTurn.current) return;
        setSettings(value);
        setFailure(undefined);
      },
      // A read again when measuring starts that fails keeps the rule it had, and says nothing.
      (error: unknown) => {
        if (!quiet && turn === settingsTurn.current) setFailure(errorMessage(errorCode(error)));
      },
    );
  }, []);
  useEffect(() => readSettings(false), [readSettings]);
  const rereadSettings = useCallback(() => readSettings(true), [readSettings]);
  const settingsSaved = useCallback((saved: Settings) => {
    settingsTurn.current++;
    setSettings(saved);
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
  const connected = live.status === 'connected';

  // Why Go live or Blank TV was refused, shown until the next snapshot: a reconnection always brings
  // one, so a refusal from before it is not left contradicting the bar (review M3).
  const [barFailure, setBarFailure] = useState<{ message: string; at: number }>();
  const barMessage = barFailure?.at === live.snapshots ? barFailure.message : undefined;

  // Go live, Show live scene and Blank TV each remove themselves once they have done their work, so
  // focus is put where the keyboard carries on, once the change they caused has rendered: Blank TV
  // after Go live, the scene after Show live scene, Go live (or Connect a screen) after Blank TV
  // (specs/08-ux-journeys.md §8, review M2).
  const goLiveButton = useRef<HTMLButtonElement>(null);
  const blankButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef<'wentLive' | 'showedLive' | 'blanked'>(undefined);
  useEffect(() => {
    if (refocus.current === 'wentLive' && showingLive) blankButton.current?.focus();
    else if (refocus.current === 'showedLive' && showingLive) document.getElementById(mainId)?.focus();
    else if (refocus.current === 'blanked' && liveScene === null) {
      (goLiveButton.current ?? connectButton.current)?.focus();
    } else return;
    refocus.current = undefined;
  });

  // Go live on the scene being edited (specs/08-ux-journeys.md §2): in the live bar, which has the
  // room; the scene's own head stays one line, so the canvas keeps its place (G-022).
  // While the connection is down the two commands could not be sent: their buttons stay where they
  // are, refusing, and the bar says the connection is being restored (review M3).
  async function goLive(scene: Scene) {
    if (!connected) return;
    setBarFailure(undefined);
    refocus.current = 'wentLive';
    const outcome = await live.command('scene.activate', { scene_id: scene.id });
    if (outcome.ok) return;
    refocus.current = undefined;
    setBarFailure({ message: t('scene.goLiveFailed', { reason: errorMessage(outcome.code) }), at: live.snapshots });
  }

  async function blank() {
    if (!connected) return;
    setBarFailure(undefined);
    refocus.current = 'blanked';
    const outcome = await live.command('scene.deactivate', {});
    if (outcome.ok) return;
    refocus.current = undefined;
    setBarFailure({ message: t('liveBar.blankFailed', { reason: errorMessage(outcome.code) }), at: live.snapshots });
  }

  function showLive(scene: Scene) {
    refocus.current = 'showedLive';
    setSelected(scene);
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
                ref={goLiveButton}
                variant="primary"
                size="small"
                aria-label={t('liveBar.goLiveWith', { name: selected.name })}
                aria-disabled={!connected || undefined}
                onClick={() => void goLive(selected)}
              >
                {t('liveBar.goLive')}
              </Button>
            ) : null}
            {liveScene && !showingLive ? (
              <Button size="small" onClick={() => showLive(liveScene.scene)}>
                {t('liveBar.showLive')}
              </Button>
            ) : null}
            {liveScene ? (
              <Button
                ref={blankButton}
                size="small"
                aria-disabled={!connected || undefined}
                onClick={() => void blank()}
              >
                {t('liveBar.blank')}
              </Button>
            ) : null}
            <Button ref={connectButton} size="small" onClick={() => setConnecting(true)}>
              {t('connect.open')}
            </Button>
            <Button ref={settingsButton} size="small" onClick={() => setSettingsOpen(true)}>
              {t('settings.open')}
            </Button>
          </>
        }
      />
      {connecting ? <ConnectDialog onClose={closeConnect} /> : null}
      {settingsOpen ? <SettingsDialog onClose={closeSettings} onSaved={settingsSaved} /> : null}
      {failure ? <Notice>{failure}</Notice> : null}
      {barMessage ? <Notice>{barMessage}</Notice> : null}
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
              rulerRule={settings?.ruler_rule ?? DEFAULT_SETTINGS.ruler_rule}
              onRulerOn={rereadSettings}
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
