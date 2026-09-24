import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// One SQLite file in the data directory (specs/02-architecture.md §7, specs/09-operations.md §5).
export const DATABASE_FILE = 'emberglass.db';

export function databasePath(dataDir: string): string {
  return path.join(dataDir, DATABASE_FILE);
}

// Every connection the server opens enforces foreign keys, and with them the
// cascades and refusals of specs/03-domain-model.md §2 and §7. better-sqlite3 is
// built with them on by default; SQLite itself is not, so this does not rely on
// a compile-time option of the binding.
export function openDatabase(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(databasePath(dataDir));
  db.pragma('foreign_keys = ON');
  return db;
}
