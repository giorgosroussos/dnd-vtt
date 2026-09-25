import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { API_IMAGE_PATHS, type Image, type Scene, type SceneGridUpdate } from '@emberglass/shared';
import { MapCanvas, type Measure } from '../canvas/MapCanvas.js';
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
  const [status, setStatus] = useState<'attached' | 'calibrated'>();
  const [mapFailedFor, setMapFailedFor] = useState<string>();
  const [draft, setDraft] = useState<Draft>();
  const [savingCalibration, setSavingCalibration] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  // Where focus goes once the calibration panel or the confirmation has closed: set with the
  // state change that closes it, and taken after that render.
  const refocus = useRef<'calibrate' | 'replace'>(undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const calibrateRef = useRef<HTMLButtonElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (refocus.current === 'calibrate') calibrateRef.current?.focus();
    if (refocus.current === 'replace') submitRef.current?.focus();
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
    <div className="eg-scene">
      <h1 className="eg-dm__heading">{name}</h1>
      {failure ? <Notice>{failure}</Notice> : null}
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
                  ) : null}
                </div>
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
                />
                {map && draft ? <CornerMagnifier map={map} calibration={draft.calibration} /> : null}
              </div>
            </div>
          ) : failure ? null : (
            loading
          )}
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
