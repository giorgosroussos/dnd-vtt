import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Asset, AssetTag, Campaign, Image, Scene, Session, Settings, Token } from '@emberglass/shared';
import { MIGRATIONS_DIR } from '../../paths.js';
import { openDatabase } from '../database.js';
import { migrateDataDirectory } from '../migrate.js';

// The generated fixture database that every migration is tested on
// (specs/14-agent-playbook.md §8, D-075). Everything in it is made up here; no
// real campaign data enters the repository or CI. The rows are written against
// schema version FIXTURE_VERSION and never edited afterwards: a later migration
// is tested by migrating this database from that version, so the rows keep
// exercising the path a DM's existing data takes.
export const FIXTURE_VERSION = 1;

// Deterministic version 4 UUIDs and sha256 identifiers, so a failure names the same rows every run.
export const fixtureUuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const fixtureSha256 = (n: number): string => createHash('sha256').update(`fixture image ${n}`).digest('hex');

export const TABLES = ['image', 'asset', 'asset_tag', 'campaign', 'session', 'scene', 'token', 'settings'] as const;
export type Table = (typeof TABLES)[number];

export function countRows(db: Database.Database): Record<Table, number> {
  return Object.fromEntries(
    TABLES.map((table) => [table, db.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number]),
  ) as Record<Table, number>;
}

/** Migrate an empty data directory to FIXTURE_VERSION and fill every table. */
export function createFixtureDatabase(dataDir: string, migrationsDir: string = MIGRATIONS_DIR): Record<Table, number> {
  migrateDataDirectory(dataDir, migrationsDir, new Date(), FIXTURE_VERSION);
  const db = openDatabase(dataDir);
  try {
    db.transaction(() => seed(db))();
    return countRows(db);
  } finally {
    db.close();
  }
}

function seed(db: Database.Database): void {
  let next = 1;
  const uuid = (): string => fixtureUuid(next++);

  const insertImage = db.prepare(
    `INSERT INTO image (id, mime, width, height, variants, grid_preset_type, grid_preset_size,
       grid_preset_offset_x, grid_preset_offset_y, grid_preset_visible, grid_preset_feet_per_square,
       grid_preset_columns, grid_preset_rows)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const images = [fixtureSha256(1), fixtureSha256(2), fixtureSha256(3)];
  // A calibrated battlemap with a preset, a drawn-grid map hidden for players, and a token image.
  insertImage.run(
    images[0],
    'image/png',
    10000,
    7000,
    JSON.stringify({ display: { width: 4096, height: 2867 }, thumbnail: { width: 256, height: 179 } }),
    'square',
    70.4,
    12.5,
    -3.25,
    1,
    5,
    142,
    99,
  );
  insertImage.run(images[1], 'image/jpeg', 3000, 2000, '{}', 'square', 100, 0, 0, 0, 10, 30, 20);
  insertImage.run(images[2], 'image/webp', 512, 512, '{}', null, null, null, null, null, null, null, null);

  const insertAsset = db.prepare(
    'INSERT INTO asset (id, name, category, image_id, size, default_hidden, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const insertTag = db.prepare('INSERT INTO asset_tag (id, asset_id, tag) VALUES (?, ?, ?)');
  const assetSpecs = [
    ['Hero', 'pc', 'medium', 0, ['party']],
    ['Scout', 'pc', 'small', 0, ['party', 'ranged']],
    ['Innkeeper', 'npc', 'medium', 0, ['town']],
    ['Goblin', 'monster', 'small', 1, ['goblinoid', 'cave']],
    ['Ogre', 'monster', 'large', 1, ['giant']],
    ['Dragon', 'monster', 'gargantuan', 1, ['dragon', 'boss']],
    ['Rat', 'monster', 'tiny', 1, []],
    ['Chest', 'object', 'medium', 0, ['loot']],
  ] as const;
  const assets = assetSpecs.map(([name, category, size, hidden, tags]) => {
    const id = uuid();
    insertAsset.run(id, name, category, images[2], size, hidden, `Notes for ${name}: never shown to players.`);
    for (const tag of tags) insertTag.run(uuid(), id, tag);
    return { id, name, hidden };
  });

  const insertCampaign = db.prepare('INSERT INTO campaign (id, name, description) VALUES (?, ?, ?)');
  const insertSession = db.prepare(
    'INSERT INTO session (id, campaign_id, title, "order", date) VALUES (?, ?, ?, ?, ?)',
  );
  const insertMapScene = db.prepare(
    `INSERT INTO scene (id, session_id, name, "order", map_image_id, grid_size, grid_offset_x, grid_offset_y,
       grid_visible, grid_feet_per_square, grid_columns, grid_rows)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertMaplessScene = db.prepare('INSERT INTO scene (id, session_id, name, "order") VALUES (?, ?, ?, ?)');
  const insertToken = db.prepare(
    'INSERT INTO token (id, scene_id, asset_id, label, x, y, hidden, z_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );

  let liveScene: string | null = null;
  for (let c = 0; c < 2; c++) {
    const campaign = uuid();
    insertCampaign.run(campaign, `Campaign ${c + 1}`, c === 0 ? 'A generated campaign.' : '');
    for (let s = 0; s < 2; s++) {
      const session = uuid();
      insertSession.run(session, campaign, `Session ${s + 1}`, s, s === 0 ? `2026-10-0${c + 1}` : null);
      // One scene from a map, with its image's preset, and one without a map.
      const mapScene = uuid();
      const map = images[(c + s) % 2]!;
      insertMapScene.run(mapScene, session, 'Battlemap', 0, map, 70.4, 12.5, -3.25, 1, 5, 142, 99);
      const mapless = uuid();
      insertMaplessScene.run(mapless, session, 'Open ground', 1);
      liveScene ??= mapScene;
      // Tokens at decimal positions, some hidden, numbered as D-019 numbers them.
      [mapScene, mapless].forEach((scene, k) => {
        for (let t = 0; t < 3; t++) {
          const asset = assets[(c * 4 + s * 2 + k + t * 3) % assets.length]!;
          insertToken.run(
            uuid(),
            scene,
            asset.id,
            `${asset.name} ${t + 1}`,
            2.5 + t * 1.25,
            7.125 - t,
            asset.hidden,
            t,
          );
        }
      });
    }
  }
  db.prepare('UPDATE settings SET live_scene_id = ?, ruler_rule = ?').run(liveScene, 'dmg');
}

// ---- Rows as the contract types of shared (D-075). ----

type Row = Record<string, unknown>;

function grid(row: Row, prefix: string) {
  return {
    type: row[`${prefix}type`],
    size: row[`${prefix}size`],
    offset_x: row[`${prefix}offset_x`],
    offset_y: row[`${prefix}offset_y`],
    visible: row[`${prefix}visible`] === 1,
    feet_per_square: row[`${prefix}feet_per_square`],
    columns: row[`${prefix}columns`],
    rows: row[`${prefix}rows`],
  };
}

export interface Entities {
  image: Image[];
  asset: Asset[];
  asset_tag: AssetTag[];
  campaign: Campaign[];
  session: Session[];
  scene: Scene[];
  token: Token[];
  settings: Settings[];
}

/** Every stored row, shaped as the contract of shared says the server reads it. */
export function readEntities(db: Database.Database): Entities {
  const all = (table: string): Row[] => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all() as Row[];
  const without = (row: Row, prefix: string): Row =>
    Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith(prefix)));
  return {
    image: all('image').map((row) => ({
      ...without(row, 'grid_preset_'),
      variants: JSON.parse(row.variants as string) as unknown,
      grid_preset: row.grid_preset_type === null ? null : grid(row, 'grid_preset_'),
    })) as Image[],
    asset: all('asset').map((row) => ({ ...row, default_hidden: row.default_hidden === 1 })) as Asset[],
    asset_tag: all('asset_tag') as AssetTag[],
    campaign: all('campaign') as Campaign[],
    session: all('session') as Session[],
    scene: all('scene').map((row) => ({ ...without(row, 'grid_'), grid: grid(row, 'grid_') })) as Scene[],
    token: all('token').map((row) => ({ ...row, hidden: row.hidden === 1 })) as Token[],
    settings: all('settings').map((row) => without(row, 'pin_hash')) as Settings[],
  };
}
