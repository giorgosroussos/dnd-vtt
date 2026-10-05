import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SceneToken } from '@emberglass/shared';
import { Button } from '../../ui/Button.js';
import { Dialog } from '../../ui/Dialog.js';
import { TextField } from '../../ui/TextField.js';
import { t } from '../../ui/messages.js';

// The token dialogs (PRP-04, specs/05-assets-and-images.md §3, specs/03-domain-model.md §7, D-100): renaming
// a token and confirming its deletion. The controls that open them are the token's popover (UIX-01).

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

// Deleting several selected tokens (UXR-02): asked once for the group, opening on the button that keeps them.
export function DeleteGroupDialog({
  count,
  onConfirm,
  onClose,
}: {
  count: number;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => keep.current?.focus(), []);
  return (
    <Dialog heading={t('group.deleteDialog.heading', { count })} onClose={onClose}>
      <p className="eg-dialog__body">{t('group.deleteDialog.body')}</p>
      <div className="eg-dialog__actions">
        <Button variant="danger" onClick={onConfirm}>
          {t('group.deleteDialog.confirm')}
        </Button>
        <Button ref={keep} onClick={onClose}>
          {t('group.deleteDialog.cancel')}
        </Button>
      </div>
    </Dialog>
  );
}
