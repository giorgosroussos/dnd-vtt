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

export function migrateDataDirectory(dataDir: string, migrationsDir: string, now: Date = new Date()): MigrationResult {
  const migrations = loadMigrations(migrationsDir);
  const database = databasePath(dataDir);
  const existed = existsSync(database) && statSync(database).size > 0;
  const db = openDatabase(dataDir);
  try {
    const from = db.pragma('user_version', { simple: true }) as number;
    const latest = migrations.at(-1)?.version ?? 0;
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

    for (const migration of pending) {
      db.transaction(() => {
        db.exec(migration.sql);
        db.pragma(`user_version = ${migration.version}`);
      })();
    }
    return { database, from, to: pending.at(-1)?.version ?? from, applied: pending.map((m) => m.name), backup };
  } finally {
    db.close();
  }
}
