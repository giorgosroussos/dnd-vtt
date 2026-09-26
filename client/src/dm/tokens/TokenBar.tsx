import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { SceneToken } from '@emberglass/shared';
import { Button } from '../../ui/Button.js';
import { Dialog } from '../../ui/Dialog.js';
import { TextField } from '../../ui/TextField.js';
import { t } from '../../ui/messages.js';

// The token controls above the canvas (PRP-04, specs/05-assets-and-images.md §5,
// specs/04-live-sync.md §2, specs/08-ux-journeys.md §8, D-100): Add token, which opens the picker;
// the selected token, chosen here or by a click on the map; and what can be done to it on a scene
// that is not live: hide or reveal, rename, bring to front, send to back, delete. On the live scene
// only what the live commands do: hide or reveal and delete (specs/04-live-sync.md §2, Q-014, LIV-04).
// Every control is a native one, so the keyboard reaches and operates all of it.

export function TokenBar({
  tokens,
  selectedId,
  onSelect,
  onAdd,
  onToggleHidden,
  onRename,
  onStack,
  onDelete,
  busy,
  live = false,
}: {
  tokens: readonly SceneToken[];
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
  onAdd: () => void;
  onToggleHidden: (token: SceneToken) => void;
  onRename: (token: SceneToken) => void;
  onStack: (token: SceneToken, stack: 'front' | 'back') => void;
  onDelete: (token: SceneToken) => void;
  /** A placement is under way: the controls refuse, keeping focus where it is (D-093). */
  busy: boolean;
  /** Live mode: label and stacking order are edited only on scenes that are not live. */
  live?: boolean;
}) {
  const selectId = useId();
  const selected = tokens.find((token) => token.id === selectedId);
  const guard = (action: () => void) => () => {
    if (!busy) action();
  };
  return (
    <div className="eg-tokens" role="group" aria-label={t('tokens.bar')}>
      <Button size="small" aria-disabled={busy || undefined} onClick={guard(onAdd)}>
        {t('tokens.add')}
      </Button>
      {tokens.length > 0 ? (
        <div className="eg-tokens__select">
          {/* Named for assistive technology and kept off screen, so the bar stays short. */}
          <label htmlFor={selectId} className="eg-visually-hidden">
            {t('tokens.selected')}
          </label>
          <select
            id={selectId}
            className="eg-field__input eg-tokens__input"
            value={selected?.id ?? ''}
            onChange={(event) => onSelect(event.target.value === '' ? undefined : event.target.value)}
          >
            <option value="">{t('tokens.none')}</option>
            {tokens.map((token) => (
              <option key={token.id} value={token.id}>
                {token.hidden ? t('tokens.optionHidden', { label: token.label }) : token.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {selected ? (
        <>
          <Button
            size="small"
            aria-disabled={busy || undefined}
            aria-label={t(selected.hidden ? 'tokens.revealOf' : 'tokens.hideOf', { label: selected.label })}
            onClick={guard(() => onToggleHidden(selected))}
          >
            {selected.hidden ? t('tokens.reveal') : t('tokens.hide')}
          </Button>
          {live ? null : (
            <>
              <Button
                size="small"
                aria-disabled={busy || undefined}
                aria-label={t('tokens.renameOf', { label: selected.label })}
                onClick={guard(() => onRename(selected))}
              >
                {t('tokens.rename')}
              </Button>
              <Button
                size="small"
                aria-disabled={busy || undefined}
                aria-label={t('tokens.frontOf', { label: selected.label })}
                onClick={guard(() => onStack(selected, 'front'))}
              >
                {t('tokens.front')}
              </Button>
              <Button
                size="small"
                aria-disabled={busy || undefined}
                aria-label={t('tokens.backOf', { label: selected.label })}
                onClick={guard(() => onStack(selected, 'back'))}
              >
                {t('tokens.back')}
              </Button>
            </>
          )}
          <Button
            size="small"
            aria-disabled={busy || undefined}
            aria-label={t('tokens.deleteOf', { label: selected.label })}
            onClick={guard(() => onDelete(selected))}
          >
            {t('tokens.delete')}
          </Button>
        </>
      ) : null}
    </div>
  );
}

/** Renames a token; a label must have something besides white space, as the server requires. */
export function RenameDialog({
  token,
  onSave,
  onClose,
}: {
  token: SceneToken;
  /** Answers why the server refused the label, if it did; the dialog shows it beside the field. */
  onSave: (label: string) => Promise<string | undefined>;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(token.label);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const trimmed = label.trim();
    if (trimmed === '') return setError(t('tokens.renameDialog.required'));
    setSaving(true);
    const refusal = await onSave(trimmed);
    setSaving(false);
    if (refusal === undefined) onClose();
    else setError(refusal);
  }

  return (
    <Dialog heading={t('tokens.renameDialog.heading', { label: token.label })} onClose={onClose}>
      <form onSubmit={(event) => void save(event)} noValidate>
        <TextField
          label={t('tokens.renameDialog.label')}
          value={label}
          error={error}
          maxLength={200}
          onChange={(event) => {
            setLabel(event.target.value);
            setError(undefined);
          }}
        />
        <div className="eg-dialog__actions">
          <Button type="submit" variant="primary" aria-disabled={saving || undefined}>
            {saving ? t('tokens.renameDialog.saving') : t('tokens.renameDialog.save')}
          </Button>
          <Button onClick={onClose}>{t('tokens.renameDialog.cancel')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Asks before deleting a token: deletions are permanent (specs/03-domain-model.md §7). */
export function DeleteTokenDialog({
  token,
  onConfirm,
  onClose,
}: {
  token: SceneToken;
  onConfirm: () => void;
  onClose: () => void;
}) {
  // The dialog opens on the button that keeps the token, so Enter pressed straight after Delete
  // on the map deletes nothing (review).
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => keep.current?.focus(), []);
  return (
    <Dialog heading={t('tokens.deleteDialog.heading', { label: token.label })} onClose={onClose}>
      <p className="eg-dialog__body">{t('tokens.deleteDialog.body')}</p>
      <div className="eg-dialog__actions">
        <Button variant="danger" onClick={onConfirm}>
          {t('tokens.deleteDialog.confirm')}
        </Button>
        <Button ref={keep} onClick={onClose}>
          {t('tokens.deleteDialog.cancel')}
        </Button>
      </div>
    </Dialog>
  );
}
