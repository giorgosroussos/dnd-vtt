import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  API_IMAGE_PATHS,
  type Image,
  type LibraryAsset,
  type Scene,
  type SceneGridUpdate,
  type SceneToken,
  type TokenUpdateBody,
} from '@emberglass/shared';
import { formatDecimal } from '../canvas/calibration.js';
import { MapCanvas, type CanvasTokenControls, type Measure, type Placing } from '../canvas/MapCanvas.js';
import { Button } from '../ui/Button.js';
import { Dialog } from '../ui/Dialog.js';
import { Notice } from '../ui/Notice.js';
import { TextField } from '../ui/TextField.js';
import { errorMessage } from '../ui/errorMessage.js';
import { t } from '../ui/messages.js';
import { errorCode, request, upload } from './api.js';
import { CalibrationPanel } from './calibration/CalibrationPanel.js';
import { CornerMagnifier } from './calibration/CornerMagnifier.js';
import { startDraft, withRect, type Draft } from './calibration/draft.js';
import { megabytes } from './library/labels.js';
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
// restacked or deleted from the token bar. The live scene's tokens are refused by the server
// (specs/04-live-sync.md §2); live mode is LIV-04's.
//
// The workspace keys this panel by scene: a request still running when another scene is
// selected ends in a panel that is gone, so its answer changes nothing on screen. One change
// runs at a time; while it does, the controls stay focusable but refuse, so keyboard focus
// is never dropped (D-093), and the status line says what happened.

const ACCEPT = 'image/png,image/jpeg,image/webp';
const imagePath = (id: string): string => API_IMAGE_PATHS.image.replace(':id', id);
// Refusals of the file itself are shown beside the field (D-069); anything else above.
const FILE_REFUSALS = new Set(['unsupported_media_type', 'payload_too_large']);

export function ScenePanel({ sceneId, name, uploadLimit }: { sceneId: string; name: string; uploadLimit: number }) {
  const gridId = useId();
  const hintId = useId();
  const [scene, setScene] = useState<Scene>();
  const [loadedMap, setLoadedMap] = useState<Image>();
  const [failure, setFailure] = useState<string>();
  const [file, setFile] = useState<File>();
  const [fileError, setFileError] = useState<string>();
  const [progress, setProgress] = useState<number>();
  // The value being saved, shown at once; the server's answer replaces it, a refusal drops it.
  const [savingGrid, setSavingGrid] = useState<boolean>();
  const [status, setStatus] = useState<'attached' | 'calibrated' | { message: string }>();
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
  const sceneTokens = useSceneTokens(sceneId);
  const [selectedToken, setSelectedToken] = useState<string>();
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

  useEffect(() => {
    request<Scene>('GET', entityPath('scene', sceneId)).then(setScene, (error: unknown) =>
      setFailure(errorMessage(errorCode(error))),
    );
  }, [sceneId]);

  const mapId = scene?.map_image_id;
  useEffect(() => {
    if (typeof mapId !== 'string') return;
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
  }, [mapId]);
  // Null for a scene without a map; undefined while the map's record is on its way.
  const map = mapId === null ? null : loadedMap && loadedMap.id === mapId ? loadedMap : undefined;

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

  // Tokens.

  const tokens = sceneTokens.tokens;
  const selected = tokens?.find((token) => token.id === selectedToken);

  const openDialog = (open: () => void) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    open();
  };

  function pick(asset: LibraryAsset) {
    setPicking(false);
    setStatus(undefined);
    setPlacingAsset(asset);
    refocus.current = 'canvas';
  }

  function cancelPlacing() {
    setPlacingAsset(undefined);
    refocus.current = 'add';
  }

  async function placeToken(asset: LibraryAsset, at: { x: number; y: number }) {
    setPlacingAsset(undefined);
    const token = await sceneTokens.place(asset.id, at);
    refocus.current = 'canvas';
    if (!token) return;
    setSelectedToken(token.id);
    announce(t('tokens.placed', { label: token.label }));
  }

  async function deleteToken(token: SceneToken) {
    setDeleting(undefined);
    refocus.current = 'add';
    if (await sceneTokens.remove(token.id)) {
      setSelectedToken(undefined);
      announce(t('tokens.deleted', { label: token.label }));
    }
  }

  const announce = (message: string) => setStatus({ message });

  async function changeToken(token: SceneToken, body: TokenUpdateBody, done: (updated: SceneToken) => string) {
    const result = await sceneTokens.change(token.id, body);
    if (result.ok) announce(done(result.token));
  }

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
        onSelect: setSelectedToken,
        onDeselect: () => setSelectedToken(undefined),
        onMove: (id, at) => {
          const token = tokens?.find((each) => each.id === id);
          if (token) void changeToken(token, at, moved);
        },
        onDelete: (id) => openDialog(() => setDeleting(tokens?.find((token) => token.id === id))),
      };

  // The token controls, on the canvas toolbar's row (D-100); neither while calibrating, which
  // takes the row above the canvas, nor before the tokens have arrived.
  const tokenFailure = sceneTokens.loadFailure
    ? t('tokens.loadFailed', { reason: sceneTokens.loadFailure })
    : undefined;
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
        onSelect={setSelectedToken}
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
    <div ref={panelRef} className="eg-scene">
      <div className="eg-scene__head">
        <h1 className="eg-dm__heading">{name}</h1>
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
            <span>{status.message}</span>
          ) : null}
        </div>
      </div>
      {failure ? <Notice>{failure}</Notice> : null}
      {sceneTokens.failure ? <Notice>{sceneTokens.failure}</Notice> : null}
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
              <div className="eg-scene__canvas">
                <MapCanvas
                  grid={draft ? { ...scene.grid, ...draft.calibration } : scene.grid}
                  map={map}
                  mode="dm"
                  label={t('canvas.label', { name })}
                  onMapError={() => setMapFailedFor(mapId ?? undefined)}
                  measure={measure}
                  toolbar={tokenBar}
                  tokens={tokens?.map(toCanvasToken) ?? []}
                  tokenControls={tokenControls}
                  placing={placing}
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
