import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../paths.js';
import { DATABASE_FILE } from './database.js';
import { backupFileName, loadMigrations, migrateDataDirectory } from './migrate.js';

// Integration tests: a real SQLite file in a temporary data directory, never a
// mock (specs/10-testing-acceptance.md §2).
let root: string;
let dataDir: string;
let migrationsDir: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'emberglass-migrate-'));
  dataDir = path.join(root, 'data');
  migrationsDir = path.join(root, 'migrations');
  mkdirSync(migrationsDir);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function addMigration(file: string, sql: string): void {
  writeFileSync(path.join(migrationsDir, file), sql);
}

// A separate connection to the file on disk, so assertions see only what was committed.
function inspect<T>(read: (db: Database.Database) => T): T {
  const db = new Database(path.join(dataDir, DATABASE_FILE), { readonly: true, fileMustExist: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
}

const tables = (db: Database.Database): string[] =>
  (db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(
    (row) => row.name,
  );

const backups = (): string[] => readdirSync(dataDir).filter((f) => f.startsWith('emberglass-backup-'));

describe('migrateDataDirectory against a real SQLite file', () => {
  it('creates the data directory and database file and applies every migration in order', () => {
    addMigration('0001_first.sql', 'CREATE TABLE a (id TEXT PRIMARY KEY);');
    addMigration('0002_second.sql', "INSERT INTO a (id) VALUES ('x'); CREATE TABLE b (id TEXT PRIMARY KEY);");

    const result = migrateDataDirectory(dataDir, migrationsDir);

    expect(result).toMatchObject({ from: 0, to: 2, applied: ['0001_first.sql', '0002_second.sql'], backup: null });
    expect(existsSync(path.join(dataDir, DATABASE_FILE))).toBe(true);
    inspect((db) => {
      expect(db.pragma('user_version', { simple: true })).toBe(2);
      expect(tables(db)).toEqual(['a', 'b']);
      expect(db.prepare('SELECT id FROM a').pluck().all()).toEqual(['x']);
    });
  });

  it('adds no bookkeeping table of its own', () => {
    addMigration('0001_first.sql', 'CREATE TABLE a (id TEXT PRIMARY KEY);');
    migrateDataDirectory(dataDir, migrationsDir);
    inspect((db) => expect(tables(db)).toEqual(['a']));
  });

  it('is a no-op on a database that is up to date, and takes no backup', () => {
    addMigration('0001_first.sql', 'CREATE TABLE a (id TEXT PRIMARY KEY);');
    migrateDataDirectory(dataDir, migrationsDir);

    const again = migrateDataDirectory(dataDir, migrationsDir);

    expect(again).toMatchObject({ from: 1, to: 1, applied: [], backup: null });
    expect(backups()).toEqual([]);
  });

  it('copies an existing database to a dated backup before applying pending migrations', () => {
    addMigration('0001_first.sql', "CREATE TABLE a (id TEXT PRIMARY KEY); INSERT INTO a VALUES ('kept');");
    migrateDataDirectory(dataDir, migrationsDir);
    addMigration('0002_second.sql', 'DROP TABLE a;');

    const now = new Date('2026-09-23T14:05:00.123Z');
    const result = migrateDataDirectory(dataDir, migrationsDir, now);

    expect(result.backup).toBe(path.join(dataDir, 'emberglass-backup-20260923T140500123Z-v1.db'));
    expect(backups()).toEqual(['emberglass-backup-20260923T140500123Z-v1.db']);
    const copy = new Database(result.backup!, { readonly: true });
    try {
      expect(copy.pragma('user_version', { simple: true })).toBe(1);
      expect(copy.prepare('SELECT id FROM a').pluck().all()).toEqual(['kept']);
    } finally {
      copy.close();
    }
    inspect((db) => expect(tables(db)).toEqual([]));
  });

  it('takes no backup of a brand-new database', () => {
    addMigration('0001_first.sql', 'CREATE TABLE a (id TEXT PRIMARY KEY);');
    expect(migrateDataDirectory(dataDir, migrationsDir).backup).toBeNull();
    expect(backups()).toEqual([]);
  });

  it('rolls a failing migration back entirely and keeps the earlier ones', () => {
    addMigration('0001_first.sql', 'CREATE TABLE a (id TEXT PRIMARY KEY);');
    addMigration('0002_broken.sql', 'CREATE TABLE b (id TEXT PRIMARY KEY); INSERT INTO missing VALUES (1);');

    expect(() => migrateDataDirectory(dataDir, migrationsDir)).toThrow(/missing/);

    inspect((db) => {
      expect(db.pragma('user_version', { simple: true })).toBe(1);
      expect(tables(db)).toEqual(['a']);
    });
  });

  it('refuses a database newer than the code and leaves it untouched', () => {
    addMigration('0001_first.sql', 'CREATE TABLE a (id TEXT PRIMARY KEY);');
    migrateDataDirectory(dataDir, migrationsDir);
    rmSync(path.join(migrationsDir, '0001_first.sql'));

    expect(() => migrateDataDirectory(dataDir, migrationsDir)).toThrow(/schema version 1, newer than this code \(0\)/);
    inspect((db) => expect(db.pragma('user_version', { simple: true })).toBe(1));
  });

  it('applies the repository migrations to an empty data directory', () => {
    const result = migrateDataDirectory(dataDir, MIGRATIONS_DIR);
    expect(result.to).toBe(loadMigrations(MIGRATIONS_DIR).length);
    expect(existsSync(path.join(dataDir, DATABASE_FILE))).toBe(true);
  });
});

describe('loadMigrations', () => {
  it('ignores files that are not SQL', () => {
    writeFileSync(path.join(migrationsDir, 'README.md'), '# notes');
    addMigration('0001_first.sql', 'SELECT 1;');
    expect(loadMigrations(migrationsDir).map((m) => m.version)).toEqual([1]);
  });

  it.each(['1_first.sql', '0001-first.sql', '0001_First.sql', '0001_.sql'])('refuses the file name %j', (file) => {
    addMigration(file, 'SELECT 1;');
    expect(() => loadMigrations(migrationsDir)).toThrow(/NNNN_name\.sql/);
  });

  it('refuses a gap or a duplicate in the numbering', () => {
    addMigration('0001_first.sql', 'SELECT 1;');
    addMigration('0003_third.sql', 'SELECT 1;');
    expect(() => loadMigrations(migrationsDir)).toThrow(/without gaps/);

    rmSync(path.join(migrationsDir, '0003_third.sql'));
    addMigration('0001_again.sql', 'SELECT 1;');
    expect(() => loadMigrations(migrationsDir)).toThrow(/without gaps/);
  });
});

describe('backupFileName', () => {
  it('carries the UTC time to the millisecond and the version it holds', () => {
    expect(backupFileName(new Date('2026-01-02T03:04:05.006Z'), 7)).toBe('emberglass-backup-20260102T030405006Z-v7.db');
  });
});
