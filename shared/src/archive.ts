import { Type, type Static, type TSchema } from 'typebox';
import { LibraryAssetSchema } from './assets.js';
import {
  CampaignSchema,
  GridPresetSchema,
  IMAGE_MIME_TYPES,
  SceneSchema,
  SessionSchema,
  Sha256Schema,
  TokenSchema,
  UUID_PATTERN,
  UuidSchema,
  type ImageMime,
} from './entities.js';
import { EncounterSchema } from './encounter.js';
import { FogMaskSchema } from './fog.js';
import { NotesSchema } from './notes.js';

// Export and import (DMT-05; specs/09-operations.md §7, §9, specs/07-security-and-access.md §9,
// specs/05-assets-and-images.md §6, specs/02-architecture.md §5, Q-115, Q-119, D-181). One zip holds either a
// whole campaign, with the assets and images it uses, or library assets with their tags and images:
//
//   manifest.json            ArchiveManifestSchema: the format version, the kind, the counts, the image hashes
//   data/<name>.json         the records, one file per entity, each checked against its schema below
//   images/<sha256>.<ext>    each image's original bytes, named by their sha256 (`05` §7)
//
// Nothing else may be in it. Live state (the player camera, the undo history, the live scene) and the settings
// are never in it, nor any image variant, which the server produces again from the original (D-181). The records
// are the stored entities as the DM's REST answers carry them, with the stored fields no client receives
// (a scene's token numbers and fog, a token's `shown`) added, so a scene comes back exactly as it was.

/** The format this server writes and the newest it reads. A newer archive is refused, storing nothing. */
export const ARCHIVE_FORMAT_VERSION = 1;

export const ARCHIVE_KINDS = ['campaign', 'assets'] as const;
export type ArchiveKind = (typeof ARCHIVE_KINDS)[number];

export const API_ARCHIVE_PATHS = {
  exportCampaign: '/api/export/campaigns/:id',
  exportAssets: '/api/export/assets',
  import: '/api/import',
  importProgress: '/api/import/progress',
} as const;

export const exportCampaignPath = (id: string): string => API_ARCHIVE_PATHS.exportCampaign.replace(':id', id);

/** The import limit's bounds (`09` §7, Q-119); its default, 2 GB, is DEFAULT_SETTINGS'. */
export const IMPORT_LIMIT_BOUNDS = { min: 1024 * 1024, max: 64 * 1024 * 1024 * 1024 } as const;

/**
 * Most entries an archive may hold: far beyond a real campaign, so that a hostile archive cannot have the server
 * walk millions of entries.
 */
export const MAX_ARCHIVE_ENTRIES = 100_000;
/** The largest `manifest.json`, which lists every image hash. */
export const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
/** The largest data file: each is parsed whole, so each is bounded, whatever the import limit. */
export const MAX_DATA_FILE_BYTES = 64 * 1024 * 1024;

/** The data files of each kind, in the order an import reads them. */
export const ARCHIVE_DATA_FILES = {
  campaign: ['campaign', 'sessions', 'scenes', 'tokens', 'encounters', 'assets', 'images'],
  assets: ['assets', 'images'],
} as const satisfies Record<ArchiveKind, readonly string[]>;
export type ArchiveDataName = (typeof ARCHIVE_DATA_FILES)['campaign'][number];

/** The extension of an image's file in the archive, from its type. */
export const IMAGE_EXTENSIONS: Record<ImageMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** An entry name the layout allows: the manifest, a data file, an image, or one of their two folders. */
export const ARCHIVE_ENTRY_PATTERN =
  /^(?:manifest\.json|data\/|images\/|data\/[a-z]+\.json|images\/[0-9a-f]{64}\.(?:png|jpg|webp))$/;

const strict = { additionalProperties: false } as const;
const Count = Type.Integer({ minimum: 0 });

export const ArchiveCountsSchema = Type.Object(
  {
    campaigns: Count,
    sessions: Count,
    scenes: Count,
    tokens: Count,
    encounters: Count,
    assets: Count,
    images: Count,
  },
  strict,
);

export const ArchiveManifestSchema = Type.Object(
  {
    format_version: Type.Integer({ minimum: 1 }),
    // The Emberglass that wrote it, for a person reading the file; never acted on.
    app_version: Type.String({ maxLength: 64 }),
    // When it was written, as an ISO 8601 UTC time (`Date.prototype.toISOString`).
    exported_at: Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,3})?Z$' }),
    kind: Type.Enum(ARCHIVE_KINDS),
    counts: ArchiveCountsSchema,
    images: Type.Array(Sha256Schema, { uniqueItems: true, maxItems: MAX_ARCHIVE_ENTRIES }),
  },
  strict,
);

// An image without its variants, which are produced again on import (D-181); its grid preset travels with it.
export const ArchiveImageSchema = Type.Object(
  {
    id: Sha256Schema,
    mime: Type.Enum(IMAGE_MIME_TYPES),
    width: Type.Integer({ minimum: 1 }),
    height: Type.Integer({ minimum: 1 }),
    grid_preset: Type.Union([GridPresetSchema, Type.Null()]),
  },
  strict,
);

// An asset with its tags, as the library lists it; its notes bounded as an asset body's are.
export const ArchiveAssetSchema = Type.Object({ ...LibraryAssetSchema.properties, notes: NotesSchema }, strict);

// The highest number issued per asset on the scene (`05` §3, Q-091), keyed by asset id, which an import keeps.
export const TokenNumbersSchema = Type.Record(
  Type.String({ pattern: UUID_PATTERN }),
  Type.Integer({ minimum: 1 }),
  strict,
);

export const ArchiveSceneSchema = Type.Object(
  { ...SceneSchema.properties, notes: NotesSchema, token_numbers: TokenNumbersSchema, fog: FogMaskSchema },
  strict,
);

export const ArchiveTokenSchema = Type.Object(
  { ...TokenSchema.properties, notes: NotesSchema, shown: Type.Boolean() },
  strict,
);

const records = <T extends TSchema>(schema: T) => Type.Array(schema, { maxItems: MAX_ARCHIVE_ENTRIES });

/** Each data file's schema. */
export const ARCHIVE_DATA_SCHEMAS = {
  campaign: CampaignSchema,
  sessions: records(SessionSchema),
  scenes: records(ArchiveSceneSchema),
  tokens: records(ArchiveTokenSchema),
  encounters: records(EncounterSchema),
  assets: records(ArchiveAssetSchema),
  images: records(ArchiveImageSchema),
} as const;

export type ArchiveManifest = Static<typeof ArchiveManifestSchema>;
export type ArchiveCounts = Static<typeof ArchiveCountsSchema>;
export type ArchiveImage = Static<typeof ArchiveImageSchema>;
export type ArchiveAsset = Static<typeof ArchiveAssetSchema>;
export type ArchiveScene = Static<typeof ArchiveSceneSchema>;
export type ArchiveToken = Static<typeof ArchiveTokenSchema>;

/** The data files of an archive, parsed but not yet checked: what `migrateFormat` upgrades. */
export type ArchiveData = { manifest: Record<string, unknown> } & Partial<Record<ArchiveDataName, unknown>>;

/**
 * Upgrades an archive of format `version` to the current format, before anything is checked against the schemas
 * above. Format 1 is the current one, so it changes nothing; a later format adds its step here, so an older
 * archive still imports. Never called for a version newer than ARCHIVE_FORMAT_VERSION, which is refused.
 */
export function migrateFormat(version: number, data: ArchiveData): ArchiveData {
  if (version > ARCHIVE_FORMAT_VERSION) throw new Error(`format ${version} is newer than ${ARCHIVE_FORMAT_VERSION}`);
  return data;
}

// What an import answers once it stored everything (`08` §13): what it added and what it reused.
export const ImportSummarySchema = Type.Object(
  {
    kind: Type.Enum(ARCHIVE_KINDS),
    // The new campaign, its name with " (2)" or more appended when the name was taken; null for assets.
    campaign: Type.Union([Type.Object({ id: UuidSchema, name: Type.String({ minLength: 1 }) }, strict), Type.Null()]),
    sessions: Count,
    scenes: Count,
    tokens: Count,
    assets: Type.Object({ added: Count, reused: Count }, strict),
    images: Type.Object({ added: Count, reused: Count }, strict),
  },
  strict,
);

export const IMPORT_STAGES = ['receiving', 'reading', 'images', 'saving'] as const;
export type ImportStage = (typeof IMPORT_STAGES)[number];

// GET /api/import/progress: the import running now, if one is, and how far it got in its stage.
export const ImportProgressSchema = Type.Object(
  {
    running: Type.Boolean(),
    stage: Type.Union([Type.Enum(IMPORT_STAGES), Type.Null()]),
    done: Count,
    total: Count,
  },
  strict,
);

// GET /api/export/assets: the assets named, repeated `id`, or the whole library without one.
export const AssetExportQuerySchema = Type.Object(
  { id: Type.Optional(Type.Union([UuidSchema, Type.Array(UuidSchema, { minItems: 1, maxItems: 1000 })])) },
  strict,
);

export type ImportSummary = Static<typeof ImportSummarySchema>;
export type ImportProgress = Static<typeof ImportProgressSchema>;
export type AssetExportQuery = Static<typeof AssetExportQuerySchema>;

// Characters a Windows file name cannot hold, control characters included, and its reserved device names.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE_FILE_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const RESERVED_NAMES = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?$/i;

/** `name` as a file name every system accepts: unsafe characters replaced, trimmed, bounded, never empty. */
export function safeFileName(name: string, fallback: string): string {
  const cleaned = [...name.normalize('NFC').replace(/\s+/gu, ' ').replace(UNSAFE_FILE_CHARS, '-')]
    .slice(0, 80)
    .join('')
    .trim()
    // Windows drops trailing dots and spaces, so a name ending in them is not the name asked for.
    .replace(/[. ]+$/u, '');
  if (cleaned === '' || /^[.-]+$/u.test(cleaned)) return fallback;
  return RESERVED_NAMES.test(cleaned) ? `_${cleaned}` : cleaned;
}

/** A local calendar date, YYYY-MM-DD. */
export function calendarDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** An export's file name (`<campaign-name>-<YYYY-MM-DD>.zip`, or `library-<YYYY-MM-DD>.zip`). */
export function exportFileName(campaignName: string | null, date: Date): string {
  const base = campaignName === null ? 'library' : safeFileName(campaignName, 'campaign');
  return `${base}-${calendarDate(date)}.zip`;
}

/** The name an imported campaign takes: its own, or with " (2)", " (3)"… appended while that one is taken. */
export function freeCampaignName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}
