import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import {
  imageFileUrl,
  INITIATIVE_BOUNDS,
  membersOf,
  missingTokens,
  nextIndex,
  turnView,
  type CommandType,
  type Encounter,
  type EncounterEntry,
  type FogMask,
  type SceneToken,
} from '@emberglass/shared';
import { initialsOf } from '../../canvas/TokenLayer.js';
import { Button } from '../../ui/Button.js';
import { ConditionIcon, markerName } from '../../ui/conditions.js';
import { Dialog } from '../../ui/Dialog.js';
import { Icon } from '../../ui/icons.js';
import { t } from '../../ui/messages.js';
import { useFocusLater } from '../../ui/useFocusLater.js';
import { TokenStatsBadge } from '../tokens/TokenStats.js';

// The Initiative tab of the DM view (TBL-06, specs/08-ux-journeys.md §12, specs/04-live-sync.md §14, Q-104,
// Q-106, D-160). The table rolls physical dice; this records the order. Start combat builds it from the
// player characters players see and one Enemies entry; each row has a drag handle, the token's avatar, its
// name and a number field. Typing a number sorts the rows (the server does), a drag sets the order, and Move
// up and Move down do what a drag does from the keyboard. The turn's row is highlighted and the next one
// marked; on the Enemies turn its row opens to list its members, computed here from the tokens as the server
// computes them. Every change is a live command; the panel holds no order of its own.

export interface InitiativePanelProps {
  sceneId: string;
  /** Whether the scene shown is live: combat runs on the live scene only. */
  live: boolean;
  encounter: Encounter | null;
  tokens: readonly SceneToken[];
  fog: FogMask;
  /** Sends a live command; true when the server applied it. */
  onCommand: (type: CommandType, payload: object) => Promise<boolean>;
  /** Selects and centres a token on the map. */
  onShowToken: (token: SceneToken) => void;
}

/** `ids` with `id` moved to where `target` is. */
function moved(ids: readonly string[], id: string, target: string): string[] {
  const next = ids.filter((each) => each !== id);
  next.splice(ids.indexOf(target), 0, id);
  return next;
}

/** A number typed in an initiative field: null when empty, undefined when it is not a whole number in bounds. */
function initiativeOf(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!/^[+-]?\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value >= INITIATIVE_BOUNDS.min && value <= INITIATIVE_BOUNDS.max ? value : undefined;
}

export function InitiativePanel({
  sceneId,
  live,
  encounter,
  tokens,
  fog,
  onCommand,
  onShowToken,
}: InitiativePanelProps) {
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  // The offers to add a player character the DM said "Not now" to, in this browser only.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [dragging, setDragging] = useState<string>();
  const [over, setOver] = useState<string>();
  const focusLater = useFocusLater();
  const list = useRef<HTMLOListElement>(null);
  const send = (type: CommandType, payload: object = {}) => onCommand(type, { scene_id: sceneId, ...payload });

  if (!live) return <p className="eg-dm__status">{t('initiative.notLive')}</p>;
  if (encounter === null || !encounter.active) {
    return (
      <section className="eg-initiative" aria-label={t('initiative.label')}>
        <p className="eg-initiative__intro">{t('initiative.intro')}</p>
        <Button variant="primary" onClick={() => void send('encounter.start')}>
          {t('initiative.start')}
        </Button>
      </section>
    );
  }

  const view = turnView(tokens, fog);
  const members = membersOf(tokens, fog);
  const byId = new Map(tokens.map((token) => [token.id, token]));
  const next = nextIndex(encounter, view);
  const current = encounter.entries[encounter.current_index];
  const enemiesTurn = current?.kind === 'dm';
  const ids = encounter.entries.map((entry) => entry.id);
  const offers = missingTokens(encounter, tokens, fog).filter((token) => !dismissed.has(token.id));
  const nameOf = (entry: EncounterEntry) =>
    entry.kind === 'dm' ? t('initiative.enemies') : (byId.get(entry.token_id)?.label ?? t('initiative.gone'));
  // After a move, focus stays on the row moved: on its Move button that still works at the row's new place.
  const focusRow = (id: string) =>
    focusLater(() =>
      list.current?.querySelector<HTMLElement>(`[data-entry="${id}"] .eg-initiative__move:not(:disabled)`),
    );

  const reorder = async (order: string[], focus?: string) => {
    if (await send('encounter.reorder', { entry_ids: order })) {
      if (focus !== undefined) focusRow(focus);
    }
  };

  return (
    <section className="eg-initiative" aria-label={t('initiative.label')}>
      <div className="eg-initiative__head">
        <h2 className="eg-initiative__round">{t('initiative.round', { round: encounter.round })}</h2>
        <Button size="small" onClick={() => setConfirmingEnd(true)}>
          {t('initiative.end')}
        </Button>
      </div>
      {enemiesTurn && members.length === 0 ? (
        <div className="eg-initiative__prompt" role="status">
          <p>{t('initiative.noEnemies')}</p>
          <div className="eg-initiative__prompt-actions">
            <Button variant="primary" size="small" onClick={() => void send('encounter.end')}>
              {t('initiative.end')}
            </Button>
            <Button size="small" onClick={() => void send('encounter.next')}>
              {t('initiative.continue')}
            </Button>
          </div>
        </div>
      ) : null}
      {offers.map((token) => (
        <div key={token.id} className="eg-initiative__offer" role="status" data-offer={token.id}>
          <p>{t('initiative.offer', { name: token.label })}</p>
          <div className="eg-initiative__prompt-actions">
            <Button size="small" onClick={() => void send('encounter.addEntry', { token_id: token.id })}>
              {t('initiative.add')}
            </Button>
            <Button size="small" onClick={() => setDismissed(new Set([...dismissed, token.id]))}>
              {t('initiative.notNow')}
            </Button>
          </div>
        </div>
      ))}
      <ol ref={list} className="eg-initiative__list" aria-label={t('initiative.order')}>
        {encounter.entries.map((entry, index) => {
          const token = entry.kind === 'pc' ? byId.get(entry.token_id) : undefined;
          const name = nameOf(entry);
          const isCurrent = index === encounter.current_index;
          const isNext = index === next;
          const passed = entry.kind === 'pc' && !view.seen.has(entry.token_id);
          const drop =
            dragging !== undefined && dragging !== entry.id
              ? {
                  onDragOver: (event: DragEvent) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    if (over !== entry.id) setOver(entry.id);
                  },
                  onDragLeave: () => {
                    if (over === entry.id) setOver(undefined);
                  },
                  onDrop: (event: DragEvent) => {
                    event.preventDefault();
                    setOver(undefined);
                    setDragging(undefined);
                    void reorder(moved(ids, dragging, entry.id));
                  },
                }
              : {};
          const className = [
            'eg-initiative__row',
            isCurrent ? 'eg-initiative__row--current' : '',
            over === entry.id ? 'eg-initiative__row--drop' : '',
            passed ? 'eg-initiative__row--passed' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <li
              key={entry.id}
              className={className}
              data-entry={entry.id}
              data-kind={entry.kind}
              aria-current={isCurrent ? 'step' : undefined}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', entry.id);
                setDragging(entry.id);
              }}
              onDragEnd={() => {
                setDragging(undefined);
                setOver(undefined);
              }}
              {...drop}
            >
              <div className="eg-initiative__line">
                <span className="eg-initiative__grip" aria-hidden="true">
                  <Icon name="grip" size={16} />
                </span>
                {entry.kind === 'dm' ? (
                  <span className="eg-avatar eg-avatar--monster" aria-hidden="true">
                    <Icon name="swords" size={16} />
                  </span>
                ) : (
                  <span className="eg-avatar eg-avatar--pc" aria-hidden="true">
                    {token ? <img src={imageFileUrl(token.asset.image_id, 'thumbnail')} alt="" /> : null}
                    {token ? null : initialsOf(name)}
                  </span>
                )}
                <span className="eg-initiative__text">
                  <span className="eg-initiative__name">{name}</span>
                  <span className="eg-initiative__status">
                    {isCurrent ? <span className="eg-initiative__tag">{t('initiative.now')}</span> : null}
                    {isNext ? (
                      <span className="eg-initiative__tag eg-initiative__tag--next">{t('initiative.next')}</span>
                    ) : null}
                    {passed ? t('initiative.passed') : null}
                    {token ? <Markers token={token} /> : null}
                  </span>
                </span>
                {token ? <TokenStatsBadge stats={token} /> : null}
                <InitiativeField
                  name={name}
                  value={entry.initiative}
                  onCommit={(initiative) => send('encounter.setInitiative', { entry_id: entry.id, initiative })}
                />
                <span className="eg-initiative__actions">
                  <button
                    type="button"
                    className="eg-icon-button eg-initiative__move"
                    aria-label={t('initiative.moveUpOf', { name })}
                    disabled={index === 0}
                    onClick={() => void reorder(moved(ids, entry.id, ids[index - 1]!), entry.id)}
                  >
                    <Icon name="chevron" size={14} />
                  </button>
                  <button
                    type="button"
                    className="eg-icon-button eg-initiative__move eg-initiative__move--down"
                    aria-label={t('initiative.moveDownOf', { name })}
                    disabled={index === ids.length - 1}
                    onClick={() => void reorder(moved(ids, entry.id, ids[index + 1]!), entry.id)}
                  >
                    <Icon name="chevron" size={14} />
                  </button>
                  {entry.kind === 'pc' ? (
                    <button
                      type="button"
                      className="eg-icon-button"
                      aria-label={t('initiative.removeOf', { name })}
                      onClick={() => void send('encounter.removeEntry', { entry_id: entry.id })}
                    >
                      <Icon name="minus" size={14} />
                    </button>
                  ) : null}
                </span>
              </div>
              {entry.kind === 'dm' && isCurrent && members.length > 0 ? (
                <ul className="eg-initiative__members" aria-label={t('initiative.membersOf')}>
                  {members.map((member) => (
                    <li key={member.id}>
                      <button type="button" className="eg-initiative__member" onClick={() => onShowToken(member)}>
                        <span className={`eg-avatar eg-avatar--${member.asset.category}`} aria-hidden="true">
                          {initialsOf(member.label)}
                        </span>
                        <span className="eg-initiative__name">{member.label}</span>
                        <Markers token={member} />
                        <TokenStatsBadge stats={member} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="eg-initiative__turns">
        <Button variant="primary" aria-keyshortcuts="Enter" onClick={() => void send('encounter.next')}>
          {t('initiative.nextTurn')}
          <kbd>{t('initiative.nextKey')}</kbd>
        </Button>
        <Button aria-keyshortcuts="Shift+Enter" onClick={() => void send('encounter.previous')}>
          {t('initiative.previous')}
          <kbd>{t('initiative.previousKey')}</kbd>
        </Button>
      </div>
      {confirmingEnd ? (
        <EndCombatDialog
          onConfirm={() => {
            setConfirmingEnd(false);
            void send('encounter.end');
          }}
          onClose={() => setConfirmingEnd(false)}
        />
      ) : null}
    </section>
  );
}

/** A token's conditions as small icons, each named for assistive technology. */
function Markers({ token }: { token: SceneToken }) {
  if (token.markers.length === 0) return null;
  return (
    <span className="eg-initiative__markers">
      {token.markers.map((marker) => (
        <span key={marker.id} className="eg-initiative__marker" title={markerName(marker)}>
          <ConditionIcon id={marker.id} size={13} />
          <span className="eg-visually-hidden">{markerName(marker)}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * An entry's initiative number: optional, committed on Enter or when focus leaves, an empty field clearing
 * it; a value that is not a whole number in bounds goes back to the one stored.
 */
function InitiativeField({
  name,
  value,
  onCommit,
}: {
  name: string;
  value: number | null;
  /** Sends the number; false when it was not stored. */
  onCommit: (value: number | null) => Promise<boolean>;
}) {
  const shown = value === null ? '' : String(value);
  const [draft, setDraft] = useState(shown);
  // Another DM browser, or a sort, changed it: the field shows the stored number.
  const [stored, setStored] = useState(shown);
  if (stored !== shown) {
    setStored(shown);
    setDraft(shown);
  }
  // The number last sent, so that the blur after Enter does not send it again before the server answers.
  const sent = useRef<number | null | undefined>(undefined);
  const commit = () => {
    const next = initiativeOf(draft);
    if (next === undefined) return setDraft(shown);
    if (next === value || next === sent.current) return;
    sent.current = next;
    void onCommit(next).then((stored) => {
      sent.current = undefined;
      // Not stored (offline, refused): the field shows the number the server holds, not one it never took.
      if (!stored) setDraft(shown);
    });
  };
  return (
    <input
      className="eg-field__input eg-initiative__number"
      type="text"
      inputMode="numeric"
      aria-label={t('initiative.numberOf', { name })}
      placeholder={t('initiative.numberPlaceholder')}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setDraft(shown);
        }
      }}
    />
  );
}

/** Asks before ending combat: undo brings it back only while this scene stays live and the server runs. */
function EndCombatDialog({ onConfirm, onClose }: { onConfirm: () => void; onClose: () => void }) {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => keep.current?.focus(), []);
  return (
    <Dialog heading={t('initiative.endDialog.heading')} onClose={onClose}>
      <p className="eg-dialog__body">{t('initiative.endDialog.body')}</p>
      <div className="eg-dialog__actions">
        <Button variant="danger" onClick={onConfirm}>
          {t('initiative.endDialog.confirm')}
        </Button>
        <Button ref={keep} onClick={onClose}>
          {t('initiative.endDialog.cancel')}
        </Button>
      </div>
    </Dialog>
  );
}
