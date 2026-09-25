import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { TSchema } from 'typebox';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AssetSchema,
  AssetTagSchema,
  CampaignSchema,
  DEFAULT_FEET_PER_SQUARE,
  DEFAULT_GRID_EXTENT,
  DEFAULT_SETTINGS,
  GridSchema,
  ImageSchema,
  SceneSchema,
  SessionSchema,
  SettingsSchema,
  TokenSchema,
} from '@emberglass/shared';
import { MIGRATIONS_DIR } from '../paths.js';
import { compileSchema } from '../validation.js';
import { DATABASE_FILE, databasePath, openDatabase } from './database.js';
import { loadMigrations, migrateDataDirectory } from './migrate.js';
import {
  FIXTURE_VERSION,
  TABLES,
  countRows,
  createFixtureDatabase,
  fixtureSha256,
  fixtureUuid,
  readEntities,
  type Table,
} from './testing/fixture.js';

// SRV-01: the schema of specs/03-domain-model.md §1–§4, §6 and §8, against a real
// SQLite file in a temporary data directory (specs/10-testing-acceptance.md §2).
// Every connection comes from openDatabase, the one the server uses, so what these
// tests see enforced is what the server gets.
let root: string;
let dataDir: string;
let db: Database.Database;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'emberglass-schema-'));
  dataDir = path.join(root, 'data');
});

afterEach(() => {
  if ((db as Database.Database | undefined)?.open) db.close();
  rmSync(root, { recursive: true, force: true });
});

function migrated(): Database.Database {
  migrateDataDirectory(dataDir, MIGRATIONS_DIR);
  db = openDatabase(dataDir);
  return db;
}

const LATEST = loadMigrations(MIGRATIONS_DIR).length;

// The entity table of specs/03-domain-model.md §1: entity name, the backticked
// names in "Key fields", and the backticked names in "Notes".
function specEntities(): { entity: string; fields: string[]; notes: string[]; text: string }[] {
  const spec = readFileSync(new URL('../../../specs/03-domain-model.md', import.meta.url), 'utf8');
  const body = spec.split(/^## /m).find((part) => part.startsWith('1. '))!;
  const names = (cell: string): string[] => [...cell.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]!);
  return body
    .split('\n')
    .filter((line) => /^\| [A-Z]/.test(line) && !line.startsWith('| Entity'))
    .map((line) => {
      const [, entity, fields, notes] = line.split('|').map((cell) => cell.trim());
      return { entity: entity!, fields: names(fields!), notes: names(notes!), text: fields! };
    });
}

const TABLE_OF: Record<string, Table> = {
  Image: 'image',
  Asset: 'asset',
  AssetTag: 'asset_tag',
  Campaign: 'campaign',
  Session: 'session',
  Scene: 'scene',
  Token: 'token',
  Settings: 'settings',
};

// Settings lists four of its fields in prose; these are their columns.
const SETTINGS_PROSE: Record<string, string> = {
  'ruler rule': 'ruler_rule',
  'upload limit': 'upload_limit_bytes',
  'display variant size': 'display_variant_size',
  'PIN hash': 'pin_hash',
};

// The grid sub-fields named in the Scene row's notes (`type`, `size`, … `rows`).
const GRID_FIELDS = specEntities()
  .find((e) => e.entity === 'Scene')!
  .notes.filter((n) => n !== 'grid');

const columns = (
  table: string,
): { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }[] =>
  db.prepare(`SELECT * FROM pragma_table_info(?)`).all(table) as never;
const columnNames = (table: string): string[] => columns(table).map((c) => c.name);

describe('migration 0001 on a fresh database', () => {
  it('creates exactly the eight entities of specs/03-domain-model.md §1', () => {
    migrated();
    const tables = db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .pluck()
      .all();
    expect(specEntities().map((e) => e.entity)).toEqual(Object.keys(TABLE_OF));
    expect(tables).toEqual([...TABLES].sort());
  });

  it('stores every key field of specs/03-domain-model.md §1 and nothing else but the id', () => {
    migrated();
    for (const { entity, fields, text } of specEntities()) {
      const table = TABLE_OF[entity]!;
      const expected = new Set(['id']);
      for (const field of fields) {
        if (field === 'grid' || field === 'grid_preset') {
          for (const sub of GRID_FIELDS) expected.add(`${field}_${sub}`);
        } else {
          expected.add(field);
        }
      }
      if (entity === 'Settings') {
        for (const [phrase, column] of Object.entries(SETTINGS_PROSE)) {
          expect(text).toContain(phrase);
          expected.add(column);
        }
      }
      expect(new Set(columnNames(table)), table).toEqual(expected);
    }
  });

  // Types, nullability and defaults, reviewed against D-075: a changed type,
  // a column that becomes nullable or a changed default fails here.
  it('declares every column with the type, nullability and default of D-075', () => {
    migrated();
    const declared = (table: string): string[] =>
      columns(table).map((c) =>
        [c.name, c.type, c.notnull ? 'NOT NULL' : 'NULL', c.dflt_value === null ? '' : `DEFAULT ${c.dflt_value}`]
          .filter(Boolean)
          .join(' '),
      );
    expect(Object.fromEntries(TABLES.map((t) => [t, declared(t)]))).toEqual({
      image: [
        'id TEXT NOT NULL',
        'mime TEXT NOT NULL',
        'width INTEGER NOT NULL',
        'height INTEGER NOT NULL',
        "variants TEXT NOT NULL DEFAULT '{}'",
        'grid_preset_type TEXT NULL',
        'grid_preset_size REAL NULL',
        'grid_preset_offset_x REAL NULL',
        'grid_preset_offset_y REAL NULL',
        'grid_preset_visible INTEGER NULL',
        'grid_preset_feet_per_square REAL NULL',
        'grid_preset_columns INTEGER NULL',
        'grid_preset_rows INTEGER NULL',
      ],
      asset: [
        'id TEXT NOT NULL',
        'name TEXT NOT NULL',
        'category TEXT NOT NULL',
        'image_id TEXT NOT NULL',
        'size TEXT NOT NULL',
        'default_hidden INTEGER NOT NULL',
        "notes TEXT NOT NULL DEFAULT ''",
      ],
      asset_tag: ['id TEXT NOT NULL', 'asset_id TEXT NOT NULL', 'tag TEXT NOT NULL'],
      campaign: [
        'id TEXT NOT NULL',
        'name TEXT NOT NULL',
        "description TEXT NOT NULL DEFAULT ''",
        "rules_version TEXT NOT NULL DEFAULT '5e-2014'",
      ],
      session: [
        'id TEXT NOT NULL',
        'campaign_id TEXT NOT NULL',
        'title TEXT NOT NULL',
        'order INTEGER NOT NULL',
        'date TEXT NULL',
      ],
      scene: [
        'id TEXT NOT NULL',
        'session_id TEXT NOT NULL',
        'name TEXT NOT NULL',
        'order INTEGER NOT NULL',
        'map_image_id TEXT NULL',
        "grid_type TEXT NOT NULL DEFAULT 'square'",
        'grid_size REAL NULL',
        'grid_offset_x REAL NOT NULL DEFAULT 0',
        'grid_offset_y REAL NOT NULL DEFAULT 0',
        'grid_visible INTEGER NOT NULL DEFAULT 1',
        'grid_feet_per_square REAL NOT NULL DEFAULT 5',
        'grid_columns INTEGER NOT NULL DEFAULT 30',
        'grid_rows INTEGER NOT NULL DEFAULT 20',
        // Migration 0002 (Q-091, D-101).
        "token_numbers TEXT NOT NULL DEFAULT '{}'",
      ],
      token: [
        'id TEXT NOT NULL',
        'scene_id TEXT NOT NULL',
        'asset_id TEXT NOT NULL',
        'label TEXT NOT NULL',
        'x REAL NOT NULL',
        'y REAL NOT NULL',
        'hidden INTEGER NOT NULL',
        'z_order INTEGER NOT NULL',
        'character_id TEXT NULL',
      ],
      settings: [
        'id TEXT NOT NULL',
        'live_scene_id TEXT NULL',
        "ruler_rule TEXT NOT NULL DEFAULT 'phb'",
        'upload_limit_bytes INTEGER NOT NULL DEFAULT 52428800',
        'display_variant_size INTEGER NOT NULL DEFAULT 4096',
        'pin_hash TEXT NULL',
      ],
    });
  });

  it('keeps sessions and scenes in an order unique within their parent (specs/03-domain-model.md §2)', () => {
    migrated();
    const unique = (table: string): string[][] =>
      (db.prepare('SELECT name FROM pragma_index_list(?) WHERE "unique" = 1').pluck().all(table) as string[]).map(
        (index) => db.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno').pluck().all(index) as string[],
      );
    expect(unique('session')).toContainEqual(['campaign_id', 'order']);
    expect(unique('scene')).toContainEqual(['session_id', 'order']);
  });

  it('has exactly the relationships of specs/03-domain-model.md §2, with the deletion rules of §7', () => {
    migrated();
    const keys = TABLES.flatMap((table) =>
      (db.prepare('SELECT * FROM pragma_foreign_key_list(?)').all(table) as Record<string, string>[]).map(
        (fk) => `${table}.${fk.from} -> ${fk.table}.${fk.to} on delete ${fk.on_delete}`,
      ),
    ).sort();
    expect(keys).toEqual([
      'asset.image_id -> image.id on delete RESTRICT',
      'asset_tag.asset_id -> asset.id on delete CASCADE',
      'scene.map_image_id -> image.id on delete RESTRICT',
      'scene.session_id -> session.id on delete CASCADE',
      'session.campaign_id -> campaign.id on delete CASCADE',
      'settings.live_scene_id -> scene.id on delete SET NULL',
      'token.asset_id -> asset.id on delete RESTRICT',
      'token.scene_id -> scene.id on delete CASCADE',
    ]);
  });

  it('indexes every foreign key (specs/14-agent-playbook.md §8)', () => {
    migrated();
    for (const table of TABLES) {
      const leading = (db.prepare('SELECT name FROM pragma_index_list(?)').pluck().all(table) as string[]).map(
        (index) => db.prepare('SELECT name FROM pragma_index_info(?) WHERE seqno = 0').pluck().get(index),
      );
      for (const fk of db.prepare('SELECT "from" FROM pragma_foreign_key_list(?)').pluck().all(table)) {
        expect(leading, `${table}.${String(fk)}`).toContain(fk);
      }
    }
    // The tag filter's query path (specs/05-assets-and-images.md §1).
    expect(db.prepare("SELECT count(*) FROM pragma_index_info('asset_tag_tag')").pluck().get()).toBe(1);
  });

  it('keys every table by one text id and has no sequential key (specs/14-agent-playbook.md §8)', () => {
    migrated();
    const list = db.prepare("SELECT name, wr, strict FROM pragma_table_list WHERE schema = 'main'").all() as {
      name: string;
      wr: number;
      strict: number;
    }[];
    for (const table of TABLES) {
      expect(
        list.find((t) => t.name === table),
        table,
      ).toEqual({ name: table, wr: 1, strict: 1 });
      const pk = columns(table).filter((c) => c.pk > 0);
      expect(
        pk.map((c) => [c.name, c.type]),
        table,
      ).toEqual([['id', 'TEXT']]);
      expect(() => db.prepare(`SELECT rowid FROM ${table}`).all(), table).toThrow(/no such column: rowid/);
    }
    expect(db.prepare("SELECT count(*) FROM sqlite_schema WHERE name = 'sqlite_sequence'").pluck().get()).toBe(0);
    expect(db.prepare("SELECT count(*) FROM sqlite_schema WHERE sql LIKE '%AUTOINCREMENT%'").pluck().get()).toBe(0);
  });

  it('creates the one settings row with a version 4 UUID and the default settings', () => {
    migrated();
    const rows = db.prepare('SELECT * FROM settings').all();
    expect(rows).toEqual([
      { id: expect.any(String) as string, live_scene_id: null, pin_hash: null, ...DEFAULT_SETTINGS },
    ]);
    expect((rows[0] as { id: string }).id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(DEFAULT_SETTINGS.upload_limit_bytes).toBe(50 * 1024 * 1024);
  });

  it('a second run applies nothing and changes nothing', () => {
    migrateDataDirectory(dataDir, MIGRATIONS_DIR);
    const hash = (): string =>
      createHash('sha256')
        .update(readFileSync(databasePath(dataDir)))
        .digest('hex');
    const before = hash();

    const again = migrateDataDirectory(dataDir, MIGRATIONS_DIR);

    expect(again).toMatchObject({ from: LATEST, to: LATEST, applied: [], backup: null });
    expect(hash()).toBe(before);
    expect(readdirSync(dataDir)).toEqual([DATABASE_FILE]);
  });
});

// ---- Constraints ----

const IMAGE = fixtureSha256(1);
const CAMPAIGN = fixtureUuid(1);
const SESSION = fixtureUuid(2);
const SCENE = fixtureUuid(3);
const ASSET = fixtureUuid(4);
const TOKEN = fixtureUuid(5);

// One of each parent, so a test can insert the child it is about.
function withParents(): Database.Database {
  migrated();
  db.prepare("INSERT INTO image (id, mime, width, height) VALUES (?, 'image/png', 1000, 700)").run(IMAGE);
  db.prepare("INSERT INTO campaign (id, name) VALUES (?, 'Campaign')").run(CAMPAIGN);
  db.prepare('INSERT INTO session (id, campaign_id, title, "order") VALUES (?, ?, \'Session\', 0)').run(
    SESSION,
    CAMPAIGN,
  );
  db.prepare('INSERT INTO scene (id, session_id, name, "order", map_image_id) VALUES (?, ?, \'Scene\', 0, ?)').run(
    SCENE,
    SESSION,
    IMAGE,
  );
  db.prepare(
    "INSERT INTO asset (id, name, category, image_id, size, default_hidden) VALUES (?, 'Goblin', 'monster', ?, 'small', 1)",
  ).run(ASSET, IMAGE);
  return db;
}

const insertToken = (values: Record<string, unknown>): Database.RunResult =>
  db
    .prepare(
      'INSERT INTO token (id, scene_id, asset_id, label, x, y, hidden, z_order, character_id) ' +
        'VALUES (@id, @scene_id, @asset_id, @label, @x, @y, @hidden, @z_order, @character_id)',
    )
    .run({
      id: TOKEN,
      scene_id: SCENE,
      asset_id: ASSET,
      label: 'Goblin',
      x: 1,
      y: 1,
      hidden: 1,
      z_order: 0,
      character_id: null,
      ...values,
    });

describe('constraints refuse what the specifications forbid', () => {
  it('refuses a token without a scene or without an asset (specs/03-domain-model.md §2)', () => {
    withParents();
    expect(() => insertToken({ scene_id: null })).toThrow(/NOT NULL constraint failed: token.scene_id/);
    expect(() => insertToken({ asset_id: null })).toThrow(/NOT NULL constraint failed: token.asset_id/);
    expect(() => insertToken({ scene_id: fixtureUuid(99) })).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => insertToken({ asset_id: fixtureUuid(99) })).toThrow(/FOREIGN KEY constraint failed/);
    insertToken({});
    expect(() => db.prepare('UPDATE token SET scene_id = ?').run(fixtureUuid(99))).toThrow(/FOREIGN KEY/);
    expect(countRows(db).token).toBe(1);
  });

  it('refuses a session without a campaign, a scene without a session and an asset without an image', () => {
    withParents();
    expect(() =>
      db
        .prepare('INSERT INTO session (id, campaign_id, title, "order") VALUES (?, ?, \'S\', 1)')
        .run(fixtureUuid(10), fixtureUuid(99)),
    ).toThrow(/FOREIGN KEY/);
    expect(() =>
      db
        .prepare('INSERT INTO scene (id, session_id, name, "order") VALUES (?, ?, \'S\', 1)')
        .run(fixtureUuid(10), fixtureUuid(99)),
    ).toThrow(/FOREIGN KEY/);
    expect(() =>
      db
        .prepare(
          "INSERT INTO asset (id, name, category, image_id, size, default_hidden) VALUES (?, 'A', 'pc', ?, 'small', 0)",
        )
        .run(fixtureUuid(10), null),
    ).toThrow(/NOT NULL constraint failed: asset.image_id/);
    expect(() =>
      db
        .prepare('INSERT INTO scene (id, session_id, name, "order", map_image_id) VALUES (?, ?, \'S\', 1, ?)')
        .run(fixtureUuid(10), SESSION, fixtureSha256(99)),
    ).toThrow(/FOREIGN KEY/);
  });

  it('accepts only square grids, on scenes and on image presets (specs/03-domain-model.md §8)', () => {
    withParents();
    expect(() =>
      db
        .prepare("INSERT INTO scene (id, session_id, name, \"order\", grid_type) VALUES (?, ?, 'Hex', 1, 'hex')")
        .run(fixtureUuid(10), SESSION),
    ).toThrow(/grid_type accepts only square/);
    expect(() => db.prepare("UPDATE scene SET grid_type = 'hex'").run()).toThrow(/grid_type accepts only square/);
    expect(() => db.prepare('UPDATE scene SET grid_type = NULL').run()).toThrow(/grid_type/);
    expect(() =>
      db
        .prepare(
          "UPDATE image SET grid_preset_type = 'hex', grid_preset_size = 70, grid_preset_offset_x = 0, grid_preset_offset_y = 0, " +
            'grid_preset_visible = 1, grid_preset_feet_per_square = 5, grid_preset_columns = 30, grid_preset_rows = 20',
        )
        .run(),
    ).toThrow(/grid_preset_type accepts only square/);
    expect(db.prepare('SELECT grid_type FROM scene').pluck().all()).toEqual(['square']);
  });

  it('holds an image preset wholly absent or wholly present and calibrated', () => {
    withParents();
    expect(() => db.prepare('UPDATE image SET grid_preset_size = 70').run()).toThrow(/CHECK constraint failed/);
    const preset =
      "UPDATE image SET grid_preset_type = 'square', grid_preset_size = ?, grid_preset_offset_x = 0, grid_preset_offset_y = 0, " +
      'grid_preset_visible = 1, grid_preset_feet_per_square = 5, grid_preset_columns = 30, grid_preset_rows = 20';
    expect(() => db.prepare(preset).run(null)).toThrow(/CHECK constraint failed/);
    expect(() => db.prepare(preset).run(0)).toThrow(/CHECK constraint failed/);
    db.prepare(preset).run(70.4);
    expect(db.prepare('SELECT grid_preset_size FROM image').pluck().get()).toBe(70.4);
    for (const sub of GRID_FIELDS) {
      expect(() => db.prepare(`UPDATE image SET grid_preset_${sub} = NULL`).run(), sub).toThrow(/constraint failed/);
    }
    db.prepare(`UPDATE image SET ${GRID_FIELDS.map((sub) => `grid_preset_${sub} = NULL`).join(', ')}`).run();
  });

  it('accepts only the 5e-2014 rules version (specs/03-domain-model.md §8)', () => {
    withParents();
    expect(db.prepare('SELECT rules_version FROM campaign').pluck().get()).toBe('5e-2014');
    expect(() =>
      db.prepare("INSERT INTO campaign (id, name, rules_version) VALUES (?, 'C', '5e-2024')").run(fixtureUuid(10)),
    ).toThrow(/rules_version is 5e-2014/);
    expect(() => db.prepare("UPDATE campaign SET rules_version = 'pf2e'").run()).toThrow(/rules_version is 5e-2014/);
  });

  it('keeps character_id empty (specs/03-domain-model.md §8)', () => {
    withParents();
    expect(() => insertToken({ character_id: fixtureUuid(50) })).toThrow(/character_id stays empty/);
    expect(() => insertToken({ character_id: '' })).toThrow(/character_id stays empty/);
    insertToken({});
    expect(() => db.prepare('UPDATE token SET character_id = ?').run('pc')).toThrow(/character_id stays empty/);
    expect(db.prepare('SELECT character_id FROM token').pluck().get()).toBeNull();
  });

  it('stores a map-less scene as columns × rows, defaulting to 30 × 20 (specs/03-domain-model.md §6)', () => {
    withParents();
    const add = db.prepare('INSERT INTO scene (id, session_id, name, "order") VALUES (?, ?, ?, ?)');
    add.run(fixtureUuid(10), SESSION, 'Open ground', 1);
    db.prepare(
      'INSERT INTO scene (id, session_id, name, "order", grid_columns, grid_rows) VALUES (?, ?, ?, ?, 12, 8)',
    ).run(fixtureUuid(11), SESSION, 'Small room', 2);
    const read = db.prepare(
      'SELECT map_image_id, grid_type, grid_size, grid_offset_x, grid_offset_y, grid_visible, grid_feet_per_square, grid_columns, grid_rows FROM scene WHERE id = ?',
    );
    expect(read.get(fixtureUuid(10))).toEqual({
      map_image_id: null,
      grid_type: 'square',
      grid_size: null,
      grid_offset_x: 0,
      grid_offset_y: 0,
      grid_visible: 1,
      grid_feet_per_square: DEFAULT_FEET_PER_SQUARE,
      grid_columns: DEFAULT_GRID_EXTENT.columns,
      grid_rows: DEFAULT_GRID_EXTENT.rows,
    });
    expect(DEFAULT_GRID_EXTENT).toEqual({ columns: 30, rows: 20 });
    expect(read.get(fixtureUuid(11))).toMatchObject({ grid_columns: 12, grid_rows: 8 });
    for (const [column, value] of [
      ['grid_columns', 0],
      ['grid_rows', -1],
      ['grid_columns', 2.5],
      ['grid_feet_per_square', 0],
    ] as const) {
      expect(
        () => db.prepare(`UPDATE scene SET ${column} = ? WHERE id = ?`).run(value, fixtureUuid(10)),
        column,
      ).toThrow();
    }
  });

  it('keeps token positions in decimal grid units, exactly (specs/03-domain-model.md §4)', () => {
    withParents();
    const positions = [
      [2.25, 7.125],
      [0.1, 0.2],
      [-1.5, 1e-9],
      [3, 4],
      [12345.678901, 0.333333333333333],
    ];
    positions.forEach(([x, y], i) => insertToken({ id: fixtureUuid(20 + i), x, y }));
    const stored = positions.map((_, i) =>
      db.prepare('SELECT x, y, typeof(x) AS tx FROM token WHERE id = ?').get(fixtureUuid(20 + i)),
    );
    expect(stored).toEqual(positions.map(([x, y]) => ({ x, y, tx: 'real' })));
    // A calibration changes the scene's grid, never a token's stored position.
    db.prepare('UPDATE scene SET grid_size = 70.4, grid_offset_x = 12.5').run();
    expect(db.prepare('SELECT x, y FROM token WHERE id = ?').get(fixtureUuid(20))).toEqual({ x: 2.25, y: 7.125 });
    expect(() => insertToken({ id: fixtureUuid(30), x: '2.5px' })).toThrow(
      /cannot store TEXT value in REAL column token.x/,
    );
    expect(() => insertToken({ id: fixtureUuid(30), y: null })).toThrow(/NOT NULL constraint failed: token.y/);
  });

  it.each([
    '1',
    'not-a-uuid',
    '00000000-0000-4000-8000-00000000000G',
    '00000000-0000-4000-8000-0000000000AB',
    '{00000000-0000-4000-8000-000000000001}',
    '',
  ])('refuses %j as the id of every UUID-keyed entity (specs/03-domain-model.md §3)', (id) => {
    withParents();
    const inserts = [
      () => db.prepare("INSERT INTO campaign (id, name) VALUES (?, 'C')").run(id),
      () =>
        db.prepare('INSERT INTO session (id, campaign_id, title, "order") VALUES (?, ?, \'S\', 5)').run(id, CAMPAIGN),
      () => db.prepare('INSERT INTO scene (id, session_id, name, "order") VALUES (?, ?, \'S\', 5)').run(id, SESSION),
      () =>
        db
          .prepare(
            "INSERT INTO asset (id, name, category, image_id, size, default_hidden) VALUES (?, 'A', 'pc', ?, 'small', 0)",
          )
          .run(id, IMAGE),
      () => db.prepare("INSERT INTO asset_tag (id, asset_id, tag) VALUES (?, ?, 'cave')").run(id, ASSET),
      () => insertToken({ id }),
    ];
    for (const insert of inserts) expect(insert).toThrow(/CHECK constraint failed/);
  });

  it.each([fixtureSha256(2).toUpperCase(), fixtureSha256(2).slice(1), `${fixtureSha256(2)}0`, fixtureUuid(1)])(
    'refuses %j as an image id: an image is keyed by the lowercase sha256 of its original',
    (id) => {
      withParents();
      expect(() =>
        db.prepare("INSERT INTO image (id, mime, width, height) VALUES (?, 'image/png', 1, 1)").run(id),
      ).toThrow(/CHECK constraint failed/);
    },
  );

  it('refuses values outside the enumerations and flags of specs/05-assets-and-images.md §1–§2, §4', () => {
    withParents();
    insertToken({});
    db.prepare("INSERT INTO asset_tag (id, asset_id, tag) VALUES (?, ?, 'cave')").run(fixtureUuid(40), ASSET);
    const refused = [
      "UPDATE token SET label = ''",
      'UPDATE token SET hidden = 2',
      "UPDATE asset SET name = ''",
      "UPDATE asset_tag SET tag = ''",
      'UPDATE image SET height = 0',
      "UPDATE image SET variants = '[]'",
      "UPDATE image SET variants = 'not json'",
      "UPDATE settings SET pin_hash = ''",
      'UPDATE scene SET grid_size = 0',
      'UPDATE scene SET "order" = -1',
      'UPDATE session SET "order" = -1',
      "UPDATE session SET title = ''",
      "UPDATE scene SET name = ''",
      "UPDATE asset SET category = 'villain'",
      "UPDATE asset SET size = 'colossal'",
      "UPDATE asset SET size = 'Medium'",
      'UPDATE asset SET default_hidden = 2',
      "UPDATE image SET mime = 'image/gif'",
      'UPDATE image SET width = 0',
      "UPDATE settings SET ruler_rule = 'euclidean'",
      'UPDATE settings SET upload_limit_bytes = 0',
      'UPDATE settings SET display_variant_size = -1',
      'UPDATE scene SET grid_visible = 2',
      "UPDATE campaign SET name = ''",
    ];
    for (const sql of refused) expect(() => db.prepare(sql).run(), sql).toThrow(/constraint failed/);
  });

  it('refuses an infinite number in every REAL column, which JSON cannot carry', () => {
    withParents();
    insertToken({});
    db.prepare(
      "UPDATE image SET grid_preset_type = 'square', grid_preset_size = 70, grid_preset_offset_x = 0, grid_preset_offset_y = 0, " +
        'grid_preset_visible = 1, grid_preset_feet_per_square = 5, grid_preset_columns = 30, grid_preset_rows = 20',
    ).run();
    const real = TABLES.flatMap((table) =>
      columns(table)
        .filter((c) => c.type === 'REAL')
        .map((c) => [table, c.name] as const),
    );
    expect(real.length).toBe(10);
    for (const [table, column] of real) {
      for (const value of [Infinity, -Infinity]) {
        expect(() => db.prepare(`UPDATE ${table} SET ${column} = ?`).run(value), `${table}.${column}`).toThrow(
          /CHECK constraint failed/,
        );
      }
    }
    expect(() => db.prepare('UPDATE token SET x = 9e999').run()).toThrow(/CHECK constraint failed/);
  });

  it('refuses a square size on a scene without a map (specs/06-grid-and-measurement.md §1)', () => {
    withParents();
    db.prepare('INSERT INTO scene (id, session_id, name, "order") VALUES (?, ?, \'Open\', 1)').run(
      fixtureUuid(10),
      SESSION,
    );
    expect(() => db.prepare('UPDATE scene SET grid_size = 70 WHERE id = ?').run(fixtureUuid(10))).toThrow(
      /CHECK constraint failed/,
    );
    db.prepare('UPDATE scene SET grid_size = 70.4 WHERE id = ?').run(SCENE);
    expect(() => db.prepare('UPDATE scene SET map_image_id = NULL WHERE id = ?').run(SCENE)).toThrow(
      /CHECK constraint failed/,
    );
    db.prepare('UPDATE scene SET map_image_id = NULL, grid_size = NULL WHERE id = ?').run(SCENE);
  });

  it('keeps the token numbers a scene issued as a JSON object, starting empty (Q-091)', () => {
    withParents();
    expect(db.prepare('SELECT token_numbers FROM scene WHERE id = ?').pluck().get(SCENE)).toBe('{}');
    for (const value of ['', 'not json', '[1]', '3', 'null', '"x"']) {
      expect(() => db.prepare('UPDATE scene SET token_numbers = ? WHERE id = ?').run(value, SCENE), value).toThrow(
        /CHECK constraint failed/,
      );
    }
    expect(() => db.prepare('UPDATE scene SET token_numbers = NULL WHERE id = ?').run(SCENE)).toThrow(/NOT NULL/);
    db.prepare('UPDATE scene SET token_numbers = ? WHERE id = ?').run(`{"${ASSET}":4}`, SCENE);
  });

  it('refuses an image inserted with a non-square preset', () => {
    migrated();
    expect(() =>
      db
        .prepare(
          `INSERT INTO image (id, mime, width, height, grid_preset_type, grid_preset_size, grid_preset_offset_x,
             grid_preset_offset_y, grid_preset_visible, grid_preset_feet_per_square, grid_preset_columns, grid_preset_rows)
           VALUES (?, 'image/png', 100, 100, 'hex', 10, 0, 0, 1, 5, 10, 10)`,
        )
        .run(IMAGE),
    ).toThrow(/grid_preset_type accepts only square/);
  });

  it('refuses the same tag twice on one asset', () => {
    withParents();
    const tag = db.prepare("INSERT INTO asset_tag (id, asset_id, tag) VALUES (?, ?, 'cave')");
    tag.run(fixtureUuid(40), ASSET);
    expect(() => tag.run(fixtureUuid(41), ASSET)).toThrow(
      /UNIQUE constraint failed: asset_tag.asset_id, asset_tag.tag/,
    );
  });

  it('refuses a session date that is not a calendar date', () => {
    withParents();
    const setDate = db.prepare('UPDATE session SET date = ?');
    for (const bad of ['2026-02-30', '2026-9-24', '24/09/2026', '2026-09-24 10:00', 'soon']) {
      expect(() => setDate.run(bad), bad).toThrow(/CHECK constraint failed/);
    }
    setDate.run('2026-09-24');
    setDate.run(null);
  });

  it('refuses a second session or scene at the same order within one parent', () => {
    withParents();
    expect(() =>
      db
        .prepare('INSERT INTO session (id, campaign_id, title, "order") VALUES (?, ?, \'S\', 0)')
        .run(fixtureUuid(10), CAMPAIGN),
    ).toThrow(/UNIQUE constraint failed: session.campaign_id, session.order/);
    expect(() =>
      db
        .prepare('INSERT INTO scene (id, session_id, name, "order") VALUES (?, ?, \'S\', 0)')
        .run(fixtureUuid(10), SESSION),
    ).toThrow(/UNIQUE constraint failed: scene.session_id, scene.order/);
  });

  it('holds exactly one settings row', () => {
    migrated();
    expect(() => db.prepare('INSERT INTO settings (id) VALUES (?)').run(fixtureUuid(10))).toThrow(/exactly one row/);
    expect(() => db.prepare('DELETE FROM settings').run()).toThrow(/exactly one row/);
    expect(() => db.prepare('UPDATE settings SET id = ?').run(fixtureUuid(10))).toThrow(/settings.id never changes/);
    expect(() => db.prepare('INSERT OR REPLACE INTO settings (id) SELECT id FROM settings').run()).toThrow(
      /exactly one row/,
    );
    expect(countRows(db).settings).toBe(1);
  });
});

describe('deletion rules the schema enforces (specs/03-domain-model.md §7)', () => {
  it('deleting a session deletes its scenes and their tokens; deleting a campaign its sessions too', () => {
    createFixtureDatabase(dataDir);
    db = openDatabase(dataDir);
    const session = db.prepare('SELECT id FROM session ORDER BY id LIMIT 1').pluck().get() as string;
    const scenes = db.prepare('SELECT id FROM scene WHERE session_id = ?').pluck().all(session) as string[];
    const before = countRows(db);
    const tokensOf = (ids: string[]): number =>
      ids.reduce(
        (n, id) => n + (db.prepare('SELECT count(*) FROM token WHERE scene_id = ?').pluck().get(id) as number),
        0,
      );
    const tokens = tokensOf(scenes);
    expect(tokens).toBeGreaterThan(0);

    db.prepare('UPDATE settings SET live_scene_id = NULL').run();
    db.prepare('DELETE FROM session WHERE id = ?').run(session);

    expect(countRows(db)).toMatchObject({
      session: before.session - 1,
      scene: before.scene - scenes.length,
      token: before.token - tokens,
    });
    expect(countRows(db)).toMatchObject({ asset: before.asset, image: before.image });

    db.prepare('DELETE FROM campaign').run();
    expect(countRows(db)).toMatchObject({
      campaign: 0,
      session: 0,
      scene: 0,
      token: 0,
      asset: before.asset,
      settings: 1,
    });
  });

  it('deleting the live scene, or an ancestor of it, clears the live scene', () => {
    createFixtureDatabase(dataDir);
    db = openDatabase(dataDir);
    const live = db.prepare('SELECT live_scene_id FROM settings').pluck().get() as string;
    expect(live).not.toBeNull();
    const campaign = db
      .prepare('SELECT campaign_id FROM session JOIN scene ON scene.session_id = session.id WHERE scene.id = ?')
      .pluck()
      .get(live) as string;

    db.prepare('DELETE FROM campaign WHERE id = ?').run(campaign);

    expect(db.prepare('SELECT live_scene_id FROM settings').pluck().get()).toBeNull();
    expect(db.prepare('SELECT count(*) FROM scene WHERE id = ?').pluck().get(live)).toBe(0);
  });

  it('refuses to delete an asset used by a token, or an image used by an asset or a scene', () => {
    withParents();
    insertToken({});
    expect(() => db.prepare('DELETE FROM asset WHERE id = ?').run(ASSET)).toThrow(/FOREIGN KEY constraint failed/);
    db.prepare('DELETE FROM token').run();
    db.prepare("INSERT INTO asset_tag (id, asset_id, tag) VALUES (?, ?, 'cave')").run(fixtureUuid(40), ASSET);
    expect(() => db.prepare('DELETE FROM image').run()).toThrow(/FOREIGN KEY constraint failed/);
    db.prepare('DELETE FROM asset WHERE id = ?').run(ASSET);
    expect(countRows(db).asset_tag).toBe(0);
    expect(() => db.prepare('DELETE FROM image').run()).toThrow(/FOREIGN KEY constraint failed/);
    db.prepare('DELETE FROM scene').run();
    db.prepare('DELETE FROM image').run();
    expect(countRows(db).image).toBe(0);
  });
});

// ---- The contract in shared ----

// A contract schema's property names, with the nested grid spelt as its columns.
function contractColumns(schema: TSchema & { properties: Record<string, unknown> }): string[] {
  return Object.keys(schema.properties).flatMap((key) =>
    key === 'grid' || key === 'grid_preset' ? Object.keys(GridSchema.properties).map((sub) => `${key}_${sub}`) : [key],
  );
}

const CONTRACT: Record<Table, TSchema & { properties: Record<string, unknown> }> = {
  image: ImageSchema,
  asset: AssetSchema,
  asset_tag: AssetTagSchema,
  campaign: CampaignSchema,
  session: SessionSchema,
  scene: SceneSchema,
  token: TokenSchema,
  settings: SettingsSchema,
};

describe('the contract types in shared', () => {
  // The token numbers a scene has issued are the server's own too (Q-091, D-101).
  it('name exactly the stored columns, except the PIN hash and the token numbers, which never leave the server', () => {
    migrated();
    const internal = (table: string, column: string) =>
      (table === 'settings' && column === 'pin_hash') || (table === 'scene' && column === 'token_numbers');
    for (const table of TABLES) {
      const stored = columnNames(table).filter((c) => !internal(table, c));
      expect(contractColumns(CONTRACT[table]).sort(), table).toEqual(stored.sort());
    }
    expect(Object.keys(GridSchema.properties)).toEqual(GRID_FIELDS);
    expect(Object.keys(SettingsSchema.properties)).not.toContain('pin_hash');
    expect(Object.keys(SceneSchema.properties)).not.toContain('token_numbers');
  });

  it('describe every row of the generated fixture database', () => {
    createFixtureDatabase(dataDir);
    db = openDatabase(dataDir);
    const entities = readEntities(db);
    for (const table of TABLES) {
      const validate = compileSchema(CONTRACT[table]);
      expect(entities[table].length, table).toBeGreaterThan(0);
      for (const row of entities[table]) {
        expect(validate(row), `${table} ${JSON.stringify(row)} ${JSON.stringify(validate.errors)}`).toBe(true);
      }
    }
  });
});

describe('migrations on the generated fixture database (specs/14-agent-playbook.md §8)', () => {
  it('fills every table with generated rows at the fixture version', () => {
    const counts = createFixtureDatabase(dataDir);
    for (const table of TABLES) expect(counts[table], table).toBeGreaterThan(0);
    db = openDatabase(dataDir);
    expect(db.pragma('user_version', { simple: true })).toBe(FIXTURE_VERSION);
    const entities = readEntities(db);
    expect(entities.scene.some((s) => s.map_image_id === null)).toBe(true);
    expect(entities.token.some((t) => t.hidden) && entities.token.some((t) => !t.hidden)).toBe(true);
    expect(entities.token.some((t) => !Number.isInteger(t.x))).toBe(true);
  });

  it('a second run on the fixture database changes nothing', () => {
    createFixtureDatabase(dataDir);
    migrateDataDirectory(dataDir, MIGRATIONS_DIR);
    const hash = (): string =>
      createHash('sha256')
        .update(readFileSync(databasePath(dataDir)))
        .digest('hex');
    const before = hash();
    expect(migrateDataDirectory(dataDir, MIGRATIONS_DIR).applied).toEqual([]);
    expect(hash()).toBe(before);
  });

  // While the repository has one migration the test below applies nothing; this
  // one proves the path a later migration takes, with an additive probe migration.
  it('migrates the fixture forward through a later migration, after a backup, keeping every row', () => {
    const migrations = path.join(root, 'migrations');
    mkdirSync(migrations);
    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))) {
      copyFileSync(path.join(MIGRATIONS_DIR, file), path.join(migrations, file));
    }
    const next = String(LATEST + 1).padStart(4, '0');
    writeFileSync(
      path.join(migrations, `${next}_probe.sql`),
      "ALTER TABLE campaign ADD COLUMN probe TEXT NOT NULL DEFAULT '';",
    );
    const counts = createFixtureDatabase(dataDir, migrations);

    const result = migrateDataDirectory(dataDir, migrations);

    expect(result.applied).toEqual(
      loadMigrations(migrations)
        .filter((m) => m.version > FIXTURE_VERSION)
        .map((m) => m.name),
    );
    expect(result.applied.length).toBeGreaterThan(0);
    expect(result.backup).not.toBeNull();
    db = openDatabase(dataDir);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(countRows(db)).toEqual(counts);
    expect(db.prepare('SELECT DISTINCT probe FROM campaign').pluck().all()).toEqual(['']);
  });

  it('migrates the fixture to the latest version, keeping every row and every reference', () => {
    const counts = createFixtureDatabase(dataDir);
    db = openDatabase(dataDir);
    const before = readEntities(db);
    db.close();

    const result = migrateDataDirectory(dataDir, MIGRATIONS_DIR);

    expect(result).toMatchObject({ from: FIXTURE_VERSION, to: LATEST });
    // A pending migration on existing data is preceded by a dated backup.
    expect(result.backup !== null).toBe(result.applied.length > 0);
    db = openDatabase(dataDir);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(countRows(db)).toEqual(counts);
    // The latest schema reads the same records; a migration that reshapes one
    // updates readEntities and says so here. Migration 0002 adds the token numbers a
    // scene has issued, none recorded yet, which readEntities leaves out (Q-091).
    expect(readEntities(db)).toEqual(before);
    expect(db.prepare('SELECT DISTINCT token_numbers FROM scene').pluck().all()).toEqual(['{}']);
  });
});
