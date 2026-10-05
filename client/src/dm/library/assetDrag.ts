import type { LibraryAsset } from '@emberglass/shared';

// A library asset being dragged onto the map (UXR-03, specs/05-assets-and-images.md §5). The drag carries
// the asset's identifier under its own type, which the map accepts; the asset itself is kept here, because
// a browser lets a drop target read the drag's data only once it is dropped, and the map shows the token's
// footprint under the pointer before that.
export const ASSET_DRAG_TYPE = 'application/x-emberglass-asset';

let dragged: LibraryAsset | undefined;

export const assetDrag = {
  start(asset: LibraryAsset): void {
    dragged = asset;
  },
  end(): void {
    dragged = undefined;
  },
  /** The asset being dragged, when the drag is one of the library's. */
  of(types: readonly string[]): LibraryAsset | undefined {
    return types.includes(ASSET_DRAG_TYPE) ? dragged : undefined;
  },
};
