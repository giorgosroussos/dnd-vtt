import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { databasePath, openDatabase } from './database.js';

// Numbered SQL migrations applied in order (specs/09-operations.md §2, D-009).
// The applied version is SQLite's `PRAGMA user_version`, so the runner adds no
// table of its own to the schema of specs/03-domain-model.md §1.

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export interface MigrationResult {
  database: string;
  from: number;
  to: number;
  applied: string[];
  backup: string | null;
}

const MIGRATION_FILE = /^(\d{4})_([a-z0-9][a-z0-9_-]*)\.sql$/;

export function loadMigrations(dir: string): Migration[] {
  const migrations: Migration[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.sql')) continue;
    const match = MIGRATION_FILE.exec(file);
    if (!match) {
      throw new Error(`Migration file "${file}" is not named NNNN_name.sql.`);
    }
    migrations.push({
      version: Number(match[1]),
      name: file,
      sql: readFileSync(path.join(dir, file), 'utf8'),
    });
  }
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(`Migrations must be numbered 0001 upwards without gaps; found ${m.name} at position ${i + 1}.`);
    }
  });
  return migrations;
}

// `emberglass-backup-20260923T140500123Z-v3.db`: the time of the copy and the
// schema version the copy holds.
export function backupFileName(now: Date, version: number): string {
  const stamp = now.toISOString().replace(/[-:.]/g, '');
  return `emberglass-backup-${stamp}-v${version}.db`;
}

// `target` stops at an earlier version; the fixture database uses it to build
// data at the version it was written for (D-075).
export function migrateDataDirectory(
  dataDir: string,
  migrationsDir: string,
  now: Date = new Date(),
  target?: number,
): MigrationResult {
  const migrations = loadMigrations(migrationsDir).filter((m) => target === undefined || m.version <= target);
  const database = databasePath(dataDir);
  const existed = existsSync(database) && statSync(database).size > 0;
  const db = openDatabase(dataDir);
  try {
    const version = (): number => db.pragma('user_version', { simple: true }) as number;
    const from = version();
    const latest = migrations.at(-1)?.version ?? 0;
    if (target !== undefined && from > target) {
      throw new Error(`The database at ${database} is at schema version ${from}, past the target version ${target}.`);
    }
    if (from > latest) {
      throw new Error(
        `The database at ${database} is at schema version ${from}, newer than this code (${latest}). ` +
          'Update Emberglass instead of opening the data with an older version.',
      );
    }
    const pending = migrations.filter((m) => m.version > from);

    // A dated copy before anything changes; `VACUUM INTO` also captures pages
    // still in a write-ahead log, which a plain file copy would miss.
    let backup: string | null = null;
    if (pending.length > 0 && existed) {
      backup = path.join(dataDir, backupFileName(now, from));
      db.prepare('VACUUM INTO ?').run(backup);
    }

    // Foreign keys are off while migrations run, as SQLite's procedure for
    // changing a table's schema requires: rebuilding a parent table would
    // otherwise cascade-delete its children. Each migration is checked instead,
    // and one that leaves a dangling reference is rolled back.
    //
    // Each migration takes the write lock before it reads the version
    // (`BEGIN IMMEDIATE`), so a second process migrating the same file at the
    // same time, such as `make migrate` while the server starts, waits and then
    // skips what the first applied instead of applying it again.
    db.pragma('foreign_keys = OFF');
    const applied: string[] = [];
    for (const migration of pending) {
      db.transaction(() => {
        if (version() >= migration.version) return;
        db.exec(migration.sql);
        const dangling = db.pragma('foreign_key_check') as { table: string }[];
        if (dangling.length > 0) {
          const tables = [...new Set(dangling.map((row) => row.table))].join(', ');
          throw new Error(`Migration ${migration.name} leaves rows with a missing parent in: ${tables}.`);
        }
        db.pragma(`user_version = ${migration.version}`);
        applied.push(migration.name);
      }).immediate();
    }
    return { database, from, to: version(), applied, backup };
  } finally {
    db.close();
  }
}
