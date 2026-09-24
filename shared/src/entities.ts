import { Type, type Static } from 'typebox';

// The eight stored entities of specs/03-domain-model.md §1, as the server reads
// them from SQLite (server/migrations/0001_initial_schema.sql, D-075). Field
// names are the specification's; booleans are booleans here and 0/1 in SQLite;
// a scene's grid and an image's grid preset are nested here and `grid_*` and
// `grid_preset_*` columns there. REST bodies (SRV-03 onward) are built from
// these. What a player client receives is a projection of them defined by
// LIV-02 (specs/04-live-sync.md §4), never these records.

// Lowercase, as the server generates them (specs/03-domain-model.md §3, D-038).
export const UuidSchema = Type.String({ pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' });
// The lowercase hex sha256 of an image's original bytes (specs/03-domain-model.md §3).
export const Sha256Schema = Type.String({ pattern: '^[0-9a-f]{64}$' });

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const ASSET_CATEGORIES = ['pc', 'npc', 'monster', 'object'] as const;
export const TOKEN_SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const;
export const RULER_RULES = ['phb', 'dmg'] as const;
// Prepared for later phases: one value each in the MVP (specs/03-domain-model.md §8).
export const GRID_TYPES = ['square'] as const;
export const RULES_VERSION = '5e-2014';

// Defaults the schema applies (specs/03-domain-model.md §6, specs/06-grid-and-measurement.md §5,
// specs/05-assets-and-images.md §6, §7).
export const DEFAULT_GRID_EXTENT = { columns: 30, rows: 20 } as const;
export const DEFAULT_FEET_PER_SQUARE = 5;
export const DEFAULT_SETTINGS = {
  ruler_rule: 'phb',
  upload_limit_bytes: 50 * 1024 * 1024,
  display_variant_size: 4096,
} as const;

const strict = { additionalProperties: false } as const;

// Size and offsets are in the original image's pixels (specs/06-grid-and-measurement.md §2).
// `size` is null until a square size is calibrated; a scene without a map has none.
export const GridSchema = Type.Object(
  {
    type: Type.Enum(GRID_TYPES),
    size: Type.Union([Type.Number({ exclusiveMinimum: 0 }), Type.Null()]),
    offset_x: Type.Number(),
    offset_y: Type.Number(),
    visible: Type.Boolean(),
    feet_per_square: Type.Number({ exclusiveMinimum: 0 }),
    columns: Type.Integer({ minimum: 1 }),
    rows: Type.Integer({ minimum: 1 }),
  },
  strict,
);

// A calibrated grid, copied into each new scene of the image (specs/03-domain-model.md §5).
export const GridPresetSchema = Type.Object(
  { ...GridSchema.properties, size: Type.Number({ exclusiveMinimum: 0 }) },
  strict,
);

export const ImageVariantSchema = Type.Object(
  { width: Type.Integer({ minimum: 1 }), height: Type.Integer({ minimum: 1 }) },
  strict,
);

// Written by the upload pipeline (SRV-04, D-021); empty until then.
export const ImageVariantsSchema = Type.Object(
  { display: Type.Optional(ImageVariantSchema), thumbnail: Type.Optional(ImageVariantSchema) },
  strict,
);

export const ImageSchema = Type.Object(
  {
    id: Sha256Schema,
    mime: Type.Enum(IMAGE_MIME_TYPES),
    width: Type.Integer({ minimum: 1 }),
    height: Type.Integer({ minimum: 1 }),
    variants: ImageVariantsSchema,
    grid_preset: Type.Union([GridPresetSchema, Type.Null()]),
  },
  strict,
);

export const AssetSchema = Type.Object(
  {
    id: UuidSchema,
    name: Type.String({ minLength: 1 }),
    category: Type.Enum(ASSET_CATEGORIES),
    image_id: Sha256Schema,
    size: Type.Enum(TOKEN_SIZES),
    default_hidden: Type.Boolean(),
    notes: Type.String(),
  },
  strict,
);

export const AssetTagSchema = Type.Object(
  { id: UuidSchema, asset_id: UuidSchema, tag: Type.String({ minLength: 1 }) },
  strict,
);

export const CampaignSchema = Type.Object(
  {
    id: UuidSchema,
    name: Type.String({ minLength: 1 }),
    description: Type.String(),
    rules_version: Type.Literal(RULES_VERSION),
  },
  strict,
);

export const SessionSchema = Type.Object(
  {
    id: UuidSchema,
    campaign_id: UuidSchema,
    title: Type.String({ minLength: 1 }),
    order: Type.Integer({ minimum: 0 }),
    // A calendar date, YYYY-MM-DD, or none.
    date: Type.Union([Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }), Type.Null()]),
  },
  strict,
);

export const SceneSchema = Type.Object(
  {
    id: UuidSchema,
    session_id: UuidSchema,
    name: Type.String({ minLength: 1 }),
    order: Type.Integer({ minimum: 0 }),
    map_image_id: Type.Union([Sha256Schema, Type.Null()]),
    grid: GridSchema,
  },
  strict,
);

// Position in decimal grid units, never pixels (specs/03-domain-model.md §4).
export const TokenSchema = Type.Object(
  {
    id: UuidSchema,
    scene_id: UuidSchema,
    asset_id: UuidSchema,
    label: Type.String({ minLength: 1 }),
    x: Type.Number(),
    y: Type.Number(),
    hidden: Type.Boolean(),
    z_order: Type.Integer(),
    // Always empty in the MVP; Phase 2 links characters through it.
    character_id: Type.Null(),
  },
  strict,
);

// The PIN hash is stored in the same row but is not part of this contract: it
// never leaves the server (specs/07-security-and-access.md §1).
export const SettingsSchema = Type.Object(
  {
    id: UuidSchema,
    live_scene_id: Type.Union([UuidSchema, Type.Null()]),
    ruler_rule: Type.Enum(RULER_RULES),
    upload_limit_bytes: Type.Integer({ minimum: 1 }),
    display_variant_size: Type.Integer({ minimum: 1 }),
  },
  strict,
);

export type Grid = Static<typeof GridSchema>;
export type GridPreset = Static<typeof GridPresetSchema>;
export type ImageVariants = Static<typeof ImageVariantsSchema>;
export type Image = Static<typeof ImageSchema>;
export type Asset = Static<typeof AssetSchema>;
export type AssetTag = Static<typeof AssetTagSchema>;
export type Campaign = Static<typeof CampaignSchema>;
export type Session = Static<typeof SessionSchema>;
export type Scene = Static<typeof SceneSchema>;
export type Token = Static<typeof TokenSchema>;
export type Settings = Static<typeof SettingsSchema>;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];
export type TokenSize = (typeof TOKEN_SIZES)[number];
export type RulerRule = (typeof RULER_RULES)[number];
export type ImageMime = (typeof IMAGE_MIME_TYPES)[number];
