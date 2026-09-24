import { useState } from 'react';
import type { AssetUsage, LibraryAsset } from '@emberglass/shared';
import { Button } from '../../ui/Button.js';
import { Dialog } from '../../ui/Dialog.js';
import { Notice } from '../../ui/Notice.js';
import { errorMessage } from '../../ui/errorMessage.js';
import { t } from '../../ui/messages.js';
import { ApiError, errorCode, request } from '../api.js';
import { assetPath } from './labels.js';

// Deleting an asset (specs/03-domain-model.md §7, specs/05-assets-and-images.md §5,
// D-083). The server refuses while any token uses it and names the scenes that do;
// the dialog then lists them, with where each sits, and offers only Close.
export function AssetDeleteDialog({
  asset,
  onDeleted,
  onClose,
}: {
  asset: LibraryAsset;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [usages, setUsages] = useState<readonly AssetUsage[]>();
  const [failure, setFailure] = useState<string>();
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    setFailure(undefined);
    try {
      await request('DELETE', assetPath(asset.id));
      onDeleted();
    } catch (error) {
      setPending(false);
      if (error instanceof ApiError && error.code === 'asset_in_use') return setUsages(error.usages);
      setFailure(errorMessage(errorCode(error)));
    }
  }

  return (
    <Dialog heading={t('assetDelete.heading', { name: asset.name })} onClose={onClose}>
      {failure ? <Notice>{failure}</Notice> : null}
      {usages ? (
        <div className="eg-dialog__body" role="alert">
          <p>{t('assetDelete.inUse', { name: asset.name })}</p>
          <ul className="eg-dialog__counts">
            {usages.map((usage) => (
              <li key={usage.scene_id}>
                {t('assetDelete.usage', {
                  campaign: usage.campaign_name,
                  session: usage.session_title,
                  scene: usage.scene_name,
                  tokens: usage.tokens,
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p>{t('assetDelete.intro')}</p>
      )}
      <div className="eg-dialog__actions">
        {usages ? (
          <Button variant="primary" onClick={onClose}>
            {t('assetDelete.close')}
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>{t('assetDelete.cancel')}</Button>
            <Button variant="danger" onClick={() => void confirm()} disabled={pending}>
              {t('assetDelete.confirm')}
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}
