import { useRef, useState } from 'react';
import { imageFileUrl, type LibraryAsset } from '@emberglass/shared';
import { Button } from '../../ui/Button.js';
import { t } from '../../ui/messages.js';
import { AssetDeleteDialog } from './AssetDeleteDialog.js';
import { AssetDialog } from './AssetDialog.js';
import { categoryLabel, sizeLabel } from './labels.js';
import { AssetFilters, useAssetSearch } from './useAssetSearch.js';

// The shared asset library, the workspace's right-hand panel (specs/08-ux-journeys.md
// §1, specs/05-assets-and-images.md §1, D-022, D-083, D-088). Its search and filters are
// useAssetSearch's, which the token picker shares (PRP-04).

export { SEARCH_DELAY_MS } from './useAssetSearch.js';

type Open = { kind: 'create' } | { kind: 'edit'; asset: LibraryAsset } | { kind: 'delete'; asset: LibraryAsset };

export function Library({ uploadLimit }: { uploadLimit: number }) {
  const [version, setVersion] = useState(0);
  const search = useAssetSearch(version);
  const { results, failure, filtering } = search;
  const [open, setOpen] = useState<Open>();
  const newButton = useRef<HTMLDivElement>(null);

  const changed = () => {
    setOpen(undefined);
    setVersion((each) => each + 1);
  };

  // A deleted asset takes the button that opened its dialog with it; the keyboard
  // goes to New asset instead of the page body (as D-087 does in the tree).
  const deleted = () => {
    changed();
    newButton.current?.querySelector('button')?.focus();
  };

  return (
    <div className="eg-library">
      <h2 className="eg-library__heading">{t('library.heading')}</h2>
      <div ref={newButton}>
        <Button onClick={() => setOpen({ kind: 'create' })}>{t('library.new')}</Button>
      </div>
      <AssetFilters search={search} />
      {results === undefined ? (
        failure ? null : (
          <p className="eg-dm__status">{t('library.loading')}</p>
        )
      ) : results.length === 0 ? (
        <p className="eg-dm__status">{filtering ? t('library.noMatch') : t('library.empty')}</p>
      ) : (
        <ul className="eg-library__list">
          {results.map((asset) => (
            <li key={asset.id} className="eg-library__item" data-asset={asset.id}>
              {/* Decorative: the name beside it says what it is. */}
              <img className="eg-library__thumb" src={imageFileUrl(asset.image_id, 'thumbnail')} alt="" />
              <div className="eg-library__text">
                <span className="eg-library__name">{asset.name}</span>
                <span className="eg-library__meta">
                  {t('library.meta', { category: categoryLabel(asset.category), size: sizeLabel(asset.size) })}
                </span>
                {asset.default_hidden ? <span className="eg-library__hidden">{t('library.hidden')}</span> : null}
              </div>
              <span className="eg-tree__actions">
                <Button
                  size="small"
                  aria-label={t('library.editOf', { name: asset.name })}
                  onClick={() => setOpen({ kind: 'edit', asset })}
                >
                  {t('library.edit')}
                </Button>
                <Button
                  size="small"
                  aria-label={t('library.deleteOf', { name: asset.name })}
                  onClick={() => setOpen({ kind: 'delete', asset })}
                >
                  {t('library.delete')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {open?.kind === 'create' ? (
        <AssetDialog uploadLimit={uploadLimit} onSaved={changed} onClose={() => setOpen(undefined)} />
      ) : null}
      {open?.kind === 'edit' ? (
        <AssetDialog
          asset={open.asset}
          uploadLimit={uploadLimit}
          onSaved={changed}
          onClose={() => setOpen(undefined)}
        />
      ) : null}
      {open?.kind === 'delete' ? (
        <AssetDeleteDialog asset={open.asset} onDeleted={deleted} onClose={() => setOpen(undefined)} />
      ) : null}
    </div>
  );
}
