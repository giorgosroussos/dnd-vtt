import { useId, useState } from 'react';
import { CONDITIONS, parseHpEntry, type HpDelta } from '@emberglass/shared';
import { Button } from '../../ui/Button.js';
import { conditionLabel } from '../../ui/conditions.js';
import { Icon } from '../../ui/icons.js';
import { Menu } from '../../ui/Menu.js';
import { t } from '../../ui/messages.js';

// The bar of a group of selected tokens (UXR-02, specs/08-ux-journeys.md §14, Q-122): how many, Hide or Reveal
// (H), a condition toggled on all, one amount of damage or healing on each, Delete asked once, and Clear. Each
// action on the live scene is one `token.batch`, one undo step (Q-123).
export function GroupBar({
  count,
  allHidden,
  onHide,
  onMarker,
  onHp,
  onDelete,
  onClear,
}: {
  count: number;
  /** Every selected token is hidden: the button reveals them. */
  allHidden: boolean;
  onHide: () => void;
  onMarker: (id: string) => void;
  onHp: (delta: HpDelta) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [invalid, setInvalid] = useState(false);
  const hintId = useId();
  return (
    <div
      className="eg-fog-bar eg-group-bar"
      role="group"
      aria-label={t('group.label', { count })}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !(event.target instanceof HTMLInputElement)) {
          event.preventDefault();
          onClear();
        }
      }}
    >
      <strong className="eg-group-bar__count">{t('group.count', { count })}</strong>
      <Button size="small" aria-keyshortcuts="H" onClick={onHide}>
        <Icon name={allHidden ? 'eye' : 'eyeOff'} size={14} />
        {allHidden ? t('group.reveal') : t('group.hide')}
        <kbd>{t('group.hideKey')}</kbd>
      </Button>
      <Menu
        label={t('group.conditions', { count })}
        className="eg-button eg-button--secondary eg-button--small"
        icon={
          <>
            {t('group.condition')}
            <Icon name="chevron" size={12} />
          </>
        }
        items={CONDITIONS.map((condition) => ({
          label: conditionLabel(condition.id),
          onSelect: () => onMarker(condition.id),
        }))}
      />
      <form
        className="eg-group-bar__hp"
        onSubmit={(event) => {
          event.preventDefault();
          const entry = parseHpEntry(amount);
          // A group takes an amount of damage or healing, never one number of hit points for all.
          if (entry?.kind !== 'delta') return setInvalid(true);
          setInvalid(false);
          setAmount('');
          onHp(entry.delta);
        }}
      >
        <input
          className="eg-field__input eg-group-bar__amount"
          value={amount}
          inputMode="numeric"
          placeholder={t('group.hpPlaceholder')}
          aria-label={t('group.hp', { count })}
          aria-describedby={hintId}
          aria-invalid={invalid || undefined}
          onChange={(event) => {
            setAmount(event.target.value);
            setInvalid(false);
          }}
        />
        <span id={hintId} className={invalid ? 'eg-group-bar__hint eg-group-bar__hint--invalid' : 'eg-group-bar__hint'}>
          {invalid ? t('group.hpInvalid') : t('group.hpHint')}
        </span>
      </form>
      <Button size="small" onClick={onDelete}>
        <Icon name="trash" size={14} />
        {t('group.delete')}
      </Button>
      <Button size="small" onClick={onClear}>
        {t('group.clear')}
      </Button>
    </div>
  );
}
