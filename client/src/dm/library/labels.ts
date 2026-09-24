import { API_ASSET_PATHS, type AssetCategory, type TokenSize } from '@emberglass/shared';
import { t, type MessageKey } from '../../ui/messages.js';

// Display text and paths of the library (D-088).

export const categoryLabel = (category: AssetCategory): string => t(`asset.category.${category}` as MessageKey);
export const sizeLabel = (size: TokenSize): string => t(`asset.size.${size}` as MessageKey);

export const assetPath = (id: string): string => API_ASSET_PATHS.asset.replace(':id', encodeURIComponent(id));

/** Bytes as megabytes the way the upload limit is stated: 52,428,800 bytes is 50 MB (D-075). */
export function megabytes(bytes: number): string {
  return new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024));
}
