import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  API_PATHS,
  DEFAULT_SETTINGS,
  type AuthState,
  type Campaign,
  type Scene,
  type Session,
  type Settings,
} from '@emberglass/shared';
import { Notice } from '../ui/Notice.js';
import { errorMessage } from '../ui/errorMessage.js';
import { t } from '../ui/messages.js';
import { useFocusLater } from '../ui/useFocusLater.js';
import { errorCode, request } from './api.js';
import { ConnectDialog } from './ConnectDialog.js';
import { Header, useScreenCount } from './Header.js';
import { LiveBar } from './LiveBar.js';
import { ScenePanel } from './ScenePanel.js';
import { SettingsDialog } from './SettingsDialog.js';
import { SidePanel, type SideTab } from './SidePanel.js';
import { Library } from './library/Library.js';
import { useDmLive } from './live/useDmLive.js';
import { nextScene, SceneList, useSessionScenes } from './scenes/SceneList.js';
import { entityPath } from './tree/paths.js';
import { SceneTree } from './tree/SceneTree.js';

// Where this browser remembers the session it last worked on, for the next visit (UIX-01). A convenience
// only: it may be missing, refused or stale, and the workspace works without it.
const SESSION_KEY = 'emberglass.session';
const rememberedSession = (): string | undefined => {
  try {
    return window.localStorage.getItem(SESSION_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};
const rememberSession = (id: string | undefined): void => {
  try {
    if (id === undefined) window.localStorage.removeItem(SESSION_KEY);
    else window.localStorage.setItem(SESSION_KEY, id);
  } catch {
    // Storage refused: nothing is remembered.
  }
};

const typesText = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement);

// The DM workspace (specs/08-ux-journeys.md §1, §2, §11, Q-023, Q-024, Q-100, UIX-01): the header on top,
// with the campaign / session breadcrumb whose switcher holds the Campaign → Session → Scene tree, the live
// indicator, the screens counter and the settings; the current session's scenes on the left, with NEXT UP;
// the selected scene in the centre (ScenePanel), in live mode when it is the live scene and in prep mode
// otherwise (LIV-04); and on the right the scene's tokens and the asset library, in two tabs. Settings give
// the upload limit and the ruler's rule, changed without a restart (REL-01, specs/09-operations.md §7); the
// rule is read again whenever the ruler is turned on, since another browser may have changed it and the
// WebSocket carries only the live scene (specs/04-live-sync.md §1, G-036). The Settings dialog also signs
// this browser out.
//
// The workspace keeps the live connection open (LIV-01, LIV-04, specs/04-live-sync.md §6): the live scene
// comes from the `dm` room's snapshots and events, so the header and the live canvas follow another DM
// browser (G-018). Go live (the header, a scene's button, NEXT UP or Shift+N) sends `scene.activate` and
// shows that scene; Go idle sends `scene.deactivate` (specs/04-live-sync.md §2). A snapshot for the players
// room means the server no longer knows this browser's session (a PIN change or a sign-out elsewhere
// dropped its socket), so the DM view goes back to the PIN form; but first it asks the server, since a
// reconnection racing a sign-in in another tab can carry the cookie of a moment ago: a browser that still
// holds a session reconnects once instead (G-027).
export function Workspace({
  mainId,
  onSignedOut,
  onSignOut,
  signOutFailure,
}: {
  mainId: string;
  onSignedOut?: () => void;
  /** Signs this browser out, from the Settings dialog. */
  onSignOut?: () => void;
  signOutFailure?: string | undefined;
}) {
  const live = useDmLive();
  const screens = useScreenCount();
  const [selected, setSelected] = useState<Scene>();
  const [sessionId, setSessionId] = useState<string | undefined>(rememberedSession);
  const [current, setCurrent] = useState<{ session: Session; campaign: Campaign }>();
  const [settings, setSettings] = useState<Settings>();
  const [failure, setFailure] = useState<string>();
  const [connecting, setConnecting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [sideTab, setSideTab] = useState<SideTab>('scene');
  // Lock TV camera, for this DM view only and until it reloads (D-140).
  const [tvLocked, setTvLocked] = useState(false);
  // Scene setup stays open, or closed, from one scene to the next (UIX-01).
  const [setupOpen, setSetupOpen] = useState(false);
  const [scenesVersion, setScenesVersion] = useState(0);
  const bumpScenes = useCallback(() => setScenesVersion((count) => count + 1), []);
  // The session chosen now, once its record has arrived.
  const shown = current && current.session.id === sessionId ? current : undefined;
  // The live scene's tokens changed: the scene list's counts are read again.
  const liveSignature = live.scene
    ? `${live.scene.scene.id}:${live.scene.tokens.length}:${live.scene.tokens.filter((token) => token.hidden).length}:${live.scene.scene.name}`
    : 'none';
  const sessionScenes = useSessionScenes(shown?.session.id, `${scenesVersion}:${liveSignature}`);

  // Focus returns to the button that opened a panel when it closes, as for the other dialogs.
  const connectButton = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const switcherButton = useRef<HTMLButtonElement>(null);
  const switcher = useRef<HTMLElement>(null);
  const focusLater = useFocusLater();
  const closeConnect = () => {
    setConnecting(false);
    focusLater(() => connectButton.current);
  };
  const closeSettings = () => {
    setSettingsOpen(false);
    focusLater(() => settingsButton.current);
  };
  const closeSwitcher = (refocus: boolean) => {
    setSwitcherOpen(false);
    if (refocus) focusLater(() => switcherButton.current);
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
  const liveId = liveScene?.scene.id;
  const showingLive = liveScene != null && selected?.id === liveScene.scene.id;
  const connected = live.status === 'connected';

  // The first snapshot shows the live scene and its session, when nothing was chosen yet.
  const [placed, setPlaced] = useState(false);
  if (!placed && liveScene !== undefined) {
    setPlaced(true);
    if (liveScene !== null) {
      if (selected === undefined) setSelected(liveScene.scene);
      if (sessionId === undefined) setSessionId(liveScene.scene.session_id);
    }
  }

  // The current session and its campaign, for the breadcrumb and the scene list.
  useEffect(() => {
    rememberSession(sessionId);
    if (sessionId === undefined) return;
    let active = true;
    request<Session>('GET', entityPath('session', sessionId))
      .then(async (session) => ({
        session,
        campaign: await request<Campaign>('GET', entityPath('campaign', session.campaign_id)),
      }))
      .then(
        (value) => {
          if (active) setCurrent(value);
        },
        (error: unknown) => {
          if (!active) return;
          // A remembered session deleted meanwhile is forgotten; anything else is said.
          if (errorCode(error) === 'not_found') setSessionId(undefined);
          else setFailure(errorMessage(errorCode(error)));
        },
      );
    return () => {
      active = false;
    };
    // Read again when the switcher closes, where the campaign or the session may have been renamed.
  }, [sessionId, switcherOpen]);

  // Why Go live or Go idle was refused, shown until the next snapshot: a reconnection always brings one,
  // so a refusal from before it is not left contradicting the header (review M3).
  const [barFailure, setBarFailure] = useState<{ message: string; at: number }>();
  const barMessage = barFailure?.at === live.snapshots ? barFailure.message : undefined;

  // Go live and Go idle each change what the header offers, so focus is put where the keyboard carries
  // on once the change they caused has rendered: Go idle after Go live, Go live (or the screens counter)
  // after Go idle (specs/08-ux-journeys.md §8, review M2).
  const goLiveButton = useRef<HTMLButtonElement>(null);
  const goIdleButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef<'wentLive' | 'showedLive' | 'wentIdle'>(undefined);
  useEffect(() => {
    if (refocus.current === 'wentLive' && showingLive) goIdleButton.current?.focus();
    else if (refocus.current === 'showedLive' && showingLive) document.getElementById(mainId)?.focus();
    else if (refocus.current === 'wentIdle' && liveScene === null) {
      (goLiveButton.current ?? connectButton.current)?.focus();
    } else return;
    refocus.current = undefined;
  });

  // Go live on a scene (specs/08-ux-journeys.md §2, §11): the canvas shows it once the server has made it
  // live. While the connection is down the command could not be sent: the buttons stay where they are,
  // refusing, and the header says the connection is being restored (review M3).
  async function goLive(scene: Scene, fromHeader = false) {
    if (!connected) return;
    setBarFailure(undefined);
    if (fromHeader) refocus.current = 'wentLive';
    const outcome = await live.command('scene.activate', { scene_id: scene.id });
    if (outcome.ok) {
      setSelected(scene);
      return;
    }
    refocus.current = undefined;
    setBarFailure({ message: t('scene.goLiveFailed', { reason: errorMessage(outcome.code) }), at: live.snapshots });
  }

  async function goIdle() {
    if (!connected) return;
    setBarFailure(undefined);
    refocus.current = 'wentIdle';
    const outcome = await live.command('scene.deactivate', {});
    if (outcome.ok) return;
    refocus.current = undefined;
    setBarFailure({ message: t('liveBar.blankFailed', { reason: errorMessage(outcome.code) }), at: live.snapshots });
  }

  function showLive(scene: Scene) {
    refocus.current = 'showedLive';
    setSelected(scene);
    setSessionId(scene.session_id);
  }

  const next = sessionScenes.scenes ? nextScene(sessionScenes.scenes, liveId, selected?.id) : undefined;

  // Shift+N puts NEXT UP on the TV, from anywhere but a text field or a dialog (UIX-01).
  const nextKey = useEffectEvent(() => {
    if (next) void goLive(next);
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || !event.shiftKey) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.key.toLowerCase() !== 'n') return;
      if (typesText(event.target) || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      nextKey();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // The switcher closes on Escape and on a click outside it.
  useEffect(() => {
    if (!switcherOpen) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (switcher.current?.contains(target) || switcherButton.current?.contains(target)) return;
      if (document.querySelector('dialog[open]')) return;
      setSwitcherOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [switcherOpen]);

  const uploadLimit = settings?.upload_limit_bytes ?? DEFAULT_SETTINGS.upload_limit_bytes;
  const library = <Library uploadLimit={uploadLimit} />;
  const removed = (ids: string[]) => {
    if (selected && ids.includes(selected.id)) setSelected(undefined);
    bumpScenes();
  };
  const renamed = (scene: Scene) => {
    if (selected?.id === scene.id) setSelected(scene);
    bumpScenes();
  };

  return (
    <div className="eg-workspace">
      <Header
        breadcrumb={shown ? { campaign: shown.campaign.name, session: shown.session.title } : undefined}
        switcherOpen={switcherOpen}
        onToggleSwitcher={() => setSwitcherOpen((open) => !open)}
        switcherRef={switcherButton}
        live={
          <LiveBar
            scene={liveScene}
            connection={live.status}
            showingLive={showingLive}
            onShowLive={liveScene ? () => showLive(liveScene.scene) : undefined}
            goIdle={liveScene ? () => void goIdle() : undefined}
            goIdleRef={goIdleButton}
            goLive={
              selected && !showingLive && liveScene !== undefined
                ? { name: selected.name, onGoLive: () => void goLive(selected, true) }
                : undefined
            }
            goLiveRef={goLiveButton}
          />
        }
        screens={screens}
        onConnect={() => setConnecting(true)}
        connectRef={connectButton}
        onSettings={() => setSettingsOpen(true)}
        settingsRef={settingsButton}
      />
      {switcherOpen ? (
        <section
          ref={switcher}
          className="eg-switcher"
          aria-label={t('tree.label')}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
              event.preventDefault();
              closeSwitcher(true);
            }
          }}
        >
          <SceneTree
            selectedSceneId={selected?.id}
            currentSessionId={shown?.session.id}
            onSelectScene={(scene) => {
              setSelected(scene);
              setSessionId(scene.session_id);
              closeSwitcher(false);
            }}
            onOpenSession={(session) => {
              if (selected && selected.session_id !== session.id) setSelected(undefined);
              setSessionId(session.id);
              closeSwitcher(true);
            }}
            onScenesRemoved={removed}
            onSceneRenamed={renamed}
          />
        </section>
      ) : null}
      {connecting ? <ConnectDialog onClose={closeConnect} /> : null}
      {settingsOpen ? (
        <SettingsDialog
          onClose={closeSettings}
          onSaved={settingsSaved}
          onSignOut={onSignOut}
          signOutFailure={signOutFailure}
        />
      ) : null}
      {failure ? <Notice>{failure}</Notice> : null}
      {barMessage ? <Notice>{barMessage}</Notice> : null}
      <div className="eg-workspace__columns">
        <div className="eg-workspace__sidebar">
          <SceneList
            session={shown?.session}
            scenes={sessionScenes}
            selectedId={selected?.id}
            liveId={liveId}
            connected={connected}
            onSelect={setSelected}
            onPutOnTv={(scene) => void goLive(scene)}
            onChanged={bumpScenes}
            onScenesRemoved={removed}
            onSceneRenamed={renamed}
            onChooseSession={() => setSwitcherOpen(true)}
          />
          {shown ? (
            <section className="eg-next" aria-label={t('next.label')}>
              <h2 className="eg-next__heading">{t('next.heading')}</h2>
              {next ? (
                <div className="eg-next__row">
                  <span className="eg-next__name">{next.name}</span>
                  <button
                    type="button"
                    className="eg-button eg-button--primary eg-button--small"
                    aria-label={t('next.goLiveOf', { name: next.name })}
                    aria-keyshortcuts="Shift+N"
                    aria-disabled={!connected || undefined}
                    onClick={() => void goLive(next)}
                  >
                    {t('liveBar.goLive')}
                    <kbd>{t('next.key')}</kbd>
                  </button>
                </div>
              ) : (
                <p className="eg-next__none">{t('next.none')}</p>
              )}
            </section>
          ) : null}
        </div>
        {selected ? (
          <ScenePanel
            key={selected.id}
            sceneId={selected.id}
            name={selected.name}
            uploadLimit={uploadLimit}
            rulerRule={settings?.ruler_rule ?? DEFAULT_SETTINGS.ruler_rule}
            onRulerOn={rereadSettings}
            live={live}
            mainId={mainId}
            sideTab={sideTab}
            onSideTab={setSideTab}
            library={library}
            tvLocked={tvLocked}
            onTvLocked={setTvLocked}
            setupOpen={setupOpen}
            onSetupOpen={setSetupOpen}
            onTokensChanged={bumpScenes}
          />
        ) : (
          <>
            <main id={mainId} tabIndex={-1} className="eg-scene eg-scene--empty" data-view="dm">
              <h1 className="eg-scene__name">{t('workspace.noScene')}</h1>
              <p className="eg-dm__status">{t('workspace.noSceneHint')}</p>
            </main>
            <SidePanel tab={sideTab} onTab={setSideTab} scene={undefined} library={library} />
          </>
        )}
      </div>
    </div>
  );
}
