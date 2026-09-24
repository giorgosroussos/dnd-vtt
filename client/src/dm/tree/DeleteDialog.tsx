import { useEffect, useState } from 'react';
import type { DeletionSummary } from '@emberglass/shared';
import { Button } from '../../ui/Button.js';
import { Dialog } from '../../ui/Dialog.js';
import { Notice } from '../../ui/Notice.js';
import { errorMessage } from '../../ui/errorMessage.js';
import { t } from '../../ui/messages.js';
import { errorCode, request } from '../api.js';
import { entityPath, type TreeKind } from './paths.js';

// The confirmation of a deletion (specs/03-domain-model.md §7, Q-003, Q-031, D-078).
// It states what goes, from the server's own count, and warns when the live scene
// is among it; Delete sends that count back, and the server deletes only if it is
// still true. A native modal dialog, so the browser keeps focus inside it and
// Escape cancels.

export interface DeleteTarget {
  kind: TreeKind;
  id: string;
  name: string;
}

const LINES: Record<TreeKind, (keyof Omit<DeletionSummary, 'live'>)[]> = {
  campaign: ['sessions', 'scenes', 'tokens'],
  session: ['scenes', 'tokens'],
  scene: ['tokens'],
};
const LINE_KEYS = { sessions: 'delete.sessions', scenes: 'delete.scenes', tokens: 'delete.tokens' } as const;

export function DeleteDialog({
  target,
  onDeleted,
  onClose,
}: {
  target: DeleteTarget;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [summary, setSummary] = useState<DeletionSummary>();
  const [changed, setChanged] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [pending, setPending] = useState(false);
  const path = entityPath(target.kind, target.id);

  useEffect(() => {
    request<DeletionSummary>('GET', `${path}/deletion`).then(setSummary, (error: unknown) =>
      setFailure(errorMessage(errorCode(error))),
    );
  }, [path]);

  async function confirm() {
    if (!summary) return;
    setPending(true);
    setFailure(undefined);
    try {
      await request('DELETE', path, { confirm: summary });
      onDeleted();
    } catch (error) {
      setPending(false);
      if (errorCode(error) !== 'confirmation_mismatch') return setFailure(errorMessage(errorCode(error)));
      // Something was added or removed meanwhile: show the new count, delete nothing.
      setChanged(true);
      setSummary(undefined);
      try {
        setSummary(await request<DeletionSummary>('GET', `${path}/deletion`));
      } catch (reload) {
        setFailure(errorMessage(errorCode(reload)));
      }
    }
  }

  return (
    <Dialog heading={t('delete.heading', { name: target.name })} onClose={onClose}>
      {changed ? <Notice>{t('delete.changed')}</Notice> : null}
      {failure ? <Notice>{failure}</Notice> : null}
      {summary ? (
        <div className="eg-dialog__body">
          <p>{t('delete.intro')}</p>
          <ul className="eg-dialog__counts">
            {LINES[target.kind].map((line) => (
              <li key={line}>{t(LINE_KEYS[line], { count: summary[line] })}</li>
            ))}
          </ul>
          {summary.live ? <p className="eg-dialog__warning">{t('delete.live')}</p> : null}
        </div>
      ) : failure ? null : (
        <p className="eg-dm__status">{t('tree.loading')}</p>
      )}
      <div className="eg-dialog__actions">
        <Button onClick={onClose}>{t('delete.cancel')}</Button>
        <Button variant="danger" onClick={() => void confirm()} disabled={!summary || pending}>
          {t('delete.confirm')}
        </Button>
      </div>
    </Dialog>
  );
}
