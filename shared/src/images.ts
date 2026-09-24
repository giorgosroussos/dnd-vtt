import { Type, type Static } from 'typebox';
import { Sha256Schema } from './entities.js';

// Image upload, metadata and files (specs/02-architecture.md §5, specs/05-assets-and-images.md §6, §7,
// specs/07-security-and-access.md §5, D-021, D-032, D-044, D-080). The upload body is the file's
// bytes, whatever its Content-Type says: the server judges the type from the content alone. A new
// image answers 201, the same bytes again 200 with the stored image and its grid preset; both
// carry the Image record of entities.ts.

export const API_IMAGE_PATHS = {
  images: '/api/images',
  image: '/api/images/:id',
  imagePreset: '/api/images/:id/preset',
} as const;

// The three versions of every image (specs/05-assets-and-images.md §7). The original keeps its
// own format; the display version and the thumbnail are WebP.
export const IMAGE_VARIANTS = ['original', 'display', 'thumbnail'] as const;
export type ImageVariant = (typeof IMAGE_VARIANTS)[number];

// The thumbnail's long edge, in pixels; like the display version it is never upscaled.
export const THUMBNAIL_SIZE = 256;

// Where a version is fetched: outside /api, served only to a DM session until LIV-02 adds the
// player entitlement of specs/07-security-and-access.md §5.
export const IMAGE_FILE_PATH = '/images/:id/:variant';
export const imageFileUrl = (id: string, variant: ImageVariant): string => `/images/${id}/${variant}`;

export const ImageIdParamsSchema = Type.Object({ id: Sha256Schema }, { additionalProperties: false });
export type ImageIdParams = Static<typeof ImageIdParamsSchema>;
