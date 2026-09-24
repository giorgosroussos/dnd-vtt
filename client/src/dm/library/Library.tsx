import { useEffect, useId, useRef, useState } from 'react';
import {
  API_ASSET_PATHS,
  ASSET_CATEGORIES,
  imageFileUrl,
  type AssetCategory,
  type LibraryAsset,
} from '@emberglass/shared';
import { Button } from '../../ui/Button.js';
import { Notice } from '../../ui/Notice.js';
import { TextField } from '../../ui/TextField.js';
import { errorMessage } from '../../ui/errorMessage.js';
import { t } from '../../ui/messages.js';
import { errorCode, request } from '../api.js';
import { AssetDeleteDialog } from './AssetDeleteDialog.js';
import { AssetDialog } from './AssetDialog.js';
import { categoryLabel, sizeLabel } from './labels.js';

// The shared asset library, the workspace's right-hand panel (specs/08-ux-journeys.md
// §1, specs/05-assets-and-images.md §1, D-022, D-083, D-088). Search, the category and
// the tags are sent to the server, which applies the library's rules: a substring of a
// name or tag, one category, every selected tag; sorted by name. The tags to pick from
// are every tag of the whole library.

export const SEARCH_DELAY_MS = 250;

type Open = { kind: 'create' } | { kind: 'edit'; asset: LibraryAsset } | { kind: 'delete'; asset: LibraryAsset };

export function Library({ uploadLimit }: { uploadLimit: number }) {
  const categoryId = useId();
  const [all, setAll] = useState<LibraryAsset[]>();
  const [results, setResults] = useState<LibraryAsset[]>();
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<AssetCategory | ''>('');
  const [tags, setTags] = useState<readonly string[]>([]);
  const [version, setVersion] = useState(0);
  // Each request keeps its own failure, so one answering does not hide the other's.
  const [tagsFailure, setTagsFailure] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [open, setOpen] = useState<Open>();
  const newButton = useRef<HTMLDivElement>(null);

  // The search is sent once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  // The whole library, for the tags to pick from.
  useEffect(() => {
    request<LibraryAsset[]>('GET', API_ASSET_PATHS.assets).then(
      (list) => {
        setAll(list);
        setTagsFailure(undefined);
      },
      (error: unknown) => setTagsFailure(errorMessage(errorCode(error))),
    );
  }, [version]);

  // The results; an answer to an older query is dropped when a newer one was sent.
  useEffect(() => {
    let current = true;
    const query = new URLSearchParams();
    if (search !== '') query.append('q', search);
    if (category !== '') query.append('category', category);
    for (const tag of tags) query.append('tag', tag);
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    request<LibraryAsset[]>('GET', `${API_ASSET_PATHS.assets}${suffix}`).then(
      (list) => {
        if (!current) return;
        setResults(list);
        setFailure(undefined);
      },
      (error: unknown) => {
        if (current) setFailure(errorMessage(errorCode(error)));
      },
    );
    return () => {
      current = false;
    };
  }, [search, category, tags, version]);

  const knownTags = [...new Set([...(all ?? []).flatMap((asset) => asset.tags), ...tags])].sort();
  const filtering = search !== '' || category !== '' || tags.length > 0;

  function toggleTag(tag: string) {
    setTags((current) => (current.includes(tag) ? current.filter((each) => each !== tag) : [...current, tag]));
  }

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
      <TextField
        type="search"
        label={t('library.search')}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
      />
      <div className="eg-field">
        <label htmlFor={categoryId}>{t('library.category')}</label>
        <select
          id={categoryId}
          className="eg-field__input"
          value={category}
          onChange={(event) => setCategory(event.target.value as AssetCategory | '')}
        >
          <option value="">{t('library.allCategories')}</option>
          {ASSET_CATEGORIES.map((each) => (
            <option key={each} value={each}>
              {categoryLabel(each)}
            </option>
          ))}
        </select>
      </div>
      {knownTags.length > 0 ? (
        <div className="eg-library__tags" role="group" aria-label={t('library.tags')}>
          {knownTags.map((tag) => (
            <Button
              key={tag}
              size="small"
              aria-pressed={tags.includes(tag)}
              aria-label={t('library.tagOf', { tag })}
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </Button>
          ))}
        </div>
      ) : null}
      {tagsFailure ? <Notice>{tagsFailure}</Notice> : null}
      {failure ? <Notice>{failure}</Notice> : null}
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
