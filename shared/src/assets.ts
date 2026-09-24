import { Type, type Static } from 'typebox';
import { AssetSchema, ASSET_CATEGORIES, Sha256Schema, TOKEN_SIZES, UuidSchema } from './entities.js';

// The shared asset library over REST (specs/02-architecture.md §5, specs/05-assets-and-images.md
// §1, §2, §4, §5, specs/03-domain-model.md §7, D-020, D-022, D-083). Every body is strict: an
// unknown field, an `id` included, is refused, because the server alone generates identifiers
// (D-038). Responses are the Asset record of entities.ts with its tags.

const strict = { additionalProperties: false } as const;

export const API_ASSET_PATHS = {
  assets: '/api/assets',
  asset: '/api/assets/:id',
  assetUsages: '/api/assets/:id/usages',
} as const;

// Footprint in squares per side of a token of each size (specs/05-assets-and-images.md §2).
export const TOKEN_FOOTPRINT = {
  tiny: 0.5,
  small: 1,
  medium: 1,
  large: 2,
  huge: 3,
  gargantuan: 4,
} as const satisfies Record<(typeof TOKEN_SIZES)[number], number>;

/**
 * A tag as the server stores and matches it (G-009, D-083): surrounding white space removed,
 * inner runs of it made one space, Unicode NFC, lower case. Two tags that look the same are the
 * same tag; the empty string means there is no tag.
 */
export function normalizeTag(tag: string): string {
  return tag.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

// Free text before normalisation; a tag that is empty once normalised is refused.
const TagInputSchema = Type.String({ minLength: 1 });

/** An asset with its tags, normalised and sorted. */
export const LibraryAssetSchema = Type.Object(
  { ...AssetSchema.properties, tags: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }) },
  strict,
);

// `default_hidden` starts from the category when it is left out: monster hidden, the rest
// visible (specs/05-assets-and-images.md §4, D-020, Q-045).
export const AssetCreateBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    image_id: Sha256Schema,
    category: Type.Enum(ASSET_CATEGORIES),
    size: Type.Enum(TOKEN_SIZES),
    default_hidden: Type.Optional(Type.Boolean()),
    tags: Type.Optional(Type.Array(TagInputSchema)),
    notes: Type.Optional(Type.String()),
  },
  strict,
);

// `tags` replaces the asset's whole set. A new `image_id` changes the image of every token of
// the asset (specs/05-assets-and-images.md §5); a new category leaves `default_hidden` alone.
export const AssetUpdateBodySchema = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1 })),
    image_id: Type.Optional(Sha256Schema),
    category: Type.Optional(Type.Enum(ASSET_CATEGORIES)),
    size: Type.Optional(Type.Enum(TOKEN_SIZES)),
    default_hidden: Type.Optional(Type.Boolean()),
    tags: Type.Optional(Type.Array(TagInputSchema)),
    notes: Type.Optional(Type.String()),
  },
  { ...strict, minProperties: 1 },
);

// GET /api/assets: `q` is a case-insensitive substring of the name or of a tag; `category`
// narrows to one category; `tag`, repeatable, narrows to assets carrying every one of them.
// Results are sorted by name (specs/05-assets-and-images.md §1, D-022, Q-064).
export const AssetListQuerySchema = Type.Object(
  {
    q: Type.Optional(Type.String()),
    category: Type.Optional(Type.Enum(ASSET_CATEGORIES)),
    tag: Type.Optional(Type.Union([TagInputSchema, Type.Array(TagInputSchema)])),
  },
  strict,
);

/** One scene whose tokens use the asset, with where it sits in the tree. */
export const AssetUsageSchema = Type.Object(
  {
    scene_id: UuidSchema,
    scene_name: Type.String({ minLength: 1 }),
    session_id: UuidSchema,
    session_title: Type.String({ minLength: 1 }),
    campaign_id: UuidSchema,
    campaign_name: Type.String({ minLength: 1 }),
    tokens: Type.Integer({ minimum: 1 }),
  },
  strict,
);

export const AssetUsagesSchema = Type.Array(AssetUsageSchema);

export type LibraryAsset = Static<typeof LibraryAssetSchema>;
export type AssetCreateBody = Static<typeof AssetCreateBodySchema>;
export type AssetUpdateBody = Static<typeof AssetUpdateBodySchema>;
export type AssetListQuery = Static<typeof AssetListQuerySchema>;
export type AssetUsage = Static<typeof AssetUsageSchema>;
