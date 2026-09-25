import { imageFileUrl, type LibraryAsset } from '@emberglass/shared';
import { Button } from '../../ui/Button.js';
import { Dialog } from '../../ui/Dialog.js';
import { t } from '../../ui/messages.js';
import { categoryLabel, sizeLabel } from '../library/labels.js';
import { AssetFilters, useAssetSearch } from '../library/useAssetSearch.js';

// The token picker (PRP-04, specs/05-assets-and-images.md §5): the second step of adding a token,
// after the add button and before the click on the map. It searches and filters the library as the
// library panel does (useAssetSearch, D-022); choosing an asset closes it and the map then takes the
// click that places the token.

export function TokenPicker({ onPick, onClose }: { onPick: (asset: LibraryAsset) => void; onClose: () => void }) {
  const search = useAssetSearch(0);
  const { results, failure, filtering } = search;
  return (
    <Dialog heading={t('tokens.picker.heading')} onClose={onClose}>
      <div className="eg-picker">
        <AssetFilters search={search} />
        {results === undefined ? (
          failure ? null : (
            <p className="eg-dm__status">{t('library.loading')}</p>
          )
        ) : results.length === 0 ? (
          <p className="eg-dm__status">{filtering ? t('library.noMatch') : t('tokens.picker.empty')}</p>
        ) : (
          <ul className="eg-picker__list" aria-label={t('tokens.picker.results')}>
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
                <Button
                  size="small"
                  aria-label={t('tokens.picker.chooseOf', { name: asset.name })}
                  onClick={() => onPick(asset)}
                >
                  {t('tokens.picker.choose')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="eg-dialog__actions">
          <Button onClick={onClose}>{t('tokens.picker.cancel')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
