import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { API_STRUCTURE_PATHS as PATHS, type Campaign, type Scene, type Session } from '@emberglass/shared';
import { Button } from '../../ui/Button.js';
import { Notice } from '../../ui/Notice.js';
import { TextField } from '../../ui/TextField.js';
import { errorMessage } from '../../ui/errorMessage.js';
import { t, type MessageKey } from '../../ui/messages.js';
import { errorCode, request } from '../api.js';
import { DeleteDialog, type DeleteTarget } from './DeleteDialog.js';
import { entityPath, sceneOrderPath, scenesPath, sessionOrderPath, sessionsPath, type TreeKind } from './paths.js';

// The Campaign → Session → Scene tree of the sidebar (specs/08-ux-journeys.md §1,
// Q-023, Q-089, Q-090, D-078, D-079, D-085). Nested lists in the disclosure pattern:
// a campaign or session is a button that opens its children, loaded on first open.
// Every action is a visible button in the Tab order. Sessions and scenes reorder by
// dragging among their siblings, or by Move up and Move down from the keyboard;
// campaigns stay in the server's order, by name. The server's answer is always
// what the tree shows next: after a change, the list it changed is read again.

type Ordered = 'session' | 'scene';
type Action = 'name' | 'up' | 'down' | 'rename';

interface Dragging {
  kind: Ordered;
  parentId: string;
  id: string;
}

interface Props {
  selectedSceneId: string | undefined;
  onSelectScene: (scene: Scene) => void;
  onScenesRemoved: (ids: string[]) => void;
  onSceneRenamed: (scene: Scene) => void;
}

const nameOf = (item: Campaign | Session | Scene): string => ('title' in item ? item.title : item.name);

/** `ids` with `id` moved to where `target` is. */
function moved(ids: readonly string[], id: string, target: string): string[] {
  const next = ids.filter((each) => each !== id);
  next.splice(ids.indexOf(target), 0, id);
  return next;
}

export function SceneTree({ selectedSceneId, onSelectScene, onScenesRemoved, onSceneRenamed }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>();
  const [sessions, setSessions] = useState<Record<string, Session[]>>({});
  const [scenes, setScenes] = useState<Record<string, Scene[]>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<string>();
  // The one create form open, by the id of its parent ('' for a new campaign).
  const [creating, setCreating] = useState<string>();
  const [renaming, setRenaming] = useState<string>();
  const [deleting, setDeleting] = useState<DeleteTarget>();
  const [dragging, setDragging] = useState<Dragging>();
  const [focusNext, setFocusNext] = useState<{ id: string; action: Action }>();

  // Runs a request; its failure is shown above the tree, by its catalogue message.
  const attempt = useCallback(async (work: () => Promise<void>): Promise<boolean> => {
    try {
      await work();
      setFailure(undefined);
      return true;
    } catch (error) {
      setFailure(errorMessage(errorCode(error)));
      return false;
    }
  }, []);

  const loadCampaigns = useCallback(
    () => attempt(async () => setCampaigns(await request<Campaign[]>('GET', PATHS.campaigns))),
    [attempt],
  );
  const loadSessions = useCallback(
    (campaignId: string) =>
      attempt(async () => {
        const list = await request<Session[]>('GET', sessionsPath(campaignId));
        setSessions((all) => ({ ...all, [campaignId]: list }));
      }),
    [attempt],
  );
  const loadScenes = useCallback(
    (sessionId: string) =>
      attempt(async () => {
        const list = await request<Scene[]>('GET', scenesPath(sessionId));
        setScenes((all) => ({ ...all, [sessionId]: list }));
      }),
    [attempt],
  );

  useEffect(() => {
    request<Campaign[]>('GET', PATHS.campaigns).then(setCampaigns, (error: unknown) =>
      setFailure(errorMessage(errorCode(error))),
    );
  }, []);

  // After a move, a rename or a create, keyboard focus goes back to the same item:
  // the same control when it can still take focus, else the item's name.
  useEffect(() => {
    if (!focusNext || !root.current) return;
    const item = root.current.querySelector(`[data-item="${focusNext.id}"]`);
    if (!item) return;
    const wanted = item.querySelector<HTMLButtonElement>(`[data-action="${focusNext.action}"]`);
    const target = wanted && !wanted.disabled ? wanted : item.querySelector<HTMLButtonElement>('[data-action="name"]');
    target?.focus();
    setFocusNext(undefined);
  }, [focusNext, campaigns, sessions, scenes, renaming]);

  function toggle(id: string, load: () => Promise<boolean>, loaded: boolean) {
    const open = !expanded.has(id);
    setExpanded((all) => {
      const next = new Set(all);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
    if (open && !loaded) void load();
  }

  const expand = (id: string) => setExpanded((all) => new Set(all).add(id));

  // Create, rename, reorder, delete

  async function create(parentId: string, name: string): Promise<boolean> {
    return attempt(async () => {
      if (parentId === '') {
        const campaign = await request<Campaign>('POST', PATHS.campaigns, { name });
        setCampaigns(await request<Campaign[]>('GET', PATHS.campaigns));
        setFocusNext({ id: campaign.id, action: 'name' });
      } else if (campaigns?.some((campaign) => campaign.id === parentId)) {
        const session = await request<Session>('POST', sessionsPath(parentId), { title: name });
        setSessions({ ...sessions, [parentId]: await request<Session[]>('GET', sessionsPath(parentId)) });
        expand(parentId);
        setFocusNext({ id: session.id, action: 'name' });
      } else {
        const scene = await request<Scene>('POST', scenesPath(parentId), { name });
        setScenes({ ...scenes, [parentId]: await request<Scene[]>('GET', scenesPath(parentId)) });
        expand(parentId);
        setFocusNext({ id: scene.id, action: 'name' });
      }
      setCreating(undefined);
    });
  }

  async function rename(kind: TreeKind, item: Campaign | Session | Scene, name: string): Promise<boolean> {
    return attempt(async () => {
      const body = kind === 'session' ? { title: name } : { name };
      await request('PATCH', entityPath(kind, item.id), body);
      if (kind === 'campaign') setCampaigns(await request<Campaign[]>('GET', PATHS.campaigns));
      if (kind === 'session') {
        const { campaign_id } = item as Session;
        setSessions({ ...sessions, [campaign_id]: await request<Session[]>('GET', sessionsPath(campaign_id)) });
      }
      if (kind === 'scene') {
        const { session_id } = item as Scene;
        const list = await request<Scene[]>('GET', scenesPath(session_id));
        setScenes({ ...scenes, [session_id]: list });
        const renamed = list.find((scene) => scene.id === item.id);
        if (renamed) onSceneRenamed(renamed);
      }
      setRenaming(undefined);
      setFocusNext({ id: item.id, action: 'rename' });
    });
  }

  async function reorder(kind: Ordered, parentId: string, ids: string[], focus?: { id: string; action: Action }) {
    const ok = await attempt(async () => {
      if (kind === 'session') {
        const list = await request<Session[]>('PUT', sessionOrderPath(parentId), { ids });
        setSessions((all) => ({ ...all, [parentId]: list }));
      } else {
        const list = await request<Scene[]>('PUT', sceneOrderPath(parentId), { ids });
        setScenes((all) => ({ ...all, [parentId]: list }));
      }
      if (focus) setFocusNext(focus);
    });
    // Another browser changed the list meanwhile: show what the server has now,
    // keeping the message that says why the move did not happen.
    if (!ok) {
      if (kind === 'session') {
        request<Session[]>('GET', sessionsPath(parentId)).then(
          (list) => setSessions((all) => ({ ...all, [parentId]: list })),
          () => undefined,
        );
      } else {
        request<Scene[]>('GET', scenesPath(parentId)).then(
          (list) => setScenes((all) => ({ ...all, [parentId]: list })),
          () => undefined,
        );
      }
    }
  }

  // The deleted item's focus goes to its parent, or for a campaign to New campaign,
  // so the keyboard is not left on the page body.
  function deleted(target: DeleteTarget) {
    setDeleting(undefined);
    if (target.kind === 'campaign') {
      const removed = (sessions[target.id] ?? []).flatMap((session) => (scenes[session.id] ?? []).map((s) => s.id));
      onScenesRemoved(removed);
      void loadCampaigns().then(() =>
        root.current?.querySelector<HTMLButtonElement>('[data-action="new-campaign"]')?.focus(),
      );
    } else if (target.kind === 'session') {
      onScenesRemoved((scenes[target.id] ?? []).map((scene) => scene.id));
      const parent = Object.keys(sessions).find((id) => sessions[id]!.some((session) => session.id === target.id));
      if (parent) void loadSessions(parent).then(() => setFocusNext({ id: parent, action: 'name' }));
    } else {
      onScenesRemoved([target.id]);
      const parent = Object.keys(scenes).find((id) => scenes[id]!.some((scene) => scene.id === target.id));
      if (parent) void loadScenes(parent).then(() => setFocusNext({ id: parent, action: 'name' }));
    }
  }

  // Rows

  function row(
    kind: TreeKind,
    item: Campaign | Session | Scene,
    options: {
      siblings?: readonly string[];
      parentId?: string;
      open?: boolean;
      onName: () => void;
      children?: ReactNode;
    },
  ) {
    const name = nameOf(item);
    const orderable = kind !== 'campaign' && options.siblings !== undefined && options.parentId !== undefined;
    const index = options.siblings?.indexOf(item.id) ?? -1;
    const drop =
      orderable && dragging && dragging.kind === kind && dragging.parentId === options.parentId
        ? {
            onDragOver: (event: DragEvent) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            },
            onDrop: (event: DragEvent) => {
              event.preventDefault();
              if (dragging.id !== item.id) {
                void reorder(kind, options.parentId!, moved(options.siblings!, dragging.id, item.id));
              }
              setDragging(undefined);
            },
          }
        : {};
    const move = (delta: -1 | 1) => {
      const ids = [...options.siblings!];
      ids.splice(index, 1);
      ids.splice(index + delta, 0, item.id);
      void reorder(kind as Ordered, options.parentId!, ids, { id: item.id, action: delta < 0 ? 'up' : 'down' });
    };
    return (
      <li key={item.id} className={`eg-tree__item eg-tree__item--${kind}`} data-item={item.id}>
        {renaming === item.id ? (
          <NameForm
            label={t('tree.renameLabel', { name })}
            initial={name}
            submitLabel="tree.save"
            onSubmit={(value) => rename(kind, item, value)}
            onCancel={() => {
              setRenaming(undefined);
              setFocusNext({ id: item.id, action: 'rename' });
            }}
          />
        ) : (
          <div
            className={`eg-tree__row${kind === 'scene' && item.id === selectedSceneId ? ' eg-tree__row--selected' : ''}`}
            draggable={orderable}
            onDragStart={
              orderable
                ? (event) => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', item.id);
                    setDragging({ kind, parentId: options.parentId!, id: item.id });
                  }
                : undefined
            }
            onDragEnd={() => setDragging(undefined)}
            {...drop}
          >
            <button
              type="button"
              className="eg-tree__name"
              data-action="name"
              aria-expanded={kind === 'scene' ? undefined : options.open}
              aria-current={kind === 'scene' && item.id === selectedSceneId ? 'true' : undefined}
              onClick={options.onName}
            >
              {name}
            </button>
            <span className="eg-tree__actions">
              {orderable ? (
                <>
                  <Button
                    size="small"
                    data-action="up"
                    aria-label={t('tree.moveUpOf', { name })}
                    disabled={index <= 0}
                    onClick={() => move(-1)}
                  >
                    {t('tree.moveUp')}
                  </Button>
                  <Button
                    size="small"
                    data-action="down"
                    aria-label={t('tree.moveDownOf', { name })}
                    disabled={index < 0 || index >= options.siblings!.length - 1}
                    onClick={() => move(1)}
                  >
                    {t('tree.moveDown')}
                  </Button>
                </>
              ) : null}
              <Button
                size="small"
                data-action="rename"
                aria-label={t('tree.renameOf', { name })}
                onClick={() => setRenaming(item.id)}
              >
                {t('tree.rename')}
              </Button>
              <Button
                size="small"
                data-action="delete"
                aria-label={t('tree.deleteOf', { name })}
                onClick={() => setDeleting({ kind, id: item.id, name })}
              >
                {t('tree.delete')}
              </Button>
            </span>
          </div>
        )}
        {options.children}
      </li>
    );
  }

  function createControl(parentId: string, open: MessageKey, label: MessageKey) {
    return creating === parentId ? (
      <NameForm
        label={t(label)}
        initial=""
        submitLabel="tree.create"
        onSubmit={(name) => create(parentId, name)}
        onCancel={() => setCreating(undefined)}
      />
    ) : (
      <div className="eg-tree__create">
        <Button
          size="small"
          data-action={parentId === '' ? 'new-campaign' : undefined}
          onClick={() => setCreating(parentId)}
        >
          {t(open)}
        </Button>
      </div>
    );
  }

  function sceneList(session: Session) {
    const list = scenes[session.id];
    if (!list) return <p className="eg-dm__status eg-tree__note">{t('tree.loading')}</p>;
    const ids = list.map((scene) => scene.id);
    return (
      <>
        {list.length === 0 ? <p className="eg-dm__status eg-tree__note">{t('tree.noScenes')}</p> : null}
        <ul className="eg-tree__list">
          {list.map((scene) =>
            row('scene', scene, { siblings: ids, parentId: session.id, onName: () => onSelectScene(scene) }),
          )}
        </ul>
        {createControl(session.id, 'tree.newScene', 'tree.sceneName')}
      </>
    );
  }

  function sessionList(campaign: Campaign) {
    const list = sessions[campaign.id];
    if (!list) return <p className="eg-dm__status eg-tree__note">{t('tree.loading')}</p>;
    const ids = list.map((session) => session.id);
    return (
      <>
        {list.length === 0 ? <p className="eg-dm__status eg-tree__note">{t('tree.noSessions')}</p> : null}
        <ul className="eg-tree__list">
          {list.map((session) => {
            const open = expanded.has(session.id);
            return row('session', session, {
              siblings: ids,
              parentId: campaign.id,
              open,
              onName: () => toggle(session.id, () => loadScenes(session.id), scenes[session.id] !== undefined),
              children: open ? sceneList(session) : null,
            });
          })}
        </ul>
        {createControl(campaign.id, 'tree.newSession', 'tree.sessionTitle')}
      </>
    );
  }

  return (
    <div className="eg-tree" ref={root}>
      <h2 className="eg-tree__heading">{t('tree.heading')}</h2>
      {failure ? <Notice>{failure}</Notice> : null}
      {campaigns === undefined ? (
        failure ? null : (
          <p className="eg-dm__status">{t('tree.loading')}</p>
        )
      ) : (
        <>
          {campaigns.length === 0 ? <p className="eg-dm__status">{t('tree.empty')}</p> : null}
          <ul className="eg-tree__list eg-tree__list--root">
            {campaigns.map((campaign) => {
              const open = expanded.has(campaign.id);
              return row('campaign', campaign, {
                open,
                onName: () => toggle(campaign.id, () => loadSessions(campaign.id), sessions[campaign.id] !== undefined),
                children: open ? sessionList(campaign) : null,
              });
            })}
          </ul>
          {createControl('', 'tree.newCampaign', 'tree.campaignName')}
        </>
      )}
      {deleting ? (
        <DeleteDialog
          target={deleting}
          onDeleted={() => deleted(deleting)}
          onClose={() => {
            const { id } = deleting;
            setDeleting(undefined);
            setFocusNext({ id, action: 'name' });
          }}
        />
      ) : null}
    </div>
  );
}

/** Inline form for a new or changed name; its submit button is off while the request runs (G-014). */
function NameForm({
  label,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  label: string;
  initial: string;
  submitLabel: MessageKey;
  onSubmit: (name: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (value.trim() === '') return setError(t('tree.nameRequired'));
    setError(undefined);
    setPending(true);
    const done = await onSubmit(value);
    if (!done) setPending(false);
  }

  return (
    <form className="eg-tree__form" onSubmit={(event) => void submit(event)} noValidate>
      <TextField
        label={label}
        value={value}
        autoFocus
        error={error}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <span className="eg-tree__actions">
        <Button size="small" type="submit" variant="primary" disabled={pending}>
          {t(submitLabel)}
        </Button>
        <Button size="small" onClick={onCancel}>
          {t('tree.cancel')}
        </Button>
      </span>
    </form>
  );
}
