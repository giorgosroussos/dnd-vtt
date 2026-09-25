import { useEffect, useId, useState } from 'react';
import { API_ASSET_PATHS, ASSET_CATEGORIES, type AssetCategory, type LibraryAsset } from '@emberglass/shared';
import { Button } from '../../ui/Button.js';
import { Notice } from '../../ui/Notice.js';
import { TextField } from '../../ui/TextField.js';
import { errorMessage } from '../../ui/errorMessage.js';
import { t } from '../../ui/messages.js';
import { errorCode, request } from '../api.js';
import { categoryLabel } from './labels.js';

// The library's search and filters (specs/05-assets-and-images.md §1, D-022, D-083, D-088), shared by
// the library panel and the token picker (PRP-04, specs/05-assets-and-images.md §5). Search, the
// category and the tags are sent to the server, which applies the library's rules: a substring of a
// name or tag, one category, every selected tag; sorted by name. The tags to pick from are every tag
// of the whole library.

export const SEARCH_DELAY_MS = 250;

export interface AssetSearch {
  typed: string;
  setTyped: (value: string) => void;
  category: AssetCategory | '';
  setCategory: (value: AssetCategory | '') => void;
  tags: readonly string[];
  toggleTag: (tag: string) => void;
  knownTags: string[];
  /** The assets that match, undefined until the first answer. */
  results: LibraryAsset[] | undefined;
  filtering: boolean;
  failure: string | undefined;
  tagsFailure: string | undefined;
}

/** `version` changes when the library changed, to read it again. */
export function useAssetSearch(version: number): AssetSearch {
  const [all, setAll] = useState<LibraryAsset[]>();
  const [results, setResults] = useState<LibraryAsset[]>();
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<AssetCategory | ''>('');
  const [tags, setTags] = useState<readonly string[]>([]);
  // Each request keeps its own failure, so one answering does not hide the other's.
  const [tagsFailure, setTagsFailure] = useState<string>();
  const [failure, setFailure] = useState<string>();

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

  return {
    typed,
    setTyped,
    category,
    setCategory,
    tags,
    toggleTag: (tag) =>
      setTags((current) => (current.includes(tag) ? current.filter((each) => each !== tag) : [...current, tag])),
    knownTags: [...new Set([...(all ?? []).flatMap((asset) => asset.tags), ...tags])].sort(),
    results,
    filtering: search !== '' || category !== '' || tags.length > 0,
    failure,
    tagsFailure,
  };
}

/** The search field, the category and the tags, with the failures of their requests. */
export function AssetFilters({ search }: { search: AssetSearch }) {
  const categoryId = useId();
  return (
    <>
      <TextField
        type="search"
        label={t('library.search')}
        value={search.typed}
        onChange={(event) => search.setTyped(event.target.value)}
      />
      <div className="eg-field">
        <label htmlFor={categoryId}>{t('library.category')}</label>
        <select
          id={categoryId}
          className="eg-field__input"
          value={search.category}
          onChange={(event) => search.setCategory(event.target.value as AssetCategory | '')}
        >
          <option value="">{t('library.allCategories')}</option>
          {ASSET_CATEGORIES.map((each) => (
            <option key={each} value={each}>
              {categoryLabel(each)}
            </option>
          ))}
        </select>
      </div>
      {search.knownTags.length > 0 ? (
        <div className="eg-library__tags" role="group" aria-label={t('library.tags')}>
          {search.knownTags.map((tag) => (
            <Button
              key={tag}
              size="small"
              aria-pressed={search.tags.includes(tag)}
              aria-label={t('library.tagOf', { tag })}
              onClick={() => search.toggleTag(tag)}
            >
              {tag}
            </Button>
          ))}
        </div>
      ) : null}
      {search.tagsFailure ? <Notice>{search.tagsFailure}</Notice> : null}
      {search.failure ? <Notice>{search.failure}</Notice> : null}
    </>
  );
}
