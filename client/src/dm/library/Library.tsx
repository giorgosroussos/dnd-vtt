import { useRef, useState } from 'react';
import { API_ARCHIVE_PATHS, imageFileUrl, type LibraryAsset } from '@emberglass/shared';
import { ImportDialog } from '../archive/ImportDialog.js';
import { useFocusLater } from '../../ui/useFocusLater.js';
import { Button } from '../../ui/Button.js';
import { t } from '../../ui/messages.js';
import { AssetDeleteDialog } from './AssetDeleteDialog.js';
import { AssetDialog } from './AssetDialog.js';
import { categoryLabel, sizeLabel } from './labels.js';
import { AssetFilters, useAssetSearch } from './useAssetSearch.js';

// The shared asset library, the workspace's right-hand panel (specs/08-ux-journeys.md
// §1, specs/05-assets-and-images.md §1, D-022, D-083, D-088). Its search and filters are
// useAssetSearch's, which the token picker shares (PRP-04). Select turns on a selection mode, a check box on each
// asset, with Export selected and Export all, downloads of the archive of those assets with their tags and images;
// Import takes an export of either kind (DMT-05, specs/08-ux-journeys.md §13, specs/09-operations.md §9).

export { SEARCH_DELAY_MS } from './useAssetSearch.js';

type Open =
  | { kind: 'create' }
  | { kind: 'edit'; asset: LibraryAsset }
  | { kind: 'delete'; asset: LibraryAsset }
  | { kind: 'import' };

/** The download of the assets named: each as a repeated `id`. */
export const assetsExportPath = (ids: readonly string[]): string =>
  `${API_ARCHIVE_PATHS.exportAssets}?${ids.map((id) => `id=${encodeURIComponent(id)}`).join('&')}`;

export function Library({ uploadLimit }: { uploadLimit: number }) {
  const [version, setVersion] = useState(0);
  const search = useAssetSearch(version);
  const { results, failure, filtering } = search;
  const [open, setOpen] = useState<Open>();
  // The assets chosen for an export while the selection mode is on; undefined while it is off.
  const [selection, setSelection] = useState<ReadonlySet<string>>();
  const newButton = useRef<HTMLDivElement>(null);
  const toggle = (id: string) =>
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Only assets still in the library count: one deleted meanwhile drops out of the selection.
  const chosen = selection ? (results ?? []).filter((asset) => selection.has(asset.id)).map((asset) => asset.id) : [];

  const changed = () => {
    setOpen(undefined);
    setVersion((each) => each + 1);
  };

  // A deleted asset takes the button that opened its dialog with it; the keyboard
  // goes to New asset instead of the page body (as D-087 does in the tree).
  const focusLater = useFocusLater();
  const deleted = () => {
    changed();
    focusLater(() => newButton.current?.querySelector('button'));
  };

  return (
    <div className="eg-library">
      <h2 className="eg-library__heading">{t('library.heading')}</h2>
      <div ref={newButton} className="eg-library__actions">
        <Button onClick={() => setOpen({ kind: 'create' })}>{t('library.new')}</Button>
        <Button size="small" onClick={() => setOpen({ kind: 'import' })}>
          {t('library.import')}
        </Button>
        <Button
          size="small"
          aria-pressed={selection !== undefined}
          onClick={() => setSelection((current) => (current ? undefined : new Set()))}
        >
          {t('library.select')}
        </Button>
      </div>
      {selection ? (
        <div className="eg-library__actions" role="group" aria-label={t('library.exportLabel')}>
          {chosen.length > 0 ? (
            <a
              className="eg-button eg-button--primary eg-button--small"
              href={assetsExportPath(chosen)}
              download
              data-action="export-selected"
            >
              {t('library.exportSelected', { count: chosen.length })}
            </a>
          ) : (
            <Button size="small" variant="primary" aria-disabled="true" data-action="export-selected">
              {t('library.exportSelected', { count: 0 })}
            </Button>
          )}
          <a
            className="eg-button eg-button--secondary eg-button--small"
            href={API_ARCHIVE_PATHS.exportAssets}
            download
            data-action="export-all"
          >
            {t('library.exportAll')}
          </a>
        </div>
      ) : null}
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
            <li
              key={asset.id}
              className={selection ? 'eg-library__item eg-library__item--selecting' : 'eg-library__item'}
              data-asset={asset.id}
            >
              {selection ? (
                <input
                  type="checkbox"
                  className="eg-library__check"
                  checked={selection.has(asset.id)}
                  aria-label={t('library.selectOf', { name: asset.name })}
                  onChange={() => toggle(asset.id)}
                />
              ) : null}
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
      {open?.kind === 'import' ? (
        <ImportDialog onImported={() => setVersion((each) => each + 1)} onClose={() => setOpen(undefined)} />
      ) : null}
      {open?.kind === 'delete' ? (
        <AssetDeleteDialog asset={open.asset} onDeleted={deleted} onClose={() => setOpen(undefined)} />
      ) : null}
    </div>
  );
}
