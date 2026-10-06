import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  ArchiveAsset,
  ArchiveImage,
  ArchiveScene,
  ArchiveToken,
  Campaign,
  Encounter,
  ImageVariants,
  ImageMime,
  Session,
} from '@emberglass/shared';
import { readAsset } from './assets.js';
import { listSessions, readCampaign, readScene } from './campaigns.js';
import { readEncounter } from './encounters.js';
import { readImage, updateGridPreset } from './images.js';
import { markersOf } from './tokens.js';

// Export and import in SQLite (DMT-05; specs/09-operations.md §9, specs/03-domain-model.md §1, §3, Q-115, D-181).
// An export reads everything it writes in one transaction, so the archive is one consistent moment of the data
// even while the DM keeps playing. An import's writes are the functions below, which the caller runs inside one
// transaction: every row with the identifiers the caller chose, the stored fields no client receives (a scene's
// token numbers and fog, a token's `shown`) included. Every read and write names its columns.

const SCENE_COLUMNS = 'token_numbers, fog';
const TOKEN_COLUMNS = `id, scene_id, asset_id, label, x, y, hidden, z_order, markers, character_id, hp_current,
  hp_max, hp_temp, ac, notes, shown`;

interface TokenRow {
  id: string;
  scene_id: string;
  asset_id: string;
  label: string;
  x: number;
  y: number;
  hidden: 0 | 1;
  z_order: number;
  markers: string;
  character_id: null;
  hp_current: number | null;
  hp_max: number | null;
  hp_temp: number | null;
  ac: number | null;
  notes: string;
  shown: 0 | 1;
}

const toArchiveToken = (row: TokenRow): ArchiveToken => ({
  id: row.id,
  scene_id: row.scene_id,
  asset_id: row.asset_id,
  label: row.label,
  x: row.x,
  y: row.y,
  hidden: row.hidden === 1,
  z_order: row.z_order,
  markers: markersOf(JSON.parse(row.markers) as unknown[]),
  character_id: row.character_id,
  hp_current: row.hp_current,
  hp_max: row.hp_max,
  hp_temp: row.hp_temp,
  ac: row.ac,
  notes: row.notes,
  shown: row.shown === 1,
});

/** An image as an archive holds it: no variants, which are produced again on import (D-181). */
function archiveImage(db: Database.Database, id: string): ArchiveImage {
  const { mime, width, height, grid_preset } = readImage(db, id)!;
  return { id, mime, width, height, grid_preset };
}

const archiveAssets = (db: Database.Database, ids: Iterable<string>): ArchiveAsset[] =>
  [...new Set(ids)].map((id) => readAsset(db, id)!).sort((a, b) => a.id.localeCompare(b.id));

export interface CampaignExport {
  campaign: Campaign;
  sessions: Session[];
  scenes: ArchiveScene[];
  tokens: ArchiveToken[];
  encounters: Encounter[];
  assets: ArchiveAsset[];
  images: ArchiveImage[];
}

/**
 * The campaign with everything in it, and the assets its tokens use and the images of those assets and of its maps
 * (specs/09-operations.md §9), read in one transaction; undefined when the campaign does not exist.
 */
export function readCampaignExport(db: Database.Database, id: string): CampaignExport | undefined {
  return db.transaction((): CampaignExport | undefined => {
    const campaign = readCampaign(db, id);
    if (campaign === undefined) return undefined;
    const sessions = listSessions(db, id);
    const sceneIds = sessions.flatMap(
      (session) =>
        db.prepare('SELECT id FROM scene WHERE session_id = ? ORDER BY "order"').pluck().all(session.id) as string[],
    );
    const scenes = sceneIds.map((sceneId): ArchiveScene => {
      const stored = db.prepare(`SELECT ${SCENE_COLUMNS} FROM scene WHERE id = ?`).get(sceneId) as {
        token_numbers: string;
        fog: string;
      };
      return {
        ...readScene(db, sceneId)!,
        token_numbers: JSON.parse(stored.token_numbers) as Record<string, number>,
        fog: JSON.parse(stored.fog) as ArchiveScene['fog'],
      };
    });
    const tokens = sceneIds.flatMap((sceneId) =>
      (
        db
          .prepare(`SELECT ${TOKEN_COLUMNS} FROM token WHERE scene_id = ? ORDER BY z_order, id`)
          .all(sceneId) as TokenRow[]
      ).map(toArchiveToken),
    );
    const encounters = sceneIds.flatMap((sceneId) => readEncounter(db, sceneId) ?? []);
    const assets = archiveAssets(
      db,
      tokens.map((token) => token.asset_id),
    );
    const imageIds = new Set([
      ...assets.map((asset) => asset.image_id),
      ...scenes.flatMap((scene) => (scene.map_image_id === null ? [] : [scene.map_image_id])),
    ]);
    const images = [...imageIds].sort().map((imageId) => archiveImage(db, imageId));
    return { campaign, sessions, scenes, tokens, encounters, assets, images };
  })();
}

export type AssetsExport = { assets: ArchiveAsset[]; images: ArchiveImage[] };

/**
 * The assets named, or the whole library with none, with their tags and images, read in one transaction; the ids
 * that do not exist when any is missing.
 */
export function readAssetsExport(
  db: Database.Database,
  ids: readonly string[] | undefined,
): AssetsExport | { missing: string[] } {
  return db.transaction((): AssetsExport | { missing: string[] } => {
    const wanted = ids ?? (db.prepare('SELECT id FROM asset').pluck().all() as string[]);
    const missing = wanted.filter((id) => readAsset(db, id) === undefined);
    if (missing.length > 0) return { missing };
    const assets = archiveAssets(db, wanted);
    const images = [...new Set(assets.map((asset) => asset.image_id))].sort().map((id) => archiveImage(db, id));
    return { assets, images };
  })();
}

// Writes of an import, each inside the caller's transaction.

export const assetExists = (db: Database.Database, id: string): boolean =>
  db.prepare('SELECT count(*) FROM asset WHERE id = ?').pluck().get(id) === 1;

export const campaignNames = (db: Database.Database): Set<string> =>
  new Set(db.prepare('SELECT name FROM campaign').pluck().all() as string[]);

/** An imported image: its row, with the variants the import produced and the archive's grid preset. */
export function insertImportedImage(
  db: Database.Database,
  image: { id: string; mime: ImageMime; width: number; height: number; variants: ImageVariants },
  preset: ArchiveImage['grid_preset'],
): void {
  db.prepare('INSERT INTO image (id, mime, width, height, variants) VALUES (?, ?, ?, ?, ?)').run(
    image.id,
    image.mime,
    image.width,
    image.height,
    JSON.stringify(image.variants),
  );
  if (preset !== null) updateGridPreset(db, image.id, preset);
}

/** An imported asset the server did not hold, under its own identifier (D-181), with its tags. */
export function insertImportedAsset(db: Database.Database, asset: ArchiveAsset): void {
  db.prepare(
    `INSERT INTO asset (id, name, category, image_id, size, default_hidden, notes, hp_max, ac)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    asset.id,
    asset.name,
    asset.category,
    asset.image_id,
    asset.size,
    asset.default_hidden ? 1 : 0,
    asset.notes,
    asset.hp_max,
    asset.ac,
  );
  const tag = db.prepare('INSERT INTO asset_tag (id, asset_id, tag) VALUES (?, ?, ?)');
  for (const name of asset.tags) tag.run(randomUUID(), asset.id, name);
}

export function insertImportedCampaign(db: Database.Database, campaign: Campaign): void {
  db.prepare('INSERT INTO campaign (id, name, description, rules_version) VALUES (?, ?, ?, ?)').run(
    campaign.id,
    campaign.name,
    campaign.description,
    campaign.rules_version,
  );
}

export function insertImportedSession(db: Database.Database, session: Session): void {
  db.prepare('INSERT INTO session (id, campaign_id, title, "order", date) VALUES (?, ?, ?, ?, ?)').run(
    session.id,
    session.campaign_id,
    session.title,
    session.order,
    session.date,
  );
}

export function insertImportedScene(db: Database.Database, scene: ArchiveScene): void {
  const { grid } = scene;
  db.prepare(
    `INSERT INTO scene (id, session_id, name, "order", map_image_id, grid_type, grid_size, grid_offset_x, grid_offset_y,
       grid_visible, grid_feet_per_square, grid_columns, grid_rows, token_numbers, fog, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    scene.id,
    scene.session_id,
    scene.name,
    scene.order,
    scene.map_image_id,
    grid.type,
    grid.size,
    grid.offset_x,
    grid.offset_y,
    grid.visible ? 1 : 0,
    grid.feet_per_square,
    grid.columns,
    grid.rows,
    JSON.stringify(scene.token_numbers),
    JSON.stringify(scene.fog),
    scene.notes,
  );
}

export function insertImportedToken(db: Database.Database, token: ArchiveToken): void {
  db.prepare(`INSERT INTO token (${TOKEN_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    token.id,
    token.scene_id,
    token.asset_id,
    token.label,
    token.x,
    token.y,
    token.hidden ? 1 : 0,
    token.z_order,
    JSON.stringify(token.markers),
    token.character_id,
    token.hp_current,
    token.hp_max,
    token.hp_temp,
    token.ac,
    token.notes,
    token.shown ? 1 : 0,
  );
}

export function insertImportedEncounter(db: Database.Database, encounter: Encounter): void {
  db.prepare(
    `INSERT INTO encounter (id, scene_id, active, round, current_index, enemies_seen, entries)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    encounter.id,
    encounter.scene_id,
    encounter.active ? 1 : 0,
    encounter.round,
    encounter.current_index,
    encounter.enemies_seen ? 1 : 0,
    JSON.stringify(encounter.entries),
  );
}
