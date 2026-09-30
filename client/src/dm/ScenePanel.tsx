import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  API_IMAGE_PATHS,
  FEET_PER_SQUARE_BOUNDS,
  FIT_CAMERA,
  rulerFeet,
  type CommandType,
  type Measurement,
  type RulerRule,
  type PlayerCamera,
  type Image,
  type LibraryAsset,
  type Scene,
  type SceneGridUpdate,
  type SceneToken,
  type TokenUpdateBody,
} from '@emberglass/shared';
import { formatDecimal, formatNumber } from '../canvas/calibration.js';
import {
  MapCanvas,
  type CanvasHandle,
  type CanvasRail,
  type CanvasTokenControls,
  type Measure,
  type Placing,
  type PingTool,
  type RulerTool,
  type TvFrame,
} from '../canvas/MapCanvas.js';
import { samePath, type RulerPath } from '../canvas/ruler.js';
import { Button } from '../ui/Button.js';
import { Dialog } from '../ui/Dialog.js';
import { Icon } from '../ui/icons.js';
import { Notice } from '../ui/Notice.js';
import { TextField } from '../ui/TextField.js';
import { errorMessage } from '../ui/errorMessage.js';
import { t, type MessageKey } from '../ui/messages.js';
import { useHeldFor } from '../ui/useHeldFor.js';
import { errorCode, request, upload } from './api.js';
import { CONNECTION_NOTICE_DELAY_MS } from './LiveBar.js';
import { SidePanel, type SideTab } from './SidePanel.js';
import { CalibrationPanel } from './calibration/CalibrationPanel.js';
import { CornerMagnifier } from './calibration/CornerMagnifier.js';
import { startDraft, withRect, type Draft } from './calibration/draft.js';
import { megabytes } from './library/labels.js';
import type { DmScene } from './live/dmScene.js';
import type { DmLive } from './live/useDmLive.js';
import { entityPath } from './tree/paths.js';
import { DeleteTokenDialog, RenameDialog } from './tokens/TokenBar.js';
import { TokenList } from './tokens/TokenList.js';
import { TokenPicker } from './tokens/TokenPicker.js';
import { TokenPopover } from './tokens/TokenPopover.js';
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
// The redesign (UIX-01, specs/08-ux-journeys.md §11, Q-100): the panel is the workspace's centre and its
// right-hand panel. Above the canvas, the scene's name and, on the live scene, the TV camera controls; the
// setup behind the Scene setup button; the tool rail, grid status and zoom on the canvas; the shortcut bar
// below it. The right-hand panel's first tab lists the scene's tokens, its second the library.
//
// Tokens (PRP-04, specs/05-assets-and-images.md §3–§5, specs/06-grid-and-measurement.md §4, D-100):
// Add token (the rail, T, or the token list) opens the picker; the chosen asset is then placed by a click
// on the map, or by Enter at the centre of the view, and the server numbers it and sets its visibility
// from the asset. The selected token is moved by dragging or by the arrow keys, and hidden, revealed,
// renamed, duplicated, restacked or deleted from its popover beside it (H hides or reveals it).
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
// Undo and redo (LIV-05, UIX-01, specs/04-live-sync.md §8, specs/08-ux-journeys.md §3, D-040, D-117): in
// live mode, the rail's Undo and Redo, or Ctrl+Z and Ctrl+Shift+Z or Ctrl+Y (Cmd on a Mac) anywhere in the
// DM view, send `undo` and `redo`, the rail greying each while the server says it would do nothing; the server applies the most recent
// inverse, and its events bring this canvas and the TV in step. A text field keeps its own undo and an
// open dialog takes none; in prep mode, while calibrating and while not connected nothing is sent, and
// a held or repeated Ctrl+Z waits for the answer to the first. The status line names what the undo's
// events changed before its acknowledgement (D-111), or says that nothing was left (D-118).
//
// The TV camera (LIV-06, specs/04-live-sync.md §9, specs/08-ux-journeys.md §2, §11, Q-080, D-119): in live
// mode the canvas shows the frame of what the TV sees, in the shape of the screen the server says it
// follows, from the live scene, so it follows another DM browser's steering. Dropping the frame, or one of
// the TV camera buttons (Send my view, Fit map, TV zoom out and in), sends `camera.setPlayer`; the frame
// stays where it was put until the server answers, and a refusal says why above the canvas. The DM's own
// view does not move. Setting the TV camera is not undoable (specs/04-live-sync.md §2). Lock TV camera,
// kept by the workspace for this DM view only (D-140), refuses the buttons and the frame.
//
// The ruler (LIV-07, specs/06-grid-and-measurement.md §5, specs/04-live-sync.md §11, Q-027, Q-086, D-121):
// the canvas's Ruler measures between square centres by the server-wide diagonal rule and the scene's feet
// per square, which the setup sets. In prep mode the measurement stays in this view: nothing is sent. In
// live mode each new measurement sends `ruler.update` and clearing it `ruler.clear`, at most one command
// in flight and the latest waiting, so a fast drag never queues a command per square; the canvas shows
// what this view sent until it is answered, and then what the server says the TV shows, another DM
// browser's measurement included. Turning the ruler off clears the measurement. The ruler, placing and a
// selected token take the pointer and the keys in turn.
//
// Shortcuts (UIX-01, specs/08-ux-journeys.md §11): V selects, M measures, T adds a token, H hides or
// reveals the selected token, Ctrl+Z undoes and Ctrl+Shift+Z or Ctrl+Y redoes, from anywhere in the DM
// view but a text field or an open dialog; none acts while typing.
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
  // Only the tokens say what an undo did: the undo state changes with it (UIX-01).
  if (after?.tokens === before?.tokens) return t('scene.nothingToUndo');
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

/** Ctrl+Shift+Z or Cmd+Shift+Z, or Ctrl+Y: redo (UIX-01), read as `isUndoKey` reads its key. */
export function isRedoKey(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
  const key = event.key.toLowerCase();
  const z = key === 'z' || (!/^[a-z]$/.test(key) && event.code === 'KeyZ');
  const y = key === 'y' || (!/^[a-z]$/.test(key) && event.code === 'KeyY');
  return (z && event.shiftKey) || (y && !event.shiftKey);
}

export function ScenePanel({
  sceneId,
  name,
  uploadLimit,
  rulerRule = 'phb',
  onRulerOn,
  live,
  mainId = 'main',
  sideTab = 'scene',
  onSideTab = () => {},
  library,
  tvLocked = false,
  onTvLocked = () => {},
  setupOpen: setupOpenProp,
  onSetupOpen,
  onTokensChanged,
}: {
  sceneId: string;
  name: string;
  uploadLimit: number;
  /** The id of the main landmark the skip link goes to. */
  mainId?: string | undefined;
  /** The right-hand panel's tab, kept by the workspace across scenes. */
  sideTab?: SideTab | undefined;
  onSideTab?: ((tab: SideTab) => void) | undefined;
  /** The asset library, the right-hand panel's second tab. */
  library?: ReactNode;
  /** Lock TV camera, kept by the workspace for this DM view (D-140). */
  tvLocked?: boolean | undefined;
  onTvLocked?: ((locked: boolean) => void) | undefined;
  /** Whether the Scene setup is open, kept by the workspace across scenes; the panel keeps its own without. */
  setupOpen?: boolean | undefined;
  onSetupOpen?: ((open: boolean) => void) | undefined;
  /** Told after a change to the scene's tokens or map, so the scene list's counts and thumbnail are read again. */
  onTokensChanged?: (() => void) | undefined;
  /** The server-wide diagonal rule the ruler measures by (specs/06-grid-and-measurement.md §5, Q-037). */
  rulerRule?: RulerRule | undefined;
  /** Told when measuring starts, so the workspace reads the rule again: another browser may have changed it (G-036). */
  onRulerOn?: (() => void) | undefined;
  /** The workspace's live connection: whether this scene is live, and the commands (LIV-04). */
  live?: DmLive | undefined;
}) {
  const gridId = useId();
  const hintId = useId();
  const liveScene = live?.scene != null && live.scene.scene.id === sceneId ? live.scene : undefined;
  const isLive = liveScene !== undefined;
  // Live mode while the connection is down: nothing done here reaches the TV until it is back (review M3).
  const offline = isLive && live?.status !== 'connected';
  // What the DM is shown of it waits as the live bar's notice does, so a reconnection on waking,
  // back within a second, does not flash "not connected" (review U-L1); commands are refused at once.
  const shownOffline = useHeldFor(offline, CONNECTION_NOTICE_DELAY_MS);
  // Live mode names itself in the head, not by colour alone (specs/08-ux-journeys.md §2, review M4).
  const modeLabel = shownOffline ? 'scene.liveOffline' : 'scene.live';
  const frameClass = !isLive
    ? 'eg-scene__canvas'
    : `eg-scene__canvas eg-scene__canvas--live${shownOffline ? ' eg-scene__canvas--offline' : ''}`;
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
  // Feet per square as typed, until saved (LIV-07); undefined shows the scene's own.
  const [feetText, setFeetText] = useState<string>();
  const [feetError, setFeetError] = useState<string>();
  const [savingFeet, setSavingFeet] = useState(false);
  // Read by a second save started before the first has rendered (Enter, then leaving the field; review C-L4).
  const savingFeetNow = useRef(false);
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
  const panelRef = useRef<HTMLElement>(null);
  const sceneTokens = useSceneTokens(sceneId, isLive);
  // Moves and visibility changes sent in live mode, shown until the server has answered (LIV-04).
  const [pending, setPending] = useState<
    Record<string, { seq: number; fields: { x?: number; y?: number; hidden?: boolean } }>
  >({});
  const pendingSeq = useRef(0);
  const [liveFailure, setLiveFailure] = useState<string>();
  // The TV camera sent and not yet answered (LIV-06), and the canvas the TV camera buttons act through.
  const canvas = useRef<CanvasHandle>(null);
  const [ownSetupOpen, setOwnSetupOpen] = useState(false);
  const setupOpen = setupOpenProp ?? ownSetupOpen;
  const setSetupOpen = (open: boolean) => (onSetupOpen ? onSetupOpen(open) : setOwnSetupOpen(open));
  const [pendingCamera, setPendingCamera] = useState<{ seq: number; camera: PlayerCamera }>();
  const cameraSeq = useRef(0);
  // The ruler (LIV-07): whether it measures, the measurement kept in this view in prep mode, and in live
  // mode the one sent and not yet answered (null: a clear). Going live or back to prep starts afresh, so
  // nothing measured in preparation ever reaches the TV (Q-086).
  const [rulerOn, setRulerOn] = useState(false);
  const [prepPath, setPrepPath] = useState<RulerPath | null>(null);
  const [rulerDraft, setRulerDraft] = useState<RulerPath | null>();
  const rulerQueue = useRef<{ busy: boolean; next: RulerPath | null | undefined }>({ busy: false, next: undefined });
  // The measurement this panel last had shown on the TV: leaving the scene takes it off, unless the TV
  // shows another by then (D-121, review C-L2).
  const sentPath = useRef<RulerPath | null>(null);
  // What to announce once the server has shown it: a measurement, or null for a clear (review U-L2).
  const toAnnounce = useRef<RulerPath | null | undefined>(undefined);
  // Whether the scene is live now, for a ruler command sent from an earlier render (review C-L1).
  const liveNow = useRef(isLive);
  liveNow.current = isLive;
  // The ping tool (TBL-01): on the live scene only, so it stops when the scene stops being live.
  const [pingOn, setPingOn] = useState(false);
  const [rulerMode, setRulerMode] = useState(isLive);
  if (rulerMode !== isLive) {
    setRulerMode(isLive);
    setRulerOn(false);
    setPingOn(false);
    setPrepPath(null);
    setRulerDraft(undefined);
    rulerQueue.current.next = undefined;
    toAnnounce.current = undefined;
  }
  const [selectedToken, setSelectedToken] = useState<string>();
  // Choosing a token gives the arrow keys back to it and ends measuring.
  const selectToken = (id: string | undefined) => {
    setSelectedToken(id);
    // Ending measuring takes the measurement off, on the TV too (review C-M1).
    if (id !== undefined) {
      stopMeasuring();
      setPingOn(false);
    }
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
    if (refocus.current === 'add')
      panelRef.current?.querySelector<HTMLButtonElement>('[data-tool="add-token"]')?.focus();
    if (refocus.current === 'canvas') panelRef.current?.querySelector<HTMLElement>('[role="application"]')?.focus();
    if (refocus.current === 'opener') {
      if (opener.current?.isConnected) opener.current.focus();
      else panelRef.current?.querySelector<HTMLButtonElement>('[data-tool="add-token"]')?.focus();
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
      // The scene list shows the new map's thumbnail.
      onTokensChanged?.();
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

  // Feet per square scales the ruler (specs/06-grid-and-measurement.md §5, Q-087); on the live scene the
  // server pushes it to both rooms in a snapshot, with the distance shown recounted (D-121).
  // Saved on Enter and when focus leaves the field, only when the DM typed something. A value out of bounds
  // is refused beside the field on Enter, where focus still is; on leaving the field it is put back to the
  // stored value and the status line says so, since the field's own error would not be heard (review U-L1).
  // Its save does not hold the other setup controls, and what is typed meanwhile is kept for the next save.
  async function saveFeet(event?: FormEvent, leaving = false) {
    event?.preventDefault();
    if (!scene || savingFeetNow.current || feetText === undefined) return;
    const text = feetText.trim();
    const feet = Number(text);
    const { min, max } = FEET_PER_SQUARE_BOUNDS;
    if (text === '' || !Number.isFinite(feet) || feet < min || feet > max) {
      const bounds = { min: formatNumber(min), max: formatNumber(max) };
      if (!leaving) return setFeetError(t('sceneGrid.feetInvalid', bounds));
      setFeetText(undefined);
      setFeetError(undefined);
      announce(t('sceneGrid.feetRestored', { ...bounds, feet: formatNumber(scene.grid.feet_per_square) }));
      return;
    }
    const keepTyped = (current: string | undefined) => (current === feetText ? undefined : current);
    if (feet === scene.grid.feet_per_square) return setFeetText(keepTyped);
    savingFeetNow.current = true;
    setSavingFeet(true);
    setFailure(undefined);
    setStatus(undefined);
    try {
      const saved = await request<Scene>('PATCH', entityPath('scene', scene.id), { grid: { feet_per_square: feet } });
      setScene(saved);
      setFeetText(keepTyped);
      announce(t('sceneGrid.feetSaved', { feet: formatNumber(saved.grid.feet_per_square) }));
    } catch (error) {
      setFailure(errorMessage(errorCode(error)));
    } finally {
      savingFeetNow.current = false;
      setSavingFeet(false);
    }
  }

  function startCalibration(target: Image) {
    if (!scene || busy) return;
    stopMeasuring();
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
    stopMeasuring();
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
          // The frame locks at once: a drag while down would reach no TV.
          offline,
          locked: tvLocked,
          onChange: (camera) => void steerTv(camera),
        }
      : undefined;

  // The ruler. In live mode the latest measurement is sent once the one in flight is answered.
  const feetPerSquare = scene?.grid.feet_per_square ?? 5;
  const measured = (path: RulerPath): Measurement => ({
    ...path,
    feet: rulerFeet(path.from, path.to, rulerRule, feetPerSquare),
  });
  const announceDistance = (path: RulerPath) =>
    announce(t('ruler.distance', { feet: formatNumber(measured(path).feet) }));
  const announcePath = (path: RulerPath | null) => (path ? announceDistance(path) : announce(t('ruler.cleared')));

  async function sendRuler(next: RulerPath | null) {
    const queue = rulerQueue.current;
    queue.next = next;
    if (queue.busy) return;
    queue.busy = true;
    while (queue.next !== undefined) {
      const path = queue.next;
      queue.next = undefined;
      // Back in prep mode meanwhile (another browser's Blank TV): nothing more is sent (review C-L1).
      if (!liveNow.current) break;
      const ok = path
        ? await command('ruler.update', { scene_id: sceneId, ...path }, 'scene.rulerFailed')
        : await command('ruler.clear', { scene_id: sceneId }, 'scene.rulerFailed');
      if (!liveNow.current) {
        // A refusal because the scene stopped being live says nothing over a panel now in prep mode.
        setLiveFailure(undefined);
        break;
      }
      if (ok) {
        sentPath.current = path;
        const waiting = toAnnounce.current;
        // Announced once the TV shows it, and only when nothing newer waits (review U-L2).
        if (waiting !== undefined && queue.next === undefined && samePath(waiting, path)) {
          toAnnounce.current = undefined;
          announcePath(path);
        }
      } else {
        // A refusal drops what waits too: the canvas shows what the TV shows.
        queue.next = undefined;
        toAnnounce.current = undefined;
      }
    }
    queue.next = undefined;
    queue.busy = false;
    setRulerDraft(undefined);
  }

  function measureRuler(path: RulerPath, final: boolean) {
    if (!isLive) {
      setPrepPath(path);
      if (final) announceDistance(path);
      return;
    }
    // Not connected: nothing is sent and nothing is drawn as if the TV showed it (D-116, D-120).
    if (offline) {
      if (final) announce(t('scene.rulerOffline'));
      return;
    }
    const shown = rulerDraft !== undefined ? rulerDraft : (liveScene?.ruler ?? null);
    if (!samePath(path, shown)) {
      if (final) toAnnounce.current = path;
      setRulerDraft(path);
      void sendRuler(path);
    } else if (rulerQueue.current.busy) {
      // Already on its way: announced once it is shown.
      if (final) toAnnounce.current = path;
    } else if (final) {
      announceDistance(path);
    }
  }

  function clearMeasurement() {
    if (!isLive) {
      if (prepPath) announce(t('ruler.cleared'));
      setPrepPath(null);
      return;
    }
    const shown = rulerDraft !== undefined ? rulerDraft : (liveScene?.ruler ?? null);
    if (shown === null && !rulerQueue.current.busy) return;
    if (offline) return announce(t('scene.rulerOffline'));
    toAnnounce.current = null;
    setRulerDraft(null);
    void sendRuler(null);
  }

  function stopMeasuring() {
    if (!rulerOn) return;
    setRulerOn(false);
    clearMeasurement();
  }

  // Leaving the scene, or the view, takes this panel's measurement off the TV: nobody would see it here.
  const leave = useRef<() => void>(undefined);
  leave.current = () => {
    const shown = liveScene?.ruler;
    if (isLive && shown && samePath(shown, sentPath.current)) void live?.command('ruler.clear', { scene_id: sceneId });
  };
  useEffect(() => () => leave.current?.(), []);

  const rulerTool: RulerTool | undefined = draft
    ? undefined
    : {
        on: rulerOn,
        onToggle: (on) => {
          if (!on) return stopMeasuring();
          setPingOn(false);
          setRulerOn(true);
          onRulerOn?.();
          setSelectedToken(undefined);
        },
        onMeasure: measureRuler,
        onClear: clearMeasurement,
      };
  const livePath = rulerDraft !== undefined ? rulerDraft : undefined;
  const shownRuler: Measurement | null = !isLive
    ? prepPath && measured(prepPath)
    : livePath !== undefined
      ? livePath && measured(livePath)
      : (liveScene?.ruler ?? null);

  // Ping (TBL-01, specs/04-live-sync.md §12): a click on the live scene, or Enter at the view's centre,
  // marks the point on the TV and here; nothing is kept. Not connected, nothing is sent.
  const pingTool: PingTool | undefined =
    draft || !isLive || !live
      ? undefined
      : {
          on: pingOn,
          onToggle: (on) => {
            if (on) {
              stopMeasuring();
              setSelectedToken(undefined);
              if (placingAsset) setPlacingAsset(undefined);
            }
            setPingOn(on);
          },
          onPing: (at) => {
            if (offline) return announce(t('scene.pingOffline'));
            void command('ping', { scene_id: sceneId, x: at.x, y: at.y }, 'scene.pingFailed');
          },
        };

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

  // Redo (UIX-01): as undo, one at a time, and only on the live scene.
  const redoing = useRef(false);
  async function redoLast() {
    if (draft || redoing.current) return;
    setLiveFailure(undefined);
    if (offline || !live) return announce(t('scene.redoOffline'));
    redoing.current = true;
    setStatus(undefined);
    const before = live.current();
    const outcome = await live.command('redo', {});
    redoing.current = false;
    if (!outcome.ok) {
      setLiveFailure(
        STALE_UNDO.has(outcome.code)
          ? t('scene.redoStale')
          : t('scene.redoFailed', { reason: errorMessage(outcome.code) }),
      );
      return;
    }
    const after = live.current();
    announce(after?.tokens === before?.tokens ? t('scene.nothingToRedo') : t('scene.redone'));
  }

  // The shortcuts, wherever focus is in the DM view but a text field or a dialog (UIX-01). The canvas
  // handles its own keys first (M on the map among them) and marks them handled.
  const keys = useRef<(event: KeyboardEvent) => void>(undefined);
  keys.current = (event: KeyboardEvent) => {
    if (event.defaultPrevented || typesText(event.target)) return;
    if (document.querySelector('dialog[open]')) return;
    if (isRedoKey(event) || isUndoKey(event)) {
      if (!isLive) return;
      event.preventDefault();
      if (event.repeat) return;
      if (isRedoKey(event)) void redoLast();
      else void undoLast();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === 'v') {
      event.preventDefault();
      selectTool();
    } else if (key === 'm' && rulerTool) {
      event.preventDefault();
      rulerTool.onToggle(!rulerOn);
    } else if (key === 'p' && pingTool) {
      event.preventDefault();
      pingTool.onToggle(!pingOn);
    } else if (key === 't' && canAddToken) {
      event.preventDefault();
      openPicker();
    } else if (key === 'h' && selected && tokenControls) {
      event.preventDefault();
      toggleHidden(selected);
    }
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keys.current?.(event);
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

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

  // The token controls: neither while calibrating nor before the tokens have arrived.
  const tokenFailure =
    !isLive && sceneTokens.loadFailure ? t('tokens.loadFailed', { reason: sceneTokens.loadFailure }) : undefined;
  const canAddToken = !draft && tokens !== undefined && !placingAsset;

  function openPicker() {
    setStatus(undefined);
    setPingOn(false);
    setPicking(true);
  }

  // Select (V): leaves the ruler and the ping tool and stops placing (UIX-01).
  function selectTool() {
    stopMeasuring();
    setPingOn(false);
    if (placingAsset) setPlacingAsset(undefined);
  }

  function toggleHidden(token: SceneToken) {
    void changeToken(token, { hidden: !token.hidden }, (updated) =>
      t(updated.hidden ? 'tokens.hidden' : 'tokens.revealed', { label: updated.label }),
    ).then(() => onTokensChanged?.());
  }

  // Reveal all hidden monsters: one change each, in turn (UIX-01); on the live scene each is its own
  // `token.setVisibility`, undone one at a time.
  async function revealAll(hidden: SceneToken[]) {
    for (const token of hidden) {
      await changeToken(token, { hidden: false }, (updated) => t('tokens.revealed', { label: updated.label }));
    }
    if (hidden.length > 1) announce(t('sceneTokens.revealedAll', { count: hidden.length }));
    onTokensChanged?.();
  }

  // Duplicate: a new token of the same asset a square to the right, numbered by the server (UIX-01).
  async function duplicateToken(token: SceneToken) {
    const at = { x: token.x + 1, y: token.y };
    const placed = isLive ? await placeLive(token.asset_id, at) : await sceneTokens.place(token.asset_id, at);
    if (!placed) return;
    setSelectedToken(placed.id);
    announce(t('tokens.placed', { label: placed.label }));
    onTokensChanged?.();
  }

  const rail: CanvasRail = {
    onSelect: selectTool,
    onAddToken: canAddToken ? openPicker : undefined,
    history:
      liveScene && !draft
        ? {
            canUndo: liveScene.history.can_undo,
            canRedo: liveScene.history.can_redo,
            onUndo: () => void undoLast(),
            onRedo: () => void redoLast(),
          }
        : undefined,
  };
  const gridStatus = scene ? (
    <>
      <span>{t('canvas.gridStatus', { feet: formatNumber(scene.grid.feet_per_square) })}</span>
      <span className="eg-canvas__status-dot" aria-hidden="true" />
      <span>{t(rulerRule === 'dmg' ? 'canvas.diagonalsDmg' : 'canvas.diagonalsPhb')}</span>
    </>
  ) : null;
  const popover =
    tokens && !placingAsset
      ? (anchor: Parameters<NonNullable<Parameters<typeof MapCanvas>[0]['popover']>>[0]) =>
          selected ? (
            <TokenPopover
              token={selected}
              anchor={anchor}
              live={isLive}
              onToggleHidden={() => toggleHidden(selected)}
              onRename={() => openDialog(() => setRenaming(selected))}
              onDuplicate={() => void duplicateToken(selected)}
              onStack={(stack) =>
                void changeToken(selected, { stack }, (updated) =>
                  t(stack === 'front' ? 'tokens.toFront' : 'tokens.toBack', { label: updated.label }),
                )
              }
              onDelete={() => openDialog(() => setDeleting(selected))}
            />
          ) : null
      : undefined;
  const tokenList = tokens ? (
    <TokenList
      tokens={tokens}
      selectedId={selected?.id}
      onSelect={(token) => {
        selectToken(token.id);
        canvas.current?.centreOn(token.id);
      }}
      onToggleHidden={toggleHidden}
      onRevealAll={(hidden) => void revealAll(hidden)}
      onAdd={canAddToken ? openPicker : undefined}
    />
  ) : tokenFailure ? null : (
    <p className="eg-dm__status">{t('tokens.loading')}</p>
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

  const setupId = `${gridId}-setup`;
  const setup =
    scene && !draft && setupOpen ? (
      <div id={setupId} className="eg-scene__setup" role="region" aria-label={t('sceneSetup.label')}>
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
            size="small"
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
        <form className="eg-scene__feet" onSubmit={(event) => void saveFeet(event)} noValidate>
          <TextField
            type="number"
            inputMode="decimal"
            step="any"
            min={FEET_PER_SQUARE_BOUNDS.min}
            max={FEET_PER_SQUARE_BOUNDS.max}
            label={t('sceneGrid.feet')}
            value={feetText ?? String(scene.grid.feet_per_square)}
            error={feetError}
            aria-busy={savingFeet || undefined}
            onChange={(event) => {
              setFeetText(event.target.value);
              setFeetError(undefined);
            }}
            onBlur={() => void saveFeet(undefined, true)}
          />
        </form>
        {map ? (
          <Button
            ref={calibrateRef}
            size="small"
            aria-disabled={busy || undefined}
            onClick={() => startCalibration(map)}
          >
            {t('calibration.open')}
          </Button>
        ) : null}
      </div>
    ) : null;

  const tvControls =
    liveScene && !draft ? (
      <div className="eg-tv" role="group" aria-label={t('tvCamera.label')}>
        <span className="eg-tv__label" aria-hidden="true">
          {t('tvCamera.heading')}
        </span>
        <button
          type="button"
          className="eg-button eg-button--small"
          aria-label={t('tvCamera.sendView')}
          aria-disabled={tvLocked || undefined}
          onClick={() => canvas.current?.sendView()}
        >
          {t('tvCamera.sendViewShort')}
        </button>
        <button
          type="button"
          className="eg-button eg-button--small"
          aria-label={t('canvas.tvFit')}
          aria-disabled={tvLocked || undefined}
          onClick={() => canvas.current?.tvFit()}
        >
          {t('canvas.fit')}
        </button>
        <button
          type="button"
          className="eg-icon-button eg-icon-button--bordered"
          aria-label={t('canvas.tvZoomOut')}
          aria-disabled={tvLocked || undefined}
          onClick={() => canvas.current?.tvZoom('out')}
        >
          <Icon name="minus" size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="eg-icon-button eg-icon-button--bordered"
          aria-label={t('canvas.tvZoomIn')}
          aria-disabled={tvLocked || undefined}
          onClick={() => canvas.current?.tvZoom('in')}
        >
          <Icon name="plus" size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="eg-icon-button eg-icon-button--bordered"
          aria-label={t('tvCamera.lock')}
          aria-pressed={tvLocked}
          onClick={() => {
            onTvLocked(!tvLocked);
            announce(t(tvLocked ? 'tvCamera.unlocked' : 'tvCamera.locked'));
          }}
        >
          <Icon name={tvLocked ? 'lock' : 'unlock'} size={14} strokeWidth={2} />
        </button>
      </div>
    ) : null;

  return (
    <>
      <main
        id={mainId}
        tabIndex={-1}
        ref={panelRef}
        className="eg-scene"
        data-view="dm"
        data-mode={isLive ? 'live' : 'prep'}
      >
        <div className="eg-scene__head">
          <div className="eg-scene__title">
            <h1 className="eg-scene__name">{name}</h1>
            {isLive ? (
              <p className={`eg-scene__mode eg-scene__mode--${offline ? 'offline' : 'live'}`}>{t(modeLabel)}</p>
            ) : null}
          </div>
          <div className="eg-scene__tools">
            {tvControls}
            {scene && !draft ? (
              <button
                type="button"
                className="eg-button eg-button--small"
                aria-expanded={setupOpen}
                aria-controls={setupOpen ? setupId : undefined}
                onClick={() => setSetupOpen(!setupOpen)}
              >
                <Icon name="setup" size={14} />
                {t('sceneSetup.open')}
              </button>
            ) : null}
          </div>
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
        {failure ? <Notice>{failure}</Notice> : null}
        {liveFailure ? <Notice>{liveFailure}</Notice> : null}
        {!isLive && sceneTokens.failure ? <Notice>{sceneTokens.failure}</Notice> : null}
        {mapFailedFor !== undefined && mapFailedFor === mapId ? <Notice>{t('sceneMap.loadFailed')}</Notice> : null}
        {scene ? (
          <>
            {setup}
            {tokenFailure ? (
              <div className="eg-tokens__failure">
                <Notice>{tokenFailure}</Notice>
                <Button size="small" onClick={sceneTokens.retry}>
                  {t('tokens.retry')}
                </Button>
              </div>
            ) : null}
            {placingAsset ? (
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
                    ref={canvas}
                    grid={draft ? { ...scene.grid, ...draft.calibration } : scene.grid}
                    map={map}
                    mode="dm"
                    label={t(!isLive ? 'canvas.label' : shownOffline ? 'canvas.labelOffline' : 'canvas.labelLive', {
                      name,
                    })}
                    onMapError={() => setMapFailedFor(mapId ?? undefined)}
                    measure={measure}
                    rail={draft ? undefined : rail}
                    status={gridStatus}
                    popover={draft ? undefined : popover}
                    tokens={tokens?.map(toCanvasToken) ?? []}
                    tokenControls={tokenControls}
                    placing={placing}
                    tvFrame={tvFrame}
                    ruler={{ shown: shownRuler, tool: rulerTool }}
                    ping={{ shown: isLive && live ? live.pings : [], tool: pingTool }}
                  />
                  {map && draft ? <CornerMagnifier map={map} calibration={draft.calibration} /> : null}
                </div>
              </div>
            ) : failure ? null : (
              loading
            )}
            <ShortcutBar live={isLive} />
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
                  if (result.ok) {
                    announce(t('tokens.renamed', { label: result.token.label }));
                    onTokensChanged?.();
                  }
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
      </main>
      <SidePanel tab={sideTab} onTab={onSideTab} scene={tokenList} library={library} />
    </>
  );
}

/** The shortcut bar along the bottom of the map area (UIX-01, specs/08-ux-journeys.md §11). */
function ShortcutBar({ live }: { live: boolean }) {
  const keys: [MessageKey, MessageKey][] = [
    ['shortcuts.keyV', 'shortcuts.select'],
    ['shortcuts.keyM', 'shortcuts.ruler'],
    ['shortcuts.keyP', 'shortcuts.ping'],
    ['shortcuts.keyH', 'shortcuts.hide'],
    ['shortcuts.keyUndo', 'shortcuts.undo'],
    ['shortcuts.keySpace', 'shortcuts.pan'],
  ];
  return (
    <div className="eg-shortcuts" aria-label={t('shortcuts.label')} role="note">
      {keys.map(([key, action]) => (
        <span key={key} className="eg-shortcuts__item">
          <kbd>{t(key)}</kbd>
          {t(action)}
        </span>
      ))}
      <span className="eg-shortcuts__note">{t(live ? 'shortcuts.noteLive' : 'shortcuts.notePrep')}</span>
    </div>
  );
}
