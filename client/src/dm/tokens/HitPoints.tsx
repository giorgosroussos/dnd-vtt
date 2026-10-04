import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { AC_BOUNDS, HP_BOUNDS, parseHpEntry, type HpEntry, type SceneToken, type TokenStats } from '@emberglass/shared';
import { Icon } from '../../ui/icons.js';
import { t } from '../../ui/messages.js';
import { hpFraction } from './TokenStats.js';

// The popover's hit points and armour class (DMT-01, specs/08-ux-journeys.md §13, specs/04-live-sync.md §15): the hit
// points as current / maximum with any temporary ones and a thin bar, the armour class on a shield, and one field
// that takes `-7` (damage), `+5` (healing) or a bare number (the current hit points), applied on Enter and reached
// with D. A click on the hit points or the armour class edits the maximum, temporary hit points and armour class in
// place. Keys typed in either form are theirs, never the map's shortcuts.
export function HitPoints({
  token,
  focus,
  onEntry,
  onStats,
}: {
  token: SceneToken;
  /** Raised each time D asks for the field. */
  focus: number;
  onEntry: (entry: HpEntry) => void;
  onStats: (stats: Partial<TokenStats>) => void;
}) {
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [editing, setEditing] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const fraction = hpFraction(token);

  useEffect(() => {
    if (focus > 0) field.current?.focus();
  }, [focus]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const entry = parseHpEntry(text);
    if (entry === undefined) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setText('');
    onEntry(entry);
  }

  const hp =
    token.hp_current === null && token.hp_max === null
      ? t('hp.none')
      : t('hp.value', { current: token.hp_current ?? t('hp.unset'), max: token.hp_max ?? t('hp.unset') });
  const edit = {
    'aria-label': t('hp.editOf', { label: token.label }),
    'aria-expanded': editing,
    onClick: () => setEditing(!editing),
  };
  return (
    <div className="eg-popover__hp" role="group" aria-label={t('hp.group', { label: token.label })}>
      <div className="eg-hp">
        <button type="button" className="eg-hp__value" {...edit}>
          <span className="eg-popover__label">{t('hp.label')}</span>
          <span className="eg-hp__numbers" data-hp>
            {hp}
          </span>
          {token.hp_temp ? <span className="eg-hp__temp">{t('hp.temp', { temp: token.hp_temp })}</span> : null}
        </button>
        <button
          type="button"
          className="eg-hp__ac"
          title={token.ac === null ? undefined : t('hp.acOf', { ac: token.ac })}
          {...edit}
        >
          <Icon name="shield" size={15} />
          <span data-ac>{token.ac ?? t('hp.unset')}</span>
        </button>
      </div>
      {fraction === undefined ? null : (
        <span className="eg-hp__bar" aria-hidden="true">
          <span
            className="eg-hp__fill"
            data-low={fraction <= 0.5 || undefined}
            style={{ width: `${Math.round(fraction * 100)}%` }}
          />
        </span>
      )}
      {editing ? (
        <StatsEditor
          token={token}
          onSave={(stats) => {
            setEditing(false);
            onStats(stats);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}
      <form className="eg-hp__entry" onSubmit={submit}>
        <input
          ref={field}
          className="eg-hp__field"
          inputMode="numeric"
          autoComplete="off"
          aria-label={t('hp.entry', { label: token.label })}
          aria-describedby={hintId}
          aria-invalid={invalid || undefined}
          aria-keyshortcuts="D"
          placeholder={t('hp.entryPlaceholder')}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setInvalid(false);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              setText('');
              setInvalid(false);
              event.currentTarget.blur();
            }
          }}
        />
        <kbd className="eg-hp__key">{t('shortcuts.keyD')}</kbd>
      </form>
      <p id={hintId} className={invalid ? 'eg-hp__hint eg-hp__hint--invalid' : 'eg-visually-hidden'}>
        {invalid ? t('hp.entryInvalid') : t('hp.entryHint')}
      </p>
    </div>
  );
}

/** A number field's value, or null when empty; undefined when it is not a whole number within bounds. */
export function fieldValue(text: string, min: number, max: number): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : undefined;
}

/** The maximum, temporary hit points and armour class, edited in place; an empty field clears one. */
function StatsEditor({
  token,
  onSave,
  onCancel,
}: {
  token: SceneToken;
  onSave: (stats: Partial<TokenStats>) => void;
  onCancel: () => void;
}) {
  const [max, setMax] = useState(token.hp_max?.toString() ?? '');
  const [temp, setTemp] = useState(token.hp_temp?.toString() ?? '');
  const [ac, setAc] = useState(token.ac?.toString() ?? '');
  const [invalid, setInvalid] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  function save(event: FormEvent) {
    event.preventDefault();
    const values = {
      hp_max: fieldValue(max, 1, HP_BOUNDS.max),
      hp_temp: fieldValue(temp, 0, HP_BOUNDS.max),
      ac: fieldValue(ac, AC_BOUNDS.min, AC_BOUNDS.max),
    };
    if (Object.values(values).some((value) => value === undefined)) {
      setInvalid(true);
      return;
    }
    const stats = values as Partial<TokenStats>;
    // A maximum given to a token without hit points starts them full, as a token placed from an asset does.
    if (token.hp_current === null && token.hp_max === null && typeof stats.hp_max === 'number') {
      stats.hp_current = stats.hp_max;
    }
    const changed = Object.fromEntries(
      Object.entries(stats).filter(([key, value]) => token[key as keyof TokenStats] !== value),
    ) as Partial<TokenStats>;
    if (Object.keys(changed).length === 0) onCancel();
    else onSave(changed);
  }

  const field = (label: string, value: string, set: (value: string) => void, autoFocus = false) => (
    <label className="eg-hp__edit-field">
      <span>{label}</span>
      <input
        ref={autoFocus ? first : undefined}
        inputMode="numeric"
        autoComplete="off"
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          set(event.target.value);
          setInvalid(false);
        }}
      />
    </label>
  );
  return (
    <form
      className="eg-hp__edit"
      onSubmit={save}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      {field(t('hp.max'), max, setMax, true)}
      {field(t('hp.tempField'), temp, setTemp)}
      {field(t('hp.acField'), ac, setAc)}
      <div className="eg-hp__edit-actions">
        <button type="submit" className="eg-button eg-button--small eg-button--primary">
          {t('hp.save')}
        </button>
        <button type="button" className="eg-button eg-button--small" onClick={onCancel}>
          {t('hp.cancel')}
        </button>
      </div>
      {invalid ? (
        <p className="eg-hp__hint eg-hp__hint--invalid" role="alert">
          {t('hp.fieldInvalid')}
        </p>
      ) : null}
    </form>
  );
}
