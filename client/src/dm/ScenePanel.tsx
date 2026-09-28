import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  API_IMAGE_PATHS,
  FIT_CAMERA,
  type CommandType,
  type PlayerCamera,
  type Image,
  type LibraryAsset,
  type Scene,
  type SceneGridUpdate,
  type SceneToken,
  type TokenUpdateBody,
} from '@emberglass/shared';
import { formatDecimal } from '../canvas/calibration.js';
import { MapCanvas, type CanvasTokenControls, type Measure, type Placing, type TvFrame } from '../canvas/MapCanvas.js';
import { Button } from '../ui/Button.js';
import { Dialog } from '../ui/Dialog.js';
import { Notice } from '../ui/Notice.js';
import { TextField } from '../ui/TextField.js';
import { errorMessage } from '../ui/errorMessage.js';
import { t, type MessageKey } from '../ui/messages.js';
import { errorCode, request, upload } from './api.js';
import { CalibrationPanel } from './calibration/CalibrationPanel.js';
import { CornerMagnifier } from './calibration/CornerMagnifier.js';
import { startDraft, withRect, type Draft } from './calibration/draft.js';
import { megabytes } from './library/labels.js';
import type { DmScene } from './live/dmScene.js';
import type { DmLive } from './live/useDmLive.js';
import { entityPath } from './tree/paths.js';
import { DeleteTokenDialog, RenameDialog, TokenBar } from './tokens/TokenBar.js';
import { TokenPicker } from './tokens/TokenPicker.js';
import { toCanvasToken, useSceneTokens } from './tokens/useSceneTokens.js';

// The selected scene in the centre of the workspace (PRP-02, specs/08-ux-journeys.md §1, §3,
// specs/06-grid-and-measurement.md §2, specs/03-domain-model.md §6, D-090, D-093): its setup and
// its canvas. The scene is read from the server when selected, since the tree's copy knows
// nothing of a map attached here. Attaching a map uploads it and sets it on the scene in one
// action (G-016); a file over the upload limit is refused before a byte is sent, and the upload
// shows its progress (G-017). Players seeing the grid is one checkbox; the DM sees the overlay
// either way, faintly when players do not (D-026).
//
// A scene with a map is calibrated in a panel above the canvas, with the far corner magnified
// over the canvas's bottom-right corner (PRP-03,
// specs/06-grid-and-measurement.md §1, D-094): the overlay draws the draft as it changes, and
// Save stores it, which also becomes the map's preset for later scenes (specs/03-domain-model.md
// §5). While calibrating, the panel takes the place of the map and grid setup, so the map cannot
// be replaced meanwhile and the canvas keeps its height; replacing a calibrated map asks first,
// because its calibration goes with it (D-093). A scene without a map offers no calibration.
//
// Tokens (PRP-04, specs/05-assets-and-images.md §3–§5, specs/06-grid-and-measurement.md §4, D-100):
// Add token opens the picker; the chosen asset is then placed by a click on the map, or by Enter at
// the centre of the view, and the server numbers it and sets its visibility from the asset. The
// selected token is moved by dragging or by the arrow keys, and hidden, revealed, renamed,
// restacked or deleted from the token bar.
//
// Live and prep modes (LIV-04, specs/08-ux-journeys.md §2, Q-024): the live scene is shown in live
// mode, framed by a persistent live indicator, and every other scene in prep mode, where nothing
// reaches the TV and the live bar's Go live makes it the live scene (`scene.activate`, Workspace). In live mode the scene, its
// map and its tokens come from the `dm` room (`useDmLive`), so another DM browser's changes show as
// they happen, and the token controls send the live commands instead of REST writes: placing is
// `token.add`, a drop or an arrow key `token.move`, Hide and Reveal `token.setVisibility`, Delete
// `token.delete` (specs/04-live-sync.md §2, §7, D-109); renaming and restacking are prep-mode only.
// A move or a visibility change shows at once and is dropped if the server refuses it. The setup
// (map, players' grid, calibration) is still saved over REST in live mode (Q-015), and the server
// pushes it to both rooms as a fresh snapshot (specs/04-live-sync.md §10).
//
// Undo (LIV-05, specs/04-live-sync.md §8, specs/08-ux-journeys.md §3, D-040, D-117): in live mode,
// Ctrl+Z (Cmd+Z on a Mac) anywhere in the DM view sends `undo`; the server applies the most recent
// inverse, and its events bring this canvas and the TV in step. A text field keeps its own undo and an
// open dialog takes none; in prep mode, while calibrating and while not connected nothing is sent, and
// a held or repeated Ctrl+Z waits for the answer to the first. The status line names what the undo's
// events changed before its acknowledgement (D-111), or says that nothing was left (D-118).
//
// The TV camera (LIV-06, specs/04-live-sync.md §9, specs/08-ux-journeys.md §2, Q-080, D-119): in live
// mode the canvas shows the frame of what the TV sees, in the shape of the screen the server says it
// follows, from the live scene, so it follows another DM browser's steering. Dropping the frame, a key
// press while steering, or a view button while steering sends `camera.setPlayer`; the frame stays where
// it was put until the server answers, and a refusal says why above the canvas. The DM's own view does
// not move. Setting the TV camera is not undoable (specs/04-live-sync.md §2).
//
// The workspace keys this panel by scene: a request still running when another scene is
// selected ends in a panel that is gone, so its answer changes nothing on screen. One change
// runs at a time; while it does, the controls stay focusable but refuse, so keyboard focus
// is never dropped (D-093), and the status line says what happened.

const ACCEPT = 'image/png,image/jpeg,image/webp';
const imagePath = (id: string): string => API_IMAGE_PATHS.image.replace(':id', id);
// Refusals of the file itself are shown beside the field (D-069); anything else above.
const FILE_REFUSALS = new Set(['unsupported_media_type', 'payload_too_large']);

// Fields whose own Ctrl+Z undoes typing, which the live scene's undo must leave alone.
const TEXT_INPUTS = new Set(['', 'text', 'search', 'number', 'email', 'url', 'tel', 'password']);
const typesText = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && TEXT_INPUTS.has(target.type)));

// An undo refused because its change no longer applies: it was dropped, and the next Ctrl+Z undoes
// the change before it (D-117). Reloading would not help, so the reason says so (review U4).
const STALE_UNDO = new Set(['not_found', 'reference_not_found', 'scene_not_live']);

/** What an undo changed on the live scene, named as the other token announcements are (review U2). */
function undoneMessage(before: DmScene | undefined, after: DmScene | undefined): string {
  if (after === before) return t('scene.nothingToUndo');
  const was = new Map((before?.tokens ?? []).map((token) => [token.id, token]));
  const now = new Map((after?.tokens ?? []).map((token) => [token.id, token]));
  for (const [id, token] of was) if (!now.has(id)) return t('scene.undoneRemoved', { label: token.label });
  for (const [id, token] of now) {
    const old = was.get(id);
    const label = token.label;
    if (!old) return t(token.hidden ? 'scene.undoneRestoredHidden' : 'scene.undoneRestored', { label });
    if (old.hidden !== token.hidden) return t(token.hidden ? 'scene.undoneHidden' : 'scene.undoneShown', { label });
    if (old.x !== token.x || old.y !== token.y) {
      return t('scene.undoneMoved', { label, column: formatDecimal(token.x + 1), row: formatDecimal(token.y + 1) });
    }
  }
  return t('scene.undone');
}

/**
 * Ctrl+Z or Cmd+Z, without Shift (redo, elsewhere) or Alt. The letter is read from `key`, so that an
 * AZERTY keyboard's Z counts; a layout whose letters are not Latin (Greek, Cyrillic) answers by the
 * key's place, `KeyZ`.
 */
export function isUndoKey(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return false;
  const key = event.key.toLowerCase();
  return key === 'z' || (!/^[a-z]$/.test(key) && event.code === 'KeyZ');
}

export function ScenePanel({
  sceneId,
  name,
  uploadLimit,
  live,
}: {
  sceneId: string;
  name: string;
  uploadLimit: number;
  /** The workspace's live connection: whether this scene is live, and the commands (LIV-04). */
  live?: DmLive | undefined;
}) {
  const gridId = useId();
  const hintId = useId();
  const liveScene = live?.scene != null && live.scene.scene.id === sceneId ? live.scene : undefined;
  const isLive = liveScene !== undefined;
  // Live mode while the connection is down: nothing done here reaches the TV until it is back (review M3).
  const offline = isLive && live?.status !== 'connected';
  // Live mode names itself in the head, not by colour alone (specs/08-ux-journeys.md §2, review M4).
  const modeLabel = offline ? 'scene.liveOffline' : 'scene.live';
  const frameClass = !isLive
    ? 'eg-scene__canvas'
    : `eg-scene__canvas eg-scene__canvas--live${offline ? ' eg-scene__canvas--offline' : ''}`;
  // The scene as read over REST in prep mode; live mode shows the live scene's record instead.
  const [prepScene, setScene] = useState<Scene>();
  const scene = liveScene?.scene ?? prepScene;
  const [loadedMap, setLoadedMap] = useState<Image>();
  const [failure, setFailure] = useState<string>();
  const [file, setFile] = useState<File>();
  const [fileError, setFileError] = useState<string>();
  const [progress, setProgress] = useState<number>();
  // The value being saved, shown at once; the server's answer replaces it, a refusal drops it.
  const [savingGrid, setSavingGrid] = useState<boolean>();
  const [status, setStatus] = useState<'attached' | 'calibrated' | { message: string; n: number }>();
  // Each announcement is a new node, so a message equal to the last one is still read out (review U1).
  const announced = useRef(0);
  const [mapFailedFor, setMapFailedFor] = useState<string>();
  const [draft, setDraft] = useState<Draft>();
  const [savingCalibration, setSavingCalibration] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  // Where focus goes once the calibration panel or the confirmation has closed: set with the
  // state change that closes it, and taken after that render.
  const refocus = useRef<'calibrate' | 'replace' | 'add' | 'canvas' | 'opener'>(undefined);
  // The control that opened a token dialog, where focus returns when it closes unchanged.
  const opener = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sceneTokens = useSceneTokens(sceneId, isLive);
  // Moves and visibility changes sent in live mode, shown until the server has answered (LIV-04).
  const [pending, setPending] = useState<
    Record<string, { seq: number; fields: { x?: number; y?: number; hidden?: boolean } }>
  >({});
  const pendingSeq = useRef(0);
  const [liveFailure, setLiveFailure] = useState<string>();
  // Steering the TV with the keys (LIV-06), and the camera sent and not yet answered.
  const [steering, setSteering] = useState(false);
  // Steering ends whenever the frame goes: Blank TV, another scene live, or calibration (review U-M3).
  const steerable = liveScene !== undefined && draft === undefined;
  const [wasSteerable, setWasSteerable] = useState(steerable);
  if (steerable !== wasSteerable) {
    setWasSteerable(steerable);
    if (!steerable) setSteering(false);
  }
  const [pendingCamera, setPendingCamera] = useState<{ seq: number; camera: PlayerCamera }>();
  const cameraSeq = useRef(0);
  const [selectedToken, setSelectedToken] = useState<string>();
  // Choosing a token gives the arrow keys back to it, and placing one ends steering (review U-M4).
  const selectToken = (id: string | undefined) => {
    setSelectedToken(id);
    if (id !== undefined) setSteering(false);
  };
  const [picking, setPicking] = useState(false);
  const [placingAsset, setPlacingAsset] = useState<LibraryAsset>();
  const [renaming, setRenaming] = useState<SceneToken>();
  const [deleting, setDeleting] = useState<SceneToken>();
  const formRef = useRef<HTMLFormElement>(null);
  const calibrateRef = useRef<HTMLButtonElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (refocus.current === 'calibrate') calibrateRef.current?.focus();
    if (refocus.current === 'replace') submitRef.current?.focus();
    if (refocus.current === 'add') panelRef.current?.querySelector<HTMLButtonElement>('.eg-tokens button')?.focus();
    if (refocus.current === 'canvas') panelRef.current?.querySelector<HTMLElement>('[role="application"]')?.focus();
    if (refocus.current === 'opener') {
      if (opener.current?.isConnected) opener.current.focus();
      else panelRef.current?.querySelector<HTMLButtonElement>('.eg-tokens button')?.focus();
    }
    refocus.current = undefined;
  });

  // Read again whenever the scene is shown in prep mode, since it may have changed while it was live.
  useEffect(() => {
    if (isLive) return;
    let active = true;
    request<Scene>('GET', entityPath('scene', sceneId)).then(
      (value) => {
        if (active) setScene(value);
      },
      (error: unknown) => {
        if (active) setFailure(errorMessage(errorCode(error)));
      },
    );
    return () => {
      active = false;
    };
  }, [sceneId, isLive]);

  const mapId = scene?.map_image_id;
  useEffect(() => {
    if (isLive || typeof mapId !== 'string') return;
    let active = true;
    request<Image>('GET', imagePath(mapId)).then(
      (value) => {
        if (active) setLoadedMap(value);
      },
      (error: unknown) => {
        if (active) setFailure(errorMessage(errorCode(error)));
      },
    );
    return () => {
      active = false;
    };
  }, [mapId, isLive]);
  // Null for a scene without a map; undefined while the map's record is on its way. The live scene's
  // map comes with its snapshot.
  const map = liveScene
    ? liveScene.map
    : mapId === null
      ? null
      : loadedMap && loadedMap.id === mapId
        ? loadedMap
        : undefined;

  const uploading = progress !== undefined;
  const busy = uploading || savingGrid !== undefined || savingCalibration;
  const fileInput = () => formRef.current?.querySelector<HTMLInputElement>('input[type="file"]');

  const tooLarge = (chosen: File) =>
    t('sceneMap.tooLarge', { size: megabytes(chosen.size), limit: megabytes(uploadLimit) });

  function chooseFile(chosen: File | undefined) {
    setFile(chosen);
    setStatus(undefined);
    setFileError(chosen && chosen.size > uploadLimit ? tooLarge(chosen) : undefined);
  }

  function refuseFile(message: string) {
    setFileError(message);
    fileInput()?.focus();
  }

  function attach(event: FormEvent) {
    event.preventDefault();
    if (busy || !scene) return;
    if (!file) return refuseFile(t('sceneMap.required'));
    if (file.size > uploadLimit) return refuseFile(tooLarge(file));
    if (scene.map_image_id !== null && scene.grid.size !== null) return setConfirmReplace(true);
    void send(file);
  }

  async function send(file: File) {
    if (!scene) return;
    setFailure(undefined);
    setStatus(undefined);
    setProgress(0);
    try {
      const image = await upload(file, setProgress);
      setScene(await request<Scene>('PATCH', entityPath('scene', scene.id), { map_image_id: image.id }));
      setFile(undefined);
      setStatus('attached');
      formRef.current?.reset();
    } catch (error) {
      const code = errorCode(error);
      if (FILE_REFUSALS.has(code)) refuseFile(errorMessage(code));
      else setFailure(errorMessage(code));
    } finally {
      setProgress(undefined);
    }
  }

  async function setGridVisible(visible: boolean) {
    if (!scene || busy) return;
    setSavingGrid(visible);
    setFailure(undefined);
    setStatus(undefined);
    try {
      setScene(await request<Scene>('PATCH', entityPath('scene', scene.id), { grid: { visible } }));
    } catch (error) {
      setFailure(errorMessage(errorCode(error)));
    } finally {
      setSavingGrid(undefined);
    }
  }

  function startCalibration(target: Image) {
    if (!scene || busy) return;
    setStatus(undefined);
    setFailure(undefined);
    setDraft(startDraft(scene.grid, { width: target.width, height: target.height }));
  }

  function cancelCalibration() {
    setDraft(undefined);
    refocus.current = 'calibrate';
  }

  async function saveCalibration() {
    if (!scene || !draft || busy) return;
    const { size, offset_x, offset_y, columns, rows } = draft.calibration;
    const grid: SceneGridUpdate = { size, offset_x, offset_y, columns, rows };
    setSavingCalibration(true);
    setFailure(undefined);
    try {
      setScene(await request<Scene>('PATCH', entityPath('scene', scene.id), { grid }));
      setDraft(undefined);
      setStatus('calibrated');
      refocus.current = 'calibrate';
    } catch (error) {
      setFailure(errorMessage(errorCode(error)));
    } finally {
      setSavingCalibration(false);
    }
  }

  // Tokens: over REST in prep mode, through the live commands in live mode.

  const tokens = liveScene
    ? liveScene.tokens.map((token) => ({ ...token, ...pending[token.id]?.fields }))
    : sceneTokens.tokens;
  const selected = tokens?.find((token) => token.id === selectedToken);

  const openDialog = (open: () => void) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    open();
  };

  function pick(asset: LibraryAsset) {
    setPicking(false);
    setStatus(undefined);
    setPlacingAsset(asset);
    setSteering(false);
    refocus.current = 'canvas';
  }

  function cancelPlacing() {
    setPlacingAsset(undefined);
    refocus.current = 'add';
  }

  /** Sends a live command; a refusal says why above the canvas. */
  async function command(
    type: CommandType,
    payload: object,
    message: MessageKey = 'scene.liveFailed',
  ): Promise<boolean> {
    setLiveFailure(undefined);
    const outcome = live ? await live.command(type, payload) : ({ ok: false, code: 'network' } as const);
    if (!outcome.ok) setLiveFailure(t(message, { reason: errorMessage(outcome.code) }));
    return outcome.ok;
  }

  async function placeLive(assetId: string, at: { x: number; y: number }): Promise<SceneToken | undefined> {
    // The token the acknowledged token.add placed is the last one added before the acknowledgement.
    if (!(await command('token.add', { scene_id: sceneId, asset_id: assetId, ...at }))) return undefined;
    return live?.lastAdded();
  }

  async function placeToken(asset: LibraryAsset, at: { x: number; y: number }) {
    setPlacingAsset(undefined);
    const token = isLive ? await placeLive(asset.id, at) : await sceneTokens.place(asset.id, at);
    refocus.current = 'canvas';
    if (!token) return;
    setSelectedToken(token.id);
    announce(t('tokens.placed', { label: token.label }));
  }

  async function deleteToken(token: SceneToken) {
    setDeleting(undefined);
    refocus.current = 'add';
    const removed = isLive ? await command('token.delete', { token_id: token.id }) : await sceneTokens.remove(token.id);
    if (removed) {
      setSelectedToken(undefined);
      announce(t('tokens.deleted', { label: token.label }));
    }
  }

  const announce = (message: string) => setStatus({ message, n: ++announced.current });

  async function changeToken(token: SceneToken, body: TokenUpdateBody, done: (updated: SceneToken) => string) {
    if (isLive) return changeLive(token, body, done);
    const result = await sceneTokens.change(token.id, body);
    if (result.ok) announce(done(result.token));
  }

  // A live move or visibility change shows at once and is dropped when answered: by then its events
  // have brought the live scene in step (D-111), or the refusal leaves the token where it was.
  async function changeLive(token: SceneToken, body: TokenUpdateBody, done: (updated: SceneToken) => string) {
    const seq = ++pendingSeq.current;
    const { x, y, hidden } = body;
    const moving = x !== undefined && y !== undefined;
    const shown = moving ? { x, y } : hidden !== undefined ? { hidden } : {};
    setPending((current) => ({ ...current, [token.id]: { seq, fields: { ...current[token.id]?.fields, ...shown } } }));
    const ok = moving
      ? await command('token.move', { token_id: token.id, x, y })
      : await command('token.setVisibility', { token_id: token.id, hidden });
    setPending((current) =>
      current[token.id]?.seq === seq
        ? Object.fromEntries(Object.entries(current).filter(([id]) => id !== token.id))
        : current,
    );
    const updated = live?.current()?.tokens.find((each) => each.id === token.id);
    if (ok && updated) announce(done(updated));
  }

  // The TV camera from the frame: shown at once, settled by the answer, whose event brought the live
  // scene's camera in step (D-111), or whose refusal leaves the frame where it was.
  async function steerTv(camera: PlayerCamera) {
    // Not connected: nothing is sent, and the head already says why, as for undo (D-116, review U-M2).
    if (offline) return announce(t('scene.tvOffline'));
    const seq = ++cameraSeq.current;
    setPendingCamera({ seq, camera });
    const ok = await command('camera.setPlayer', { scene_id: sceneId, camera }, 'scene.tvFailed');
    setPendingCamera((current) => (current?.seq === seq ? undefined : current));
    if (!ok) return;
    const fitted = (Object.keys(FIT_CAMERA) as (keyof PlayerCamera)[]).every((key) => camera[key] === FIT_CAMERA[key]);
    announce(t(fitted ? 'scene.tvFitted' : 'scene.tvSteered'));
  }
  const tvFrame: TvFrame | undefined =
    liveScene && !draft
      ? {
          camera: pendingCamera?.camera ?? liveScene.camera,
          screen: liveScene.screen,
          offline,
          steering,
          onSteer: setSteering,
          onChange: (camera) => void steerTv(camera),
        }
      : undefined;

  // One undo at a time: Ctrl+Z pressed again, or held down, before the server answers is ignored,
  // so a held key never unwinds the live scene one change after another (LIV-05 review U5).
  const undoing = useRef(false);

  async function undoLast() {
    // While calibrating, Ctrl+Z is not the token history's: nothing is sent (review U6).
    if (draft || undoing.current) return;
    setLiveFailure(undefined);
    // Not connected: nothing is sent, and the head already says why (D-116, review U3).
    if (offline || !live) return announce(t('scene.undoOffline'));
    undoing.current = true;
    // Cleared first, so the answer is a new message even when it reads as the last one (review U11).
    setStatus(undefined);
    const before = live.current();
    const outcome = await live.command('undo', {});
    undoing.current = false;
    if (!outcome.ok) {
      setLiveFailure(
        STALE_UNDO.has(outcome.code)
          ? t('scene.undoStale')
          : t('scene.undoFailed', { reason: errorMessage(outcome.code) }),
      );
      return;
    }
    // The undo's own events arrived before its acknowledgement (D-111): none means nothing was left.
    announce(undoneMessage(before, live.current()));
  }

  // Ctrl+Z in live mode, wherever focus is in the DM view but a text field or a dialog.
  const undoKey = useRef<() => void>(undefined);
  undoKey.current = () => void undoLast();
  useEffect(() => {
    if (!isLive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isUndoKey(event) || typesText(event.target)) return;
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      if (!event.repeat) undoKey.current?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isLive]);

  // Moves are announced too, since the canvas says nothing to assistive technology (review).
  const moved = (updated: SceneToken) =>
    t('tokens.moved', {
      label: updated.label,
      column: formatDecimal(updated.x + 1),
      row: formatDecimal(updated.y + 1),
    });

  const placing: Placing | undefined = placingAsset
    ? {
        size: placingAsset.size,
        onPlace: (at) => void placeToken(placingAsset, at),
        onCancel: cancelPlacing,
      }
    : undefined;
  const tokenControls: CanvasTokenControls | undefined = draft
    ? undefined
    : {
        selectedId: selectedToken,
        onSelect: selectToken,
        onDeselect: () => setSelectedToken(undefined),
        onMove: (id, at) => {
          const token = tokens?.find((each) => each.id === id);
          if (token) void changeToken(token, at, moved);
        },
        onDelete: (id) => openDialog(() => setDeleting(tokens?.find((token) => token.id === id))),
      };

  // The token controls, on the canvas toolbar's row (D-100); neither while calibrating, which
  // takes the row above the canvas, nor before the tokens have arrived.
  const tokenFailure =
    !isLive && sceneTokens.loadFailure ? t('tokens.loadFailed', { reason: sceneTokens.loadFailure }) : undefined;
  const tokenBar =
    draft || !tokens ? undefined : placingAsset ? (
      <div
        className="eg-tokens"
        role="group"
        aria-label={t('tokens.bar')}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            cancelPlacing();
          }
        }}
      >
        <p className="eg-tokens__placing">{t('tokens.placing', { name: placingAsset.name })}</p>
        <Button size="small" onClick={cancelPlacing}>
          {t('tokens.cancelPlacing')}
        </Button>
      </div>
    ) : (
      <TokenBar
        tokens={tokens}
        selectedId={selected?.id}
        onSelect={selectToken}
        onAdd={() => {
          setStatus(undefined);
          setPicking(true);
        }}
        onToggleHidden={(token) =>
          void changeToken(token, { hidden: !token.hidden }, (updated) =>
            t(updated.hidden ? 'tokens.hidden' : 'tokens.revealed', { label: updated.label }),
          )
        }
        onRename={(token) => openDialog(() => setRenaming(token))}
        onStack={(token, stack) =>
          void changeToken(token, { stack }, (updated) =>
            t(stack === 'front' ? 'tokens.toFront' : 'tokens.toBack', { label: updated.label }),
          )
        }
        onDelete={(token) => openDialog(() => setDeleting(token))}
        busy={false}
        live={isLive}
      />
    );

  const percent = Math.round((progress ?? 0) * 100);
  const measure: Measure | undefined =
    draft?.method === 'rectangle' && map
      ? {
          rect: draft.rect,
          onDraw: (rect) =>
            setDraft((current) => current && withRect(current, rect, { width: map.width, height: map.height })),
        }
      : undefined;
  const loading = <p className="eg-dm__status">{t('workspace.loadingScene')}</p>;

  return (
    <div ref={panelRef} className="eg-scene" data-mode={isLive ? 'live' : 'prep'}>
      <div className="eg-scene__head">
        <div className="eg-scene__title">
          <h1 className="eg-dm__heading">{name}</h1>
          {isLive ? (
            <p className={`eg-scene__mode eg-scene__mode--${offline ? 'offline' : 'live'}`}>{t(modeLabel)}</p>
          ) : null}
        </div>
        {/* One status region, always mounted, so a message is announced when it appears: after a
          map upload, and after a save that closes the calibration panel (D-096). */}
        <div role="status" className="eg-scene__progress">
          {uploading ? (
            <>
              <progress max={100} value={percent} aria-label={t('sceneMap.uploading')} />
              <span>{t('sceneMap.progress', { percent })}</span>
            </>
          ) : status === 'attached' ? (
            <span>{t('sceneMap.attached')}</span>
          ) : status === 'calibrated' ? (
            <span>{t('calibration.saved')}</span>
          ) : typeof status === 'object' ? (
            <span key={status.n}>{status.message}</span>
          ) : null}
        </div>
      </div>
      {failure ? <Notice>{failure}</Notice> : null}
      {liveFailure ? <Notice>{liveFailure}</Notice> : null}
      {!isLive && sceneTokens.failure ? <Notice>{sceneTokens.failure}</Notice> : null}
      {mapFailedFor !== undefined && mapFailedFor === mapId ? <Notice>{t('sceneMap.loadFailed')}</Notice> : null}
      {scene ? (
        <>
          {/* While calibrating, the calibration panel takes the setup's place (D-094). */}
          {draft ? null : (
            <div className="eg-scene__setup">
              <form ref={formRef} className="eg-scene__map" onSubmit={(event) => void attach(event)} noValidate>
                <TextField
                  type="file"
                  accept={ACCEPT}
                  label={scene.map_image_id ? t('sceneMap.replaceImage') : t('sceneMap.image')}
                  error={fileError}
                  aria-disabled={busy || undefined}
                  onClick={(event) => {
                    if (busy) event.preventDefault();
                  }}
                  onChange={(event) => chooseFile(event.target.files?.[0])}
                />
                <Button
                  ref={submitRef}
                  type="submit"
                  aria-disabled={busy || undefined}
                  aria-describedby={scene.map_image_id ? hintId : undefined}
                >
                  {scene.map_image_id ? t('sceneMap.replace') : t('sceneMap.attach')}
                </Button>
                {scene.map_image_id ? (
                  <p id={hintId} className="eg-scene__hint">
                    {t('sceneMap.replaceHint')}
                  </p>
                ) : null}
              </form>
              <div className="eg-check">
                <input
                  id={gridId}
                  type="checkbox"
                  checked={savingGrid ?? scene.grid.visible}
                  aria-disabled={busy || undefined}
                  onClick={(event) => {
                    if (busy) event.preventDefault();
                  }}
                  onChange={(event) => void setGridVisible(event.target.checked)}
                />
                <label htmlFor={gridId}>{t('sceneGrid.visible')}</label>
              </div>
              {map ? (
                <Button ref={calibrateRef} aria-disabled={busy || undefined} onClick={() => startCalibration(map)}>
                  {t('calibration.open')}
                </Button>
              ) : null}
            </div>
          )}
          {tokenFailure ? (
            <div className="eg-tokens__failure">
              <Notice>{tokenFailure}</Notice>
              <Button size="small" onClick={sceneTokens.retry}>
                {t('tokens.retry')}
              </Button>
            </div>
          ) : null}
          {map !== undefined ? (
            <div className="eg-scene__body">
              {map && draft ? (
                <CalibrationPanel
                  map={map}
                  draft={draft}
                  onChange={(change) => setDraft((current) => current && change(current))}
                  onSave={() => void saveCalibration()}
                  onCancel={cancelCalibration}
                  saving={savingCalibration}
                />
              ) : null}
              <div className={frameClass}>
                <MapCanvas
                  grid={draft ? { ...scene.grid, ...draft.calibration } : scene.grid}
                  map={map}
                  mode="dm"
                  label={t(!isLive ? 'canvas.label' : offline ? 'canvas.labelOffline' : 'canvas.labelLive', { name })}
                  onMapError={() => setMapFailedFor(mapId ?? undefined)}
                  measure={measure}
                  toolbar={tokenBar}
                  tokens={tokens?.map(toCanvasToken) ?? []}
                  tokenControls={tokenControls}
                  placing={placing}
                  tvFrame={tvFrame}
                />
                {map && draft ? <CornerMagnifier map={map} calibration={draft.calibration} /> : null}
              </div>
            </div>
          ) : failure ? null : (
            loading
          )}
          {picking ? (
            <TokenPicker
              onPick={pick}
              onClose={() => {
                setPicking(false);
                refocus.current = 'add';
              }}
            />
          ) : null}
          {renaming ? (
            <RenameDialog
              token={renaming}
              onSave={async (label) => {
                const result = await sceneTokens.change(renaming.id, { label }, { inline: true });
                if (result.ok) announce(t('tokens.renamed', { label: result.token.label }));
                return result.ok ? undefined : 'message' in result ? result.message : undefined;
              }}
              onClose={() => {
                setRenaming(undefined);
                refocus.current = 'opener';
              }}
            />
          ) : null}
          {deleting ? (
            <DeleteTokenDialog
              token={deleting}
              onConfirm={() => void deleteToken(deleting)}
              onClose={() => {
                setDeleting(undefined);
                refocus.current = 'opener';
              }}
            />
          ) : null}
          {confirmReplace ? (
            <Dialog
              heading={t('sceneMap.replaceCalibrated.heading')}
              onClose={() => {
                setConfirmReplace(false);
                refocus.current = 'replace';
              }}
            >
              <p className="eg-dialog__body">{t('sceneMap.replaceCalibrated.body')}</p>
              <div className="eg-dialog__actions">
                <Button
                  variant="primary"
                  onClick={() => {
                    setConfirmReplace(false);
                    refocus.current = 'replace';
                    if (file) void send(file);
                  }}
                >
                  {t('sceneMap.replaceCalibrated.confirm')}
                </Button>
                <Button
                  onClick={() => {
                    setConfirmReplace(false);
                    refocus.current = 'replace';
                  }}
                >
                  {t('sceneMap.replaceCalibrated.cancel')}
                </Button>
              </div>
            </Dialog>
          ) : null}
        </>
      ) : failure ? null : (
        loading
      )}
    </div>
  );
}
