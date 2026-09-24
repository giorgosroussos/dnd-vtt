import { useId, useState, type FormEvent } from 'react';
import {
  API_ASSET_PATHS,
  ASSET_CATEGORIES,
  TOKEN_SIZES,
  type AssetCategory,
  type LibraryAsset,
  type TokenSize,
} from '@emberglass/shared';
import { Button } from '../../ui/Button.js';
import { Dialog } from '../../ui/Dialog.js';
import { Notice } from '../../ui/Notice.js';
import { TextField } from '../../ui/TextField.js';
import { errorMessage } from '../../ui/errorMessage.js';
import { t } from '../../ui/messages.js';
import { errorCode, request, upload } from '../api.js';
import { assetPath, categoryLabel, megabytes, sizeLabel } from './labels.js';

// Create or edit an asset (specs/05-assets-and-images.md §1, §4, §5, §6, D-083, D-088).
// A new image is uploaded first and the asset then created or changed to use it,
// in one action for the DM; a file over the upload limit is refused here, before a
// byte is sent (G-017). The server still judges type and size itself (05 §6).

const ACCEPT = 'image/png,image/jpeg,image/webp';

function parseTags(text: string): string[] {
  return text
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

export function AssetDialog({
  asset,
  uploadLimit,
  onSaved,
  onClose,
}: {
  asset?: LibraryAsset | undefined;
  uploadLimit: number;
  onSaved: (asset: LibraryAsset) => void;
  onClose: () => void;
}) {
  const categoryId = useId();
  const sizeId = useId();
  const notesId = useId();
  const hiddenId = useId();
  const [file, setFile] = useState<File>();
  const [name, setName] = useState(asset?.name ?? '');
  const [category, setCategory] = useState<AssetCategory>(asset?.category ?? 'monster');
  const [size, setSize] = useState<TokenSize>(asset?.size ?? 'medium');
  const [tags, setTags] = useState(asset?.tags.join(', ') ?? '');
  const [notes, setNotes] = useState(asset?.notes ?? '');
  // For a new asset the flag follows the category until the DM sets it, and is then
  // left out so the server applies the category's default (D-020); an existing
  // asset keeps its own flag whatever its category becomes (D-083).
  const [hidden, setHidden] = useState<boolean | undefined>(asset?.default_hidden);
  const shownHidden = hidden ?? category === 'monster';
  const [errors, setErrors] = useState<{ file?: string | undefined; name?: string | undefined }>({});
  const [failure, setFailure] = useState<string>();
  const [pending, setPending] = useState(false);

  function chooseFile(chosen: File | undefined) {
    setFile(chosen);
    setErrors((all) => ({
      ...all,
      file:
        chosen && chosen.size > uploadLimit
          ? t('assetForm.tooLarge', { size: megabytes(chosen.size), limit: megabytes(uploadLimit) })
          : undefined,
    }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const found: { file?: string | undefined; name?: string | undefined } = {};
    if (!asset && !file) found.file = t('assetForm.imageRequired');
    if (file && file.size > uploadLimit) {
      found.file = t('assetForm.tooLarge', { size: megabytes(file.size), limit: megabytes(uploadLimit) });
    }
    if (name.trim() === '') found.name = t('assetForm.nameRequired');
    setErrors(found);
    if (found.file || found.name) return;
    setFailure(undefined);
    setPending(true);
    try {
      const image = file ? await upload(file) : undefined;
      const fields = { name, category, size, tags: parseTags(tags), notes };
      const saved = asset
        ? await request<LibraryAsset>('PATCH', assetPath(asset.id), {
            ...fields,
            default_hidden: shownHidden,
            ...(image ? { image_id: image.id } : {}),
          })
        : await request<LibraryAsset>('POST', API_ASSET_PATHS.assets, {
            ...fields,
            image_id: image!.id,
            ...(hidden === undefined ? {} : { default_hidden: hidden }),
          });
      onSaved(saved);
    } catch (error) {
      setPending(false);
      setFailure(errorMessage(errorCode(error)));
    }
  }

  return (
    <Dialog
      heading={asset ? t('assetForm.editHeading', { name: asset.name }) : t('assetForm.newHeading')}
      onClose={onClose}
    >
      <form className="eg-form" onSubmit={(event) => void save(event)} noValidate>
        {failure ? <Notice>{failure}</Notice> : null}
        <TextField
          type="file"
          accept={ACCEPT}
          label={asset ? t('assetForm.replaceImage') : t('assetForm.image')}
          error={errors.file}
          onChange={(event) => chooseFile(event.target.files?.[0])}
        />
        <TextField
          label={t('assetForm.name')}
          value={name}
          error={errors.name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="eg-field">
          <label htmlFor={categoryId}>{t('assetForm.category')}</label>
          <select
            id={categoryId}
            className="eg-field__input"
            value={category}
            onChange={(event) => setCategory(event.target.value as AssetCategory)}
          >
            {ASSET_CATEGORIES.map((each) => (
              <option key={each} value={each}>
                {categoryLabel(each)}
              </option>
            ))}
          </select>
        </div>
        <div className="eg-field">
          <label htmlFor={sizeId}>{t('assetForm.size')}</label>
          <select
            id={sizeId}
            className="eg-field__input"
            value={size}
            onChange={(event) => setSize(event.target.value as TokenSize)}
          >
            {TOKEN_SIZES.map((each) => (
              <option key={each} value={each}>
                {sizeLabel(each)}
              </option>
            ))}
          </select>
        </div>
        <TextField label={t('assetForm.tags')} value={tags} onChange={(event) => setTags(event.target.value)} />
        <div className="eg-field">
          <label htmlFor={notesId}>{t('assetForm.notes')}</label>
          <textarea
            id={notesId}
            className="eg-field__input"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
        <div className="eg-check">
          <input
            id={hiddenId}
            type="checkbox"
            checked={shownHidden}
            onChange={(event) => setHidden(event.target.checked)}
          />
          <label htmlFor={hiddenId}>{t('assetForm.hidden')}</label>
        </div>
        <div className="eg-dialog__actions">
          <Button onClick={onClose}>{t('assetForm.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {t('assetForm.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
