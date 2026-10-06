import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import {
  API_STRUCTURE_PATHS as PATHS,
  hasNotes,
  imageFileUrl,
  notesPreview,
  type Scene,
  type SceneSummary,
  type Session,
} from '@emberglass/shared';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/icons.js';
import { Menu } from '../../ui/Menu.js';
import { Notice } from '../../ui/Notice.js';
import { TextField } from '../../ui/TextField.js';
import { errorMessage } from '../../ui/errorMessage.js';
import { t } from '../../ui/messages.js';
import { useFocusLater } from '../../ui/useFocusLater.js';
import { errorCode, request } from '../api.js';
import { DeleteDialog, type DeleteTarget } from '../tree/DeleteDialog.js';
import { entityPath, sceneOrderPath, scenesPath } from '../tree/paths.js';

const summariesPath = (sessionId: string): string => PATHS.sceneSummaries.replace(':id', encodeURIComponent(sessionId));
const duplicatePath = (sceneId: string): string => PATHS.sceneDuplicate.replace(':id', encodeURIComponent(sceneId));

export interface SessionScenes {
  /** Undefined while loading or with no session chosen. */
  scenes: Scene[] | undefined;
  /** Each scene's token counts, by scene id. */
  summaries: ReadonlyMap<string, SceneSummary>;
  failure: string | undefined;
  reload: () => void;
}

/**
 * The current session's scenes and their token counts (UIX-01), read when the session changes and again
 * on `reload`, and whenever `version` changes: the workspace bumps it when tokens change.
 */
export function useSessionScenes(sessionId: string | undefined, version: string): SessionScenes {
  const [scenes, setScenes] = useState<Scene[]>();
  const [summaries, setSummaries] = useState<ReadonlyMap<string, SceneSummary>>(new Map());
  const [failure, setFailure] = useState<string>();
  const [reads, setReads] = useState(0);
  const reload = useCallback(() => setReads((count) => count + 1), []);
  useEffect(() => {
    if (sessionId === undefined) return;
    let active = true;
    Promise.all([
      request<Scene[]>('GET', scenesPath(sessionId)),
      request<SceneSummary[]>('GET', summariesPath(sessionId)),
    ]).then(
      ([list, counts]) => {
        if (!active) return;
        setScenes(list);
        setSummaries(new Map(counts.map((each) => [each.id, each])));
        setFailure(undefined);
      },
      (error: unknown) => {
        if (active) setFailure(errorMessage(errorCode(error)));
      },
    );
    return () => {
      active = false;
    };
  }, [sessionId, version, reads]);
  // Another session: nothing of the last one is shown meanwhile.
  const [shownFor, setShownFor] = useState(sessionId);
  if (shownFor !== sessionId) {
    setShownFor(sessionId);
    setScenes(undefined);
  }
  return { scenes: sessionId === undefined ? undefined : scenes, summaries, failure, reload };
}

/** `ids` with `id` moved to where `target` is. */
function moved(ids: readonly string[], id: string, target: string): string[] {
  const next = ids.filter((each) => each !== id);
  next.splice(ids.indexOf(target), 0, id);
  return next;
}

/**
 * The scene after `from` in the session's order: the scene NEXT UP names (UIX-01). From the live scene
 * when it is in this session, else from the scene being edited; none after the last.
 */
export function nextScene(scenes: readonly Scene[], liveId: string | undefined, selectedId: string | undefined) {
  const from = scenes.some((scene) => scene.id === liveId) ? liveId : selectedId;
  if (from === undefined) return scenes.find((scene) => scene.id !== liveId);
  const index = scenes.findIndex((scene) => scene.id === from);
  return index < 0 ? undefined : scenes[index + 1];
}

// The left sidebar (UIX-01, specs/08-ux-journeys.md §1, §11, Q-089, Q-100): the current session's title
// and scene count, a button to add a scene, and its scenes in order, each with its map's thumbnail, its
// name and how many tokens it holds and how many are hidden, and a page mark when it has notes (DMT-04). The
// live scene says it is on the TV; every other scene has a button that puts it on the TV. Scenes reorder by dragging, or by Move up and Move down
// in each scene's menu, which also renames, duplicates and deletes (specs/03-domain-model.md §7). The
// footer names the scene NEXT UP with Go live (Shift+N, handled by the workspace). The server's answer is
// always what the list shows next: after a change it is read again.
export function SceneList({
  session,
  scenes,
  selectedId,
  liveId,
  connected,
  onSelect,
  onPutOnTv,
  onChanged,
  onScenesRemoved,
  onSceneRenamed,
  onChooseSession,
  actions,
}: {
  session: Session | undefined;
  scenes: SessionScenes;
  selectedId: string | undefined;
  liveId: string | undefined;
  connected: boolean;
  onSelect: (scene: Scene) => void;
  onPutOnTv: (scene: Scene) => void;
  onChanged: () => void;
  onScenesRemoved: (ids: string[]) => void;
  onSceneRenamed: (scene: Scene) => void;
  onChooseSession: () => void;
  /** Controls of the sidebar itself, beside New scene in the header (UXR-01). */
  actions?: ReactNode;
}) {
  const root = useRef<HTMLElement>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string>();
  const [deleting, setDeleting] = useState<DeleteTarget>();
  const [failure, setFailure] = useState<string>();
  const [dragging, setDragging] = useState<string>();
  const [over, setOver] = useState<string>();
  const [busy, setBusy] = useState(false);
  const focusLater = useFocusLater();
  const list = scenes.scenes;
  const ids = list?.map((scene) => scene.id) ?? [];
  const focusScene = (id: string) =>
    focusLater(() => root.current?.querySelector<HTMLElement>(`[data-scene="${id}"] .eg-scenes__select`));

  async function attempt(work: () => Promise<void>): Promise<boolean> {
    try {
      await work();
      setFailure(undefined);
      return true;
    } catch (error) {
      setFailure(errorMessage(errorCode(error)));
      return false;
    }
  }

  async function create(name: string): Promise<boolean> {
    if (!session) return false;
    return attempt(async () => {
      const scene = await request<Scene>('POST', scenesPath(session.id), { name });
      setCreating(false);
      onChanged();
      onSelect(scene);
      focusScene(scene.id);
    });
  }

  async function rename(scene: Scene, name: string): Promise<boolean> {
    return attempt(async () => {
      const renamed = await request<Scene>('PATCH', entityPath('scene', scene.id), { name });
      setRenaming(undefined);
      onChanged();
      onSceneRenamed(renamed);
      focusScene(scene.id);
    });
  }

  async function reorder(next: string[], focus?: string) {
    if (!session || busy) return;
    setBusy(true);
    const ok = await attempt(async () => {
      await request<Scene[]>('PUT', sceneOrderPath(session.id), { ids: next });
    });
    setBusy(false);
    // Another browser changed the list meanwhile: show what the server has now, keeping the message.
    onChanged();
    if (ok && focus) focusScene(focus);
  }

  async function duplicate(scene: Scene) {
    await attempt(async () => {
      const copy = await request<Scene>('POST', duplicatePath(scene.id), {
        name: t('scenes.copyName', { name: scene.name }),
      });
      onChanged();
      onSelect(copy);
      focusScene(copy.id);
    });
  }

  if (!session) {
    return (
      <nav className="eg-scenes" aria-label={t('scenes.label')}>
        {actions ? <div className="eg-scenes__actions eg-scenes__actions--alone">{actions}</div> : null}
        <p className="eg-dm__status">{t('scenes.noSession')}</p>
        <div>
          <Button onClick={onChooseSession}>{t('header.chooseSession')}</Button>
        </div>
      </nav>
    );
  }

  const count = list?.length ?? 0;
  return (
    <nav ref={root} className="eg-scenes" aria-label={t('scenes.label')}>
      <div className="eg-scenes__head">
        <div className="eg-scenes__title">
          <h2 className="eg-scenes__session">{session.title}</h2>
          <p className="eg-scenes__count">
            {count > 1
              ? t('scenes.countDrag', { count })
              : t(count === 1 ? 'scenes.count.one' : 'scenes.count.other', { count })}
          </p>
        </div>
        <div className="eg-scenes__actions">
          <button
            type="button"
            className="eg-icon-button"
            aria-label={t('tree.newScene')}
            aria-expanded={creating}
            onClick={() => setCreating((open) => !open)}
          >
            <Icon name="plus" size={18} />
          </button>
          {actions}
        </div>
      </div>
      {failure ? <Notice>{failure}</Notice> : null}
      {scenes.failure ? <Notice>{scenes.failure}</Notice> : null}
      {creating ? (
        <NameForm
          label={t('tree.sceneName')}
          submit={t('tree.create')}
          onSubmit={create}
          onCancel={() => setCreating(false)}
        />
      ) : null}
      {list === undefined ? (
        <p className="eg-dm__status">{t('tree.loading')}</p>
      ) : list.length === 0 ? (
        <p className="eg-dm__status">{t('tree.noScenes')}</p>
      ) : (
        <ol className="eg-scenes__list">
          {list.map((scene, index) => {
            const summary = scenes.summaries.get(scene.id);
            const live = scene.id === liveId;
            const selected = scene.id === selectedId;
            const drop =
              dragging !== undefined && dragging !== scene.id
                ? {
                    onDragOver: (event: DragEvent) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      if (over !== scene.id) setOver(scene.id);
                    },
                    onDragLeave: () => {
                      if (over === scene.id) setOver(undefined);
                    },
                    onDrop: (event: DragEvent) => {
                      event.preventDefault();
                      setOver(undefined);
                      void reorder(moved(ids, dragging, scene.id));
                      setDragging(undefined);
                    },
                  }
                : {};
            if (renaming === scene.id) {
              return (
                <li key={scene.id} data-scene={scene.id} className="eg-scenes__item">
                  <NameForm
                    label={t('tree.renameLabel', { name: scene.name })}
                    submit={t('tree.save')}
                    initial={scene.name}
                    onSubmit={(name) => rename(scene, name)}
                    onCancel={() => {
                      setRenaming(undefined);
                      focusScene(scene.id);
                    }}
                  />
                </li>
              );
            }
            return (
              <li
                key={scene.id}
                data-scene={scene.id}
                className={[
                  'eg-scenes__item',
                  selected ? 'eg-scenes__item--selected' : '',
                  over === scene.id ? 'eg-scenes__item--drop' : '',
                ].join(' ')}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', scene.id);
                  setDragging(scene.id);
                }}
                onDragEnd={() => {
                  setDragging(undefined);
                  setOver(undefined);
                }}
                {...drop}
              >
                <button
                  type="button"
                  className="eg-scenes__select"
                  aria-current={selected || undefined}
                  onClick={() => onSelect(scene)}
                >
                  <span className="eg-scenes__thumb">
                    {scene.map_image_id ? <img src={imageFileUrl(scene.map_image_id, 'thumbnail')} alt="" /> : null}
                    {hasNotes(scene.notes) ? (
                      // The scene has notes (DMT-04): a small page on the thumbnail's corner, their first lines on hover.
                      <span
                        className="eg-note-mark eg-scenes__notes"
                        title={notesPreview(scene.notes)}
                        data-note-mark=""
                      >
                        <Icon name="note" size={12} />
                        <span className="eg-visually-hidden">{t('notes.sceneHas', { name: scene.name })}</span>
                      </span>
                    ) : null}
                  </span>
                  <span className="eg-scenes__text">
                    <span className="eg-scenes__name">{scene.name}</span>
                    {live ? (
                      <span className="eg-scenes__live">
                        <span className="eg-scenes__live-dot" aria-hidden="true" />
                        {t('scenes.onTv')}
                      </span>
                    ) : (
                      <span className="eg-scenes__summary">{summaryText(summary)}</span>
                    )}
                  </span>
                </button>
                {live ? null : (
                  <button
                    type="button"
                    className="eg-icon-button"
                    aria-label={t('scenes.putOnTv', { name: scene.name })}
                    aria-disabled={!connected || undefined}
                    onClick={() => onPutOnTv(scene)}
                  >
                    <Icon name="onTv" />
                  </button>
                )}
                <Menu
                  label={t('scenes.actionsOf', { name: scene.name })}
                  icon={<Icon name="more" />}
                  items={[
                    {
                      label: t('tree.moveUp'),
                      disabledReason: index === 0 ? t('scenes.alreadyFirst') : busy ? t('scenes.busy') : undefined,
                      onSelect: () => void reorder(moved(ids, scene.id, ids[index - 1]!), scene.id),
                    },
                    {
                      label: t('tree.moveDown'),
                      disabledReason:
                        index === list.length - 1 ? t('scenes.alreadyLast') : busy ? t('scenes.busy') : undefined,
                      onSelect: () => void reorder(moved(ids, scene.id, ids[index + 1]!), scene.id),
                    },
                    { label: t('tree.rename'), onSelect: () => setRenaming(scene.id) },
                    { label: t('scenes.duplicate'), onSelect: () => void duplicate(scene) },
                    {
                      label: t('tree.delete'),
                      danger: true,
                      onSelect: () => setDeleting({ kind: 'scene', id: scene.id, name: scene.name }),
                    },
                  ]}
                />
              </li>
            );
          })}
        </ol>
      )}
      {deleting ? (
        <DeleteDialog
          target={deleting}
          onDeleted={() => {
            onScenesRemoved([deleting.id]);
            setDeleting(undefined);
            onChanged();
            focusLater(() => root.current?.querySelector<HTMLElement>('.eg-scenes__head button'));
          }}
          onClose={() => setDeleting(undefined)}
        />
      ) : null}
    </nav>
  );
}

function summaryText(summary: SceneSummary | undefined): string {
  if (!summary) return '';
  if (summary.tokens === 0) return t('scenes.noTokens');
  const tokens = t(summary.tokens === 1 ? 'scenes.tokens.one' : 'scenes.tokens.other', { count: summary.tokens });
  return summary.hidden === 0 ? tokens : t('scenes.tokensHidden', { tokens, hidden: summary.hidden });
}

/** A name to create or rename with; a name must have something besides white space. */
export function NameForm({
  label,
  submit,
  initial = '',
  onSubmit,
  onCancel,
}: {
  label: string;
  submit: string;
  initial?: string;
  onSubmit: (name: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (value.trim() === '') return setError(t('tree.nameRequired'));
    setPending(true);
    await onSubmit(value.trim());
    setPending(false);
  }
  return (
    <form
      className="eg-scenes__form"
      onSubmit={(event) => void send(event)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
      noValidate
    >
      <TextField
        label={label}
        value={value}
        error={error}
        autoFocus
        onChange={(event) => {
          setValue(event.target.value);
          setError(undefined);
        }}
      />
      <div className="eg-scenes__form-actions">
        <Button size="small" type="submit" variant="primary" aria-disabled={pending || undefined}>
          {submit}
        </Button>
        <Button size="small" onClick={onCancel}>
          {t('tree.cancel')}
        </Button>
      </div>
    </form>
  );
}
