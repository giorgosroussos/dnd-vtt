import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type Database from 'better-sqlite3';
import type { ValidateFunction } from 'ajv';
import {
  ADDED_IN_FORMAT_2,
  ARCHIVE_DATA_FILES,
  ARCHIVE_DATA_SCHEMAS,
  ARCHIVE_FORMAT_VERSION,
  ARCHIVE_KINDS,
  ArchiveManifestSchema,
  IMAGE_EXTENSIONS,
  MAX_ARCHIVE_ENTRIES,
  MAX_DATA_FILE_BYTES,
  MAX_MANIFEST_BYTES,
  freeCampaignName,
  isCalendarDate,
  migrateFormat,
  normalizeTag,
  type ArchiveAsset,
  type ArchiveData,
  type ArchiveImage,
  type ArchiveKind,
  type ArchiveManifest,
  type ArchiveScene,
  type ArchiveToken,
  type ArchiveMapNote,
  type ArchiveDataName,
  type Campaign,
  type Encounter,
  type ImageMime,
  type ImageVariants,
  type ImportStage,
  type ImportSummary,
  type Session,
} from '@emberglass/shared';
import {
  assetExists,
  campaignNames,
  insertImportedAsset,
  insertImportedCampaign,
  insertImportedEncounter,
  insertImportedMapNote,
  insertImportedImage,
  insertImportedScene,
  insertImportedSession,
  insertImportedToken,
} from '../db/archive.js';
import { imageExists } from '../db/images.js';
import { processUpload, receive, stagedOriginal, UploadRejected } from '../images/store.js';
import { compileSchema, formatAjvErrors } from '../validation.js';
import { ImportRefused, openArchive, readAll, type Archive } from './zip.js';

// Importing an archive (DMT-05; specs/09-operations.md §9, specs/07-security-and-access.md §9,
// specs/05-assets-and-images.md §6, §7, specs/03-domain-model.md §3, Q-115, Q-119, D-181). Everything is checked
// before anything is stored, in the order that refuses soonest: the archive's central directory (zip.ts), the
// manifest's format version, the layout of its kind, every data file against its strict schema, the references
// between records and to what the server holds, then every image, received and checked as an upload is and
// matched against the sha256 it is named by. Images are staged in a folder of `.incoming` meanwhile, their
// display version and thumbnail produced there from the original, never read from the archive.
//
// Then one synchronous step stores it all: the rows in one SQLite transaction, which checks the references again
// against what the server holds at that moment, and the staged images renamed into the images folder before it
// commits; any failure removes the images moved so far and rolls the transaction back, as an upload does, so the
// database and the images folder are exactly as they were. No other request runs in between.
//
// A campaign always comes in as a new copy: every campaign, session, scene, token, encounter and encounter entry
// gets a new identifier, and every reference between them follows (§3). Assets and images keep theirs: an image the
// server holds is reused by its sha256, an asset whose identifier exists is reused as it is, never overwritten,
// and an asset the server does not hold keeps its identifier (D-181), so its tokens' references stay right.

const invalid = (detail: string, entry?: string) => new ImportRefused('import_invalid', detail, entry);
const unsafe = (detail: string, entry?: string) => new ImportRefused('import_unsafe_entry', detail, entry);
const imageRefused = (entry: string, detail: string) =>
  new ImportRefused('import_image_refused', `${entry}: ${detail}`, entry);

const MANIFEST = 'manifest.json';
const dataEntry = (name: string): string => `data/${name}.json`;
const IMAGE_ENTRY = /^images\/([0-9a-f]{64})\.([a-z]+)$/;

const isManifest = compileSchema<ArchiveManifest>(ArchiveManifestSchema);
const DATA_VALIDATORS = Object.fromEntries(
  Object.entries(ARCHIVE_DATA_SCHEMAS).map(([name, schema]) => [name, compileSchema(schema)]),
) as Record<keyof typeof ARCHIVE_DATA_SCHEMAS, ValidateFunction>;

/** An archive's records once every schema has passed. */
interface Records {
  kind: ArchiveKind;
  manifest: ArchiveManifest;
  campaign: Campaign | null;
  sessions: Session[];
  scenes: ArchiveScene[];
  tokens: ArchiveToken[];
  encounters: Encounter[];
  mapnotes: ArchiveMapNote[];
  assets: ArchiveAsset[];
  images: ArchiveImage[];
}

export interface ImportOptions {
  db: Database.Database;
  imagesDir: string;
  /** This import's own folder under `.incoming`: the images are staged in it; the caller removes it. */
  staging: string;
  /** The import limit: the archive's entries may unpack to no more. */
  limit: number;
  /** The upload limit, which every image must pass as an upload does. */
  uploadLimit: number;
  /** The display size the display versions are produced at. */
  displaySize: number;
  progress: (stage: ImportStage, done: number, total: number) => void;
}

export interface ImportOutcome {
  summary: ImportSummary;
  /** The images it stored, whose display versions were made at `displaySize`. */
  imagesAdded: string[];
}

async function readJson(archive: Archive, name: string, bytes: number, what: string): Promise<unknown> {
  const buffer = await readAll(await archive.read(name, { bytes, what }));
  try {
    return JSON.parse(buffer.toString('utf8')) as unknown;
  } catch {
    throw invalid(`${name} is not valid JSON`, name);
  }
}

function checkSchema(entry: string, validate: ValidateFunction, value: unknown): void {
  if (validate(value)) return;
  const [first] = formatAjvErrors(validate.errors);
  throw invalid(`${entry} does not match its schema: ${first?.path || '/'} ${first?.message ?? 'is invalid'}`, entry);
}

/** The manifest and data files, read, upgraded to the current format and checked against their schemas. */
async function readRecords(archive: Archive): Promise<Records> {
  if (!archive.files.has(MANIFEST)) throw invalid('the archive has no manifest.json', MANIFEST);
  const manifest = await readJson(archive, MANIFEST, MAX_MANIFEST_BYTES, 'manifest');
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw invalid('manifest.json is not an object', MANIFEST);
  }
  const fields = manifest as Record<string, unknown>;
  const version = fields.format_version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw invalid('manifest.json names no format version', MANIFEST);
  }
  // First of all, so that a newer archive is never judged by rules it was not written to.
  if (version > ARCHIVE_FORMAT_VERSION) {
    throw new ImportRefused(
      'import_newer_format',
      `the archive is format ${version}; this server reads up to format ${ARCHIVE_FORMAT_VERSION}`,
      MANIFEST,
      version,
    );
  }
  const kind = fields.kind as ArchiveKind;
  if (!ARCHIVE_KINDS.includes(kind)) throw invalid('manifest.json names no kind of archive', MANIFEST);
  // The layout of this kind: its data files, every one of them, and nothing else beside the images.
  const names: readonly string[] = ARCHIVE_DATA_FILES[kind];
  const expected = new Set(names.map(dataEntry));
  for (const name of archive.files.keys()) {
    if (name === MANIFEST || IMAGE_ENTRY.test(name)) continue;
    if (!expected.has(name)) throw unsafe(`${JSON.stringify(name)} is not part of an archive of ${kind}`, name);
  }
  const raw: ArchiveData = { manifest: fields };
  for (const name of names) {
    const entry = dataEntry(name);
    if (!archive.files.has(entry)) {
      // A file a later format added: `migrateFormat` gives an older archive its empty one (UXR-08).
      if (version < 2 && ADDED_IN_FORMAT_2.includes(name as ArchiveDataName)) continue;
      throw invalid(`the archive has no ${entry}`, entry);
    }
    raw[name as keyof ArchiveData] = (await readJson(archive, entry, MAX_DATA_FILE_BYTES, 'data file')) as never;
  }
  const data = migrateFormat(version, raw);
  checkSchema(MANIFEST, isManifest, data.manifest);
  for (const name of names)
    checkSchema(
      dataEntry(name),
      DATA_VALIDATORS[name as keyof typeof DATA_VALIDATORS],
      data[name as keyof ArchiveData],
    );
  const list = <T>(name: keyof ArchiveData): T[] => (data[name] as T[] | undefined) ?? [];
  return {
    kind,
    manifest: data.manifest as ArchiveManifest,
    campaign: kind === 'campaign' ? (data.campaign as Campaign) : null,
    sessions: list<Session>('sessions'),
    scenes: list<ArchiveScene>('scenes'),
    tokens: list<ArchiveToken>('tokens'),
    encounters: list<Encounter>('encounters'),
    mapnotes: list<ArchiveMapNote>('mapnotes'),
    assets: list<ArchiveAsset>('assets'),
    images: list<ArchiveImage>('images'),
  };
}

/** The ids of `records`, refused if one appears twice. */
function idsOf(records: readonly { id: string }[], what: string, entry: string): Set<string> {
  const ids = new Set<string>();
  for (const { id } of records) {
    if (ids.has(id)) throw invalid(`${entry} holds ${what} ${id} twice`, entry);
    ids.add(id);
  }
  return ids;
}

/** Refused unless no two of `records` share their parent and their order. */
function uniqueOrder(records: readonly { order: number }[], parentOf: (record: never) => string, entry: string): void {
  const seen = new Set<string>();
  for (const record of records) {
    const key = `${parentOf(record as never)} ${record.order}`;
    if (seen.has(key)) throw invalid(`${entry} holds two records at the same place in their order`, entry);
    seen.add(key);
  }
}

/** What the server holds, as the references are checked against it. */
interface Held {
  image: (id: string) => boolean;
  asset: (id: string) => boolean;
}

/**
 * The checks no schema can make: the manifest's counts and image list against the data, every identifier once,
 * and every reference to a record of the archive or, for an asset or an image, of the server (`held`).
 */
function checkRecords(records: Records, imageEntries: ReadonlyMap<string, string>, held: Held): void {
  const { manifest, campaign, sessions, scenes, tokens, encounters, mapnotes, assets, images } = records;
  const counts = {
    campaigns: campaign === null ? 0 : 1,
    sessions: sessions.length,
    scenes: scenes.length,
    tokens: tokens.length,
    encounters: encounters.length,
    map_notes: mapnotes.length,
    assets: assets.length,
    images: images.length,
  };
  for (const [what, count] of Object.entries(counts)) {
    if (manifest.counts[what as keyof typeof counts] !== count) {
      throw invalid(`manifest.json counts ${what} the data does not hold`, MANIFEST);
    }
  }
  const imageIds = idsOf(images, 'image', dataEntry('images'));
  const listed = new Set(manifest.images);
  const same = (a: ReadonlySet<string>, b: { size: number; has: (id: string) => boolean; keys?: unknown }) =>
    a.size === b.size && [...a].every((id) => b.has(id));
  if (!same(listed, imageIds) || !same(listed, imageEntries)) {
    throw invalid('manifest.json, data/images.json and the image files do not name the same images', MANIFEST);
  }
  const imageHeld = (id: string) => imageIds.has(id) || held.image(id);
  const assetIds = idsOf(assets, 'asset', dataEntry('assets'));
  for (const asset of assets) {
    if (asset.tags.some((tag) => tag !== normalizeTag(tag) || tag === '')) {
      throw invalid(`asset ${asset.id} carries a tag that is not normalised`, dataEntry('assets'));
    }
    if (!imageHeld(asset.image_id)) {
      throw invalid(`asset ${asset.id}'s image is neither in the archive nor on this server`, dataEntry('assets'));
    }
  }
  if (campaign === null) return;
  const sessionIds = idsOf(sessions, 'session', dataEntry('sessions'));
  for (const session of sessions) {
    if (session.campaign_id !== campaign.id) {
      throw invalid(`session ${session.id} is not of the campaign`, dataEntry('sessions'));
    }
    if (session.date !== null && !isCalendarDate(session.date)) {
      throw invalid(`session ${session.id}'s date does not exist`, dataEntry('sessions'));
    }
  }
  uniqueOrder(sessions, (session: Session) => session.campaign_id, dataEntry('sessions'));
  const sceneIds = idsOf(scenes, 'scene', dataEntry('scenes'));
  for (const scene of scenes) {
    if (!sessionIds.has(scene.session_id)) {
      throw invalid(`scene ${scene.id} is of no session of the campaign`, dataEntry('scenes'));
    }
    if (scene.map_image_id !== null && !imageHeld(scene.map_image_id)) {
      throw invalid(`scene ${scene.id}'s map is neither in the archive nor on this server`, dataEntry('scenes'));
    }
    if (scene.map_image_id === null && scene.grid.size !== null) {
      throw invalid(`scene ${scene.id} is calibrated without a map`, dataEntry('scenes'));
    }
  }
  uniqueOrder(scenes, (scene: ArchiveScene) => scene.session_id, dataEntry('scenes'));
  idsOf(tokens, 'token', dataEntry('tokens'));
  const sceneOfToken = new Map<string, string>();
  for (const token of tokens) {
    if (!sceneIds.has(token.scene_id))
      throw invalid(`token ${token.id} is on no scene of the campaign`, dataEntry('tokens'));
    if (!assetIds.has(token.asset_id) && !held.asset(token.asset_id)) {
      throw invalid(`token ${token.id}'s asset is neither in the archive nor on this server`, dataEntry('tokens'));
    }
    sceneOfToken.set(token.id, token.scene_id);
  }
  idsOf(encounters, 'encounter', dataEntry('encounters'));
  const scenesWithEncounter = new Set<string>();
  for (const encounter of encounters) {
    if (!sceneIds.has(encounter.scene_id) || scenesWithEncounter.has(encounter.scene_id)) {
      throw invalid(
        `encounter ${encounter.id} is not the one encounter of a scene of the campaign`,
        dataEntry('encounters'),
      );
    }
    scenesWithEncounter.add(encounter.scene_id);
    idsOf(encounter.entries, 'entry', dataEntry('encounters'));
    const named = new Set<string>();
    for (const entry of encounter.entries) {
      if (sceneOfToken.get(entry.token_id) !== encounter.scene_id || named.has(entry.token_id)) {
        throw invalid(
          `encounter ${encounter.id} has an entry that is not a token of its scene`,
          dataEntry('encounters'),
        );
      }
      named.add(entry.token_id);
    }
  }
  // Map notes (UXR-08): each once, each on a scene of the campaign.
  idsOf(mapnotes, 'map note', dataEntry('mapnotes'));
  for (const note of mapnotes) {
    if (!sceneIds.has(note.scene_id)) {
      throw invalid(`map note ${note.id} is not on a scene of the campaign`, dataEntry('mapnotes'));
    }
  }
}

/** The image files, by the sha256 their names give; two files of one image are refused. */
function imageEntriesOf(archive: Archive): Map<string, string> {
  const entries = new Map<string, string>();
  for (const name of archive.files.keys()) {
    const match = IMAGE_ENTRY.exec(name);
    if (!match) continue;
    if (entries.has(match[1]!)) throw unsafe(`the archive holds image ${match[1]} twice`, name);
    entries.set(match[1]!, name);
  }
  return entries;
}

interface Staged {
  dir: string;
  mime: ImageMime;
  width: number;
  height: number;
  variants: ImageVariants;
}

/**
 * Receives each image as an upload is received, checks its sha256 and its type against its name and record, and,
 * unless the server holds it already, checks it decodes and produces its versions, all in the staging folder.
 */
async function stageImages(
  archive: Archive,
  records: Records,
  imageEntries: ReadonlyMap<string, string>,
  { db, staging, uploadLimit, displaySize, progress }: ImportOptions,
): Promise<{ staged: Map<string, Staged>; reused: Set<string> }> {
  const staged = new Map<string, Staged>();
  const reused = new Set<string>();
  const total = records.images.length;
  progress('images', 0, total);
  for (const [index, record] of records.images.entries()) {
    const name = imageEntries.get(record.id)!;
    const dir = path.join(staging, 'images', record.id);
    mkdirSync(dir, { recursive: true });
    let stream: Readable | undefined;
    let received: { sha256: string; mime: ImageMime };
    try {
      stream = await archive.read(name, { bytes: uploadLimit, what: 'image' });
      received = await receive(stream, stagedOriginal(dir), uploadLimit);
    } catch (error) {
      stream?.destroy();
      if (error instanceof UploadRejected) throw imageRefused(name, error.detail);
      throw error;
    }
    if (received.sha256 !== record.id) throw imageRefused(name, 'its bytes are not the sha256 it is named by');
    if (IMAGE_EXTENSIONS[received.mime] !== IMAGE_ENTRY.exec(name)![2]) {
      throw imageRefused(name, `its content is ${received.mime}, which its name does not say`);
    }
    if (received.mime !== record.mime)
      throw invalid(`image ${record.id} is not of the type data/images.json gives`, name);
    if (imageExists(db, record.id)) {
      // The same bytes as an image the server holds, which passed every check when it came.
      reused.add(record.id);
      rmSync(dir, { recursive: true, force: true });
    } else {
      let processed: Awaited<ReturnType<typeof processUpload>>;
      try {
        processed = await processUpload(dir, received.mime, displaySize);
      } catch (error) {
        if (error instanceof UploadRejected) throw imageRefused(name, error.detail);
        throw error;
      }
      if (processed.width !== record.width || processed.height !== record.height) {
        throw invalid(`image ${record.id} is not of the size data/images.json gives`, name);
      }
      staged.set(record.id, { dir, mime: received.mime, ...processed });
    }
    progress('images', index + 1, total);
  }
  return { staged, reused };
}

/** A fresh identifier for each of an entity's, remembered so that every reference to it follows. */
function remap() {
  const ids = new Map<string, string>();
  return {
    fresh: (old: string): string => {
      const id = randomUUID();
      ids.set(old, id);
      return id;
    },
    of: (old: string): string => ids.get(old)!,
  };
}

/**
 * Stores what was checked, in one synchronous step: the rows in one transaction, checked again against what the
 * server holds now, and the staged images moved into place before it commits.
 */
function store(
  records: Records,
  imageEntries: ReadonlyMap<string, string>,
  staged: ReadonlyMap<string, Staged>,
  reused: ReadonlySet<string>,
  { db, imagesDir }: ImportOptions,
): ImportOutcome {
  const moved: string[] = [];
  try {
    return db.transaction((): ImportOutcome => {
      const imageHeld = (id: string) => imageExists(db, id) || staged.has(id);
      // Another request may have deleted an image or asset this import reuses since it was checked.
      checkRecords(records, imageEntries, {
        image: imageHeld,
        asset: (id) => assetExists(db, id),
      });
      const added = records.assets.filter((asset) => !assetExists(db, asset.id));
      const needed = new Set([
        ...added.map((asset) => asset.image_id),
        ...records.scenes.flatMap((scene) => (scene.map_image_id === null ? [] : [scene.map_image_id])),
      ]);
      const imagesAdded: string[] = [];
      for (const id of [...needed].sort()) {
        if (imageExists(db, id)) continue;
        const image = staged.get(id);
        if (!image) throw invalid(`image ${id} was removed from this server during the import; import again`);
        const record = records.images.find((each) => each.id === id)!;
        insertImportedImage(db, { id, ...image }, record.grid_preset);
        imagesAdded.push(id);
      }
      for (const asset of added) insertImportedAsset(db, asset);

      let campaign: ImportSummary['campaign'] = null;
      if (records.campaign !== null) {
        const sessions = remap();
        const scenes = remap();
        const tokens = remap();
        const created = {
          ...records.campaign,
          id: randomUUID(),
          name: freeCampaignName(records.campaign.name, campaignNames(db)),
        };
        insertImportedCampaign(db, created);
        for (const session of records.sessions) {
          insertImportedSession(db, { ...session, id: sessions.fresh(session.id), campaign_id: created.id });
        }
        for (const scene of records.scenes) {
          insertImportedScene(db, { ...scene, id: scenes.fresh(scene.id), session_id: sessions.of(scene.session_id) });
        }
        for (const token of records.tokens) {
          insertImportedToken(db, {
            ...token,
            id: tokens.fresh(token.id),
            scene_id: scenes.of(token.scene_id),
            character_id: null,
          });
        }
        for (const note of records.mapnotes) {
          insertImportedMapNote(db, { ...note, id: randomUUID(), scene_id: scenes.of(note.scene_id) });
        }
        for (const encounter of records.encounters) {
          const entries = remap();
          insertImportedEncounter(db, {
            ...encounter,
            id: randomUUID(),
            scene_id: scenes.of(encounter.scene_id),
            entries: encounter.entries.map((entry) => ({
              ...entry,
              id: entries.fresh(entry.id),
              token_id: tokens.of(entry.token_id),
            })),
          });
        }
        campaign = { id: created.id, name: created.name };
      }

      // Last, so that a failure above moved nothing; a failure here removes what moved and rolls back.
      for (const id of imagesAdded) {
        const target = path.join(imagesDir, id);
        // A folder without a row, left by a crash; nothing serves it.
        rmSync(target, { recursive: true, force: true });
        renameSync(staged.get(id)!.dir, target);
        moved.push(target);
      }
      return {
        imagesAdded,
        summary: {
          kind: records.kind,
          campaign,
          sessions: records.sessions.length,
          scenes: records.scenes.length,
          tokens: records.tokens.length,
          assets: { added: added.length, reused: records.assets.length - added.length },
          images: { added: imagesAdded.length, reused: reused.size },
        },
      };
    })();
  } catch (error) {
    for (const target of moved) rmSync(target, { recursive: true, force: true });
    if (error instanceof ImportRefused) throw error;
    if (error instanceof Error && error.name === 'SqliteError') {
      throw invalid(`the archive's data breaks a rule of the database (${error.message})`);
    }
    throw error;
  }
}

/** Imports the archive in `file`, or throws ImportRefused having stored nothing. */
export async function importArchive(file: string, options: ImportOptions): Promise<ImportOutcome> {
  options.progress('reading', 0, 0);
  const archive = await openArchive(file, options.limit, MAX_ARCHIVE_ENTRIES);
  try {
    const records = await readRecords(archive);
    const imageEntries = imageEntriesOf(archive);
    // Checked now against the server, so a missing reference refuses before any image is read, and again on storing.
    checkRecords(records, imageEntries, {
      image: (id) => imageExists(options.db, id),
      asset: (id) => assetExists(options.db, id),
    });
    const { staged, reused } = await stageImages(archive, records, imageEntries, options);
    options.progress('saving', 0, 0);
    return store(records, imageEntries, staged, reused, options);
  } finally {
    archive.close();
  }
}
