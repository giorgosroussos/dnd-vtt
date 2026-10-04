import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import {
  CONDITIONS,
  EXHAUSTION,
  EXHAUSTION_LEVELS,
  hasMarker,
  markerLevel,
  type HpEntry,
  type SceneToken,
  type TokenStats,
} from '@emberglass/shared';
import type { TokenAnchor } from '../../canvas/MapCanvas.js';
import { ConditionIcon, conditionHelp } from '../../ui/conditions.js';
import { Icon } from '../../ui/icons.js';
import { Menu } from '../../ui/Menu.js';
import { t } from '../../ui/messages.js';
import { HitPoints } from './HitPoints.js';

const WIDTH = 272;
const GAP = 14;

/** Beside the token, on its right when there is room and on its left otherwise, kept inside the canvas. */
function placement(anchor: TokenAnchor): { left: number; top: number; side: 'left' | 'right' } {
  const right = anchor.left + anchor.side + GAP;
  const fitsRight = right + WIDTH <= anchor.viewport.width - 8;
  const left = fitsRight ? right : Math.max(8, anchor.left - GAP - WIDTH);
  const top = Math.min(Math.max(8, anchor.top + anchor.side / 2 - 70), Math.max(8, anchor.viewport.height - 340));
  return { left, top, side: fitsRight ? 'right' : 'left' };
}

// The selected token's popover (UIX-01, specs/08-ux-journeys.md §11, specs/04-live-sync.md §2): its name,
// whether players can see it, Hide or Reveal (H), Rename, and a menu with Delete, Duplicate and the
// stacking order. On the live scene Rename and the stacking order stay in the list but refuse, saying why:
// they are edited only on scenes that are not live (Q-014), and the brief keeps them prep-only (D-139). It
// takes no focus when it appears, so the arrow keys keep moving the token on the map; Tab reaches it.
// Below, the condition markers (TBL-05, D-157): the pinned ones as toggle chips, then any other one the token
// carries, pressed, so it comes off without the list; More… opens a searchable list of the others. Exhaustion's
// chip, while on, carries a stepper for its level. Each chip's hover text is its rule text (D-158).
// Between them, the token's hit points and armour class (DMT-01, HitPoints.tsx). While combat runs, the menu
// adds a player character, monster or npc without an entry to the initiative order, or says why it cannot
// (DMT-02).
export function TokenPopover({
  token,
  anchor,
  live,
  onToggleHidden,
  onRename,
  onDuplicate,
  onStack,
  onDelete,
  onToggleMarker,
  onExhaustion,
  onHpEntry,
  onStats,
  initiative,
  focusHp = 0,
}: {
  token: SceneToken;
  anchor: TokenAnchor;
  live: boolean;
  onToggleHidden: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onStack: (stack: 'front' | 'back') => void;
  onDelete: () => void;
  onToggleMarker: (id: string) => void;
  onExhaustion: (level: number) => void;
  onHpEntry: (entry: HpEntry) => void;
  onStats: (stats: Partial<TokenStats>) => void;
  /** Add to initiative, while combat runs and the token has no entry: why it cannot, or how it is added. */
  initiative?: { disabledReason?: string | undefined; onAdd: () => void } | undefined;
  /** Raised each time D asks for the hit-point field. */
  focusHp?: number;
}) {
  const { left, top, side } = placement(anchor);
  const prepOnly = live ? t('tokens.prepOnly') : undefined;
  return (
    <section
      className={`eg-popover eg-popover--${side}`}
      style={{ left, top, width: WIDTH }}
      aria-label={t('tokens.popoverOf', { label: token.label })}
    >
      <div className="eg-popover__head">
        <h2 className="eg-popover__name">{token.label}</h2>
        <p className={token.hidden ? 'eg-popover__seen eg-popover__seen--hidden' : 'eg-popover__seen'}>
          <span className="eg-popover__dot" aria-hidden="true" />
          {t(token.hidden ? 'tokens.playersCannotSee' : 'tokens.playersCanSee')}
        </p>
      </div>
      <div className="eg-popover__actions">
        <button
          type="button"
          className="eg-button eg-popover__main"
          aria-label={t(token.hidden ? 'tokens.revealOf' : 'tokens.hideOf', { label: token.label })}
          aria-keyshortcuts="H"
          onClick={onToggleHidden}
        >
          <Icon name={token.hidden ? 'eye' : 'eyeOff'} size={15} />
          {t(token.hidden ? 'tokens.reveal' : 'tokens.hide')}
          <kbd>{t('shortcuts.keyH')}</kbd>
        </button>
        <button
          type="button"
          className="eg-button"
          aria-label={t('tokens.renameOf', { label: token.label })}
          aria-disabled={live || undefined}
          title={prepOnly}
          onClick={() => {
            if (!live) onRename();
          }}
        >
          {t('tokens.rename')}
        </button>
        <Menu
          label={t('tokens.moreOf', { label: token.label })}
          icon={<Icon name="more" />}
          className="eg-icon-button eg-icon-button--bordered"
          items={[
            ...(initiative
              ? [
                  {
                    label: t('initiative.addToOrder'),
                    disabledReason: initiative.disabledReason,
                    onSelect: initiative.onAdd,
                  },
                ]
              : []),
            { label: t('tokens.duplicate'), onSelect: onDuplicate },
            { label: t('tokens.front'), disabledReason: prepOnly, onSelect: () => onStack('front') },
            { label: t('tokens.back'), disabledReason: prepOnly, onSelect: () => onStack('back') },
            { label: t('tokens.delete'), danger: true, onSelect: onDelete },
          ]}
        />
      </div>
      <HitPoints token={token} focus={focusHp} onEntry={onHpEntry} onStats={onStats} />
      <div className="eg-popover__conditions" role="group" aria-labelledby={`${token.id}-conditions`}>
        <h3 id={`${token.id}-conditions`} className="eg-popover__label">
          {t('tokens.conditions')}
        </h3>
        <div className="eg-popover__chips">
          {CONDITIONS.filter((condition) => condition.pinned || hasMarker(token.markers, condition.id)).map(
            (condition) => (
              <ConditionChip
                key={condition.id}
                id={condition.id}
                label={condition.label}
                on={hasMarker(token.markers, condition.id)}
                level={markerLevel(token.markers.find((each) => each.id === condition.id) ?? { id: condition.id })}
                tokenLabel={token.label}
                onToggle={() => onToggleMarker(condition.id)}
                onExhaustion={onExhaustion}
              />
            ),
          )}
          <MoreConditions token={token} onToggle={onToggleMarker} />
        </div>
      </div>
      {live ? <p className="eg-popover__note">{t('tokens.prepOnlyNote')}</p> : null}
    </section>
  );
}

/** A condition's chip: its icon and label, pressed while the token carries it, its rule text on hover. */
function ConditionChip({
  id,
  label,
  on,
  level,
  tokenLabel,
  onToggle,
  onExhaustion,
}: {
  id: string;
  label: string;
  on: boolean;
  level: number | undefined;
  tokenLabel: string;
  onToggle: () => void;
  onExhaustion: (level: number) => void;
}) {
  const chip = (
    <button
      type="button"
      className={`eg-chip eg-chip--${id}`}
      aria-pressed={on}
      title={conditionHelp(id)}
      data-condition={id}
      onClick={onToggle}
    >
      <ConditionIcon id={id} />
      {label}
    </button>
  );
  if (id !== EXHAUSTION || !on || level === undefined) return chip;
  // Exhaustion on: a stepper beside its chip, 1 to 6; stepping below 1 takes it off.
  return (
    <span className="eg-stepper" role="group" aria-label={t('tokens.exhaustionLevel', { level })}>
      {chip}
      <button
        type="button"
        className="eg-stepper__step"
        aria-label={t('tokens.exhaustionLower', { label: tokenLabel })}
        onClick={() => onExhaustion(level - 1)}
      >
        <Icon name="minus" size={12} />
      </button>
      <span className="eg-stepper__value" aria-hidden="true">
        {level}
      </span>
      <button
        type="button"
        className="eg-stepper__step"
        aria-label={t('tokens.exhaustionRaise', { label: tokenLabel })}
        aria-disabled={level >= EXHAUSTION_LEVELS.max || undefined}
        onClick={() => {
          if (level < EXHAUSTION_LEVELS.max) onExhaustion(level + 1);
        }}
      >
        <Icon name="plus" size={12} />
      </button>
    </span>
  );
}

/**
 * More…: the conditions not pinned, alphabetically, in a list filtered by what is typed. Arrow keys move through
 * it, Enter or a click toggles one and closes the list, Escape closes it and gives focus back to More….
 */
function MoreConditions({ token, onToggle }: { token: SceneToken; onToggle: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const others = CONDITIONS.filter((condition) => !condition.pinned).sort((a, b) => a.label.localeCompare(b.label));
  const needle = query.trim().toLocaleLowerCase();
  const shown = others.filter((condition) => condition.label.toLocaleLowerCase().includes(needle));
  const current = Math.min(active, Math.max(0, shown.length - 1));

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!box.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery('');
    setActive(0);
    if (refocus) button.current?.focus();
  };
  const choose = (id: string) => {
    onToggle(id);
    close(true);
  };

  function onKeyDown(event: KeyboardEvent) {
    // Keys typed here are the list's, never the map's shortcuts.
    event.stopPropagation();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      if (shown.length > 0) setActive((current + step + shown.length) % shown.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = shown[current];
      if (chosen) choose(chosen.id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    }
  }

  return (
    <span className="eg-more-conditions">
      <button
        ref={button}
        type="button"
        className="eg-chip eg-chip--more"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('tokens.moreConditions')}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        {t('tokens.more')}
      </button>
      {open ? (
        <div ref={box} className="eg-more-conditions__box" onKeyDown={onKeyDown}>
          <input
            ref={search}
            type="search"
            className="eg-more-conditions__search"
            aria-label={t('tokens.searchConditions')}
            placeholder={t('tokens.searchConditions')}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={shown[current] ? `${listId}-${shown[current].id}` : undefined}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
          />
          <ul id={listId} role="listbox" aria-label={t('tokens.moreConditions')} className="eg-more-conditions__list">
            {shown.map((condition, index) => (
              <li
                key={condition.id}
                id={`${listId}-${condition.id}`}
                role="option"
                aria-selected={hasMarker(token.markers, condition.id)}
                data-active={index === current || undefined}
                data-condition={condition.id}
                title={conditionHelp(condition.id)}
                className="eg-more-conditions__option"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(condition.id)}
              >
                <ConditionIcon id={condition.id} />
                <span>{condition.label}</span>
              </li>
            ))}
          </ul>
          {shown.length === 0 ? <p className="eg-more-conditions__empty">{t('tokens.noConditionFound')}</p> : null}
        </div>
      ) : null}
    </span>
  );
}
