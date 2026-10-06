import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import {
  imageFileUrl,
  INITIATIVE_BOUNDS,
  missingTokens,
  nextIndex,
  noEnemiesLeft,
  takesTurn,
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
import { tokenHasNotes, tokenNotesPreview } from '../notes/Notes.js';

// The Initiative tab of the DM view (TBL-06, DMT-02, specs/08-ux-journeys.md §12, specs/04-live-sync.md §14,
// Q-111, Q-117, Q-118, D-180). The table rolls physical dice; this records the order. Start combat builds it
// from the player characters, monsters and npcs players see; each row has a drag handle, the token's avatar,
// its name and a number field. Typing a number sorts the rows (the server does), a drag sets the order, and
// Move up and Move down do what a drag does from the keyboard. The turn's row is highlighted and the next one
// marked; a row passed over is dimmed, a Dead monster's greyed. The turn's row, when its token has notes, has a
// button that opens them (DMT-04). Tokens players can now see without an entry
// are offered together, each with an optional number. Every change is a live command; the panel holds no
// order of its own.

export interface InitiativePanelProps {
  sceneId: string;
  /** Whether the scene shown is live: combat runs on the live scene only. */
  live: boolean;
  encounter: Encounter | null;
  tokens: readonly SceneToken[];
  fog: FogMask;
  /** Sends a live command; true when the server applied it. */
  onCommand: (type: CommandType, payload: object) => Promise<boolean>;
  /** Opens the token's notes (DMT-04): from the turn's row, when its token has any. */
  onOpenNotes?: ((tokenId: string) => void) | undefined;
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
  onOpenNotes,
}: InitiativePanelProps) {
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  // The tokens the DM skipped adding, or removed, in this browser only: not offered again.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [dragging, setDragging] = useState<string>();
  const [over, setOver] = useState<string>();
  // "No enemies left. End combat?": asked when the turn passes while no monster or npc entry can act (Q-118),
  // until the DM answers it or one can act again.
  const [askEnd, setAskEnd] = useState(false);
  const turnKey = encounter?.active ? `${encounter.id}:${encounter.round}:${encounter.current_index}` : undefined;
  const [turnSeen, setTurnSeen] = useState(turnKey);
  const view = turnView(tokens, fog);
  const enemiesGone = noEnemiesLeft(encounter, view);
  if (turnKey !== turnSeen) {
    setTurnSeen(turnKey);
    if (turnSeen !== undefined && turnKey !== undefined && enemiesGone) setAskEnd(true);
  }
  if (askEnd && !enemiesGone) setAskEnd(false);
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

  const byId = new Map(tokens.map((token) => [token.id, token]));
  const next = nextIndex(encounter, view);
  const ids = encounter.entries.map((entry) => entry.id);
  const offers = missingTokens(encounter, tokens, fog).filter((token) => !dismissed.has(token.id));
  const dead = encounter.entries.filter((entry) => entry.kind === 'monster' && view.dead.has(entry.token_id));
  const dismiss = (tokenIds: readonly string[]) => setDismissed(new Set([...dismissed, ...tokenIds]));
  const nameOf = (entry: EncounterEntry) => byId.get(entry.token_id)?.label ?? t('initiative.gone');
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
  const remove = (entries: readonly EncounterEntry[]) => {
    // A token removed is not offered back at once.
    dismiss(entries.map((entry) => entry.token_id));
    void (async () => {
      for (const entry of entries) if (!(await send('encounter.removeEntry', { entry_id: entry.id }))) return;
    })();
  };

  return (
    <section className="eg-initiative" aria-label={t('initiative.label')}>
      <div className="eg-initiative__head">
        <h2 className="eg-initiative__round">{t('initiative.round', { round: encounter.round })}</h2>
        <span className="eg-initiative__head-actions">
          {dead.length > 0 ? (
            <Button size="small" onClick={() => remove(dead)}>
              {t('initiative.removeDead')}
            </Button>
          ) : null}
          <Button size="small" onClick={() => setConfirmingEnd(true)}>
            {t('initiative.end')}
          </Button>
        </span>
      </div>
      {askEnd ? (
        <div className="eg-initiative__prompt" role="status">
          <p>{t('initiative.noEnemies')}</p>
          <div className="eg-initiative__prompt-actions">
            <Button variant="primary" size="small" onClick={() => void send('encounter.end')}>
              {t('initiative.end')}
            </Button>
            <Button size="small" onClick={() => setAskEnd(false)}>
              {t('initiative.continue')}
            </Button>
          </div>
        </div>
      ) : null}
      {offers.length > 0 ? (
        <Offer
          // A new set of tokens is a new offer, its fields empty.
          key={offers.map((token) => token.id).join()}
          tokens={offers}
          onAdd={async (added) => {
            for (const { token, initiative } of added) {
              const payload = initiative === null ? { token_id: token.id } : { token_id: token.id, initiative };
              if (!(await send('encounter.addEntry', payload))) return;
            }
          }}
          onSkip={() => dismiss(offers.map((token) => token.id))}
        />
      ) : null}
      <ol ref={list} className="eg-initiative__list" aria-label={t('initiative.order')}>
        {encounter.entries.map((entry, index) => {
          const token = byId.get(entry.token_id);
          const name = nameOf(entry);
          const isCurrent = index === encounter.current_index;
          const isNext = index === next;
          const unseen = !view.seen.has(entry.token_id);
          const isDead = entry.kind === 'monster' && view.dead.has(entry.token_id);
          const passed = !takesTurn(entry, view);
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
            unseen ? 'eg-initiative__row--unseen' : '',
            isDead ? 'eg-initiative__row--dead' : '',
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
                <Avatar token={token} name={name} kind={entry.kind} />
                <span className="eg-initiative__text">
                  <span className="eg-initiative__name">{name}</span>
                  <span className="eg-initiative__status">
                    {isCurrent ? <span className="eg-initiative__tag">{t('initiative.now')}</span> : null}
                    {isNext ? (
                      <span className="eg-initiative__tag eg-initiative__tag--next">{t('initiative.next')}</span>
                    ) : null}
                    {unseen ? t('initiative.passed') : isDead ? t('initiative.passedDead') : null}
                    {token ? <Markers token={token} /> : null}
                  </span>
                </span>
                {token ? <TokenStatsBadge stats={token} /> : null}
                {isCurrent && token && onOpenNotes && tokenHasNotes(token) ? (
                  // The turn's token has notes: that is when "flees at half HP" matters (DMT-04).
                  <button
                    type="button"
                    className="eg-note-button"
                    aria-label={t('notes.openOf', { name })}
                    title={tokenNotesPreview(token)}
                    onClick={() => onOpenNotes(token.id)}
                  >
                    <Icon name="note" size={14} />
                  </button>
                ) : null}
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
                  <button
                    type="button"
                    className="eg-icon-button"
                    aria-label={t('initiative.removeOf', { name })}
                    onClick={() => remove([entry])}
                  >
                    <Icon name="minus" size={14} />
                  </button>
                </span>
              </div>
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

/** A row's avatar: the token's picture in the ring of its side, its initials while there is none. */
function Avatar({ token, name, kind }: { token: SceneToken | undefined; name: string; kind: EncounterEntry['kind'] }) {
  return (
    <span className={`eg-avatar eg-avatar--${token?.asset.category ?? kind}`} aria-hidden="true">
      {token ? <img src={imageFileUrl(token.asset.image_id, 'thumbnail')} alt="" /> : initialsOf(name)}
    </span>
  );
}

/**
 * The offer to add the tokens players can now see that have no entry (Q-117, DMT-02): one prompt for all of
 * them, a fog region revealing four goblins included, each with an optional number; with a number an entry
 * goes in by it, without one at the end. Add all adds them in the order listed; Skip adds none.
 */
function Offer({
  tokens,
  onAdd,
  onSkip,
}: {
  tokens: readonly SceneToken[];
  onAdd: (added: { token: SceneToken; initiative: number | null }[]) => Promise<void>;
  onSkip: () => void;
}) {
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const parsed = tokens.map((token) => ({ token, initiative: initiativeOf(numbers[token.id] ?? '') }));
  const valid = parsed.every((each) => each.initiative !== undefined);
  const add = () => {
    if (!valid || busy) return;
    setBusy(true);
    void onAdd(parsed as { token: SceneToken; initiative: number | null }[]).finally(() => setBusy(false));
  };
  const single = tokens.length === 1 ? tokens[0]! : undefined;
  return (
    <div className="eg-initiative__offer" role="group" aria-label={t('initiative.offerLabel')} data-offer>
      <p>
        {single ? t('initiative.offer', { name: single.label }) : t('initiative.offerMany', { count: tokens.length })}
      </p>
      <ul className="eg-initiative__offer-list">
        {parsed.map(({ token, initiative }) => (
          <li key={token.id} className="eg-initiative__offer-row" data-offer-token={token.id}>
            <Avatar token={token} name={token.label} kind={token.asset.category === 'pc' ? 'pc' : 'monster'} />
            <span className="eg-initiative__name">{token.label}</span>
            <input
              className="eg-field__input eg-initiative__number"
              type="text"
              inputMode="numeric"
              aria-label={t('initiative.numberOf', { name: token.label })}
              aria-invalid={initiative === undefined || undefined}
              placeholder={t('initiative.numberPlaceholder')}
              value={numbers[token.id] ?? ''}
              onChange={(event) => setNumbers({ ...numbers, [token.id]: event.target.value })}
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  add();
                }
              }}
            />
          </li>
        ))}
      </ul>
      <div className="eg-initiative__prompt-actions">
        <Button size="small" variant="primary" disabled={!valid || busy} onClick={add}>
          {t(single ? 'initiative.add' : 'initiative.addAll')}
        </Button>
        <Button size="small" onClick={onSkip}>
          {t('initiative.skip')}
        </Button>
      </div>
    </div>
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
