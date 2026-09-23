import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// One SQLite file in the data directory (specs/02-architecture.md §7, specs/09-operations.md §5).
export const DATABASE_FILE = 'emberglass.db';

export function databasePath(dataDir: string): string {
  return path.join(dataDir, DATABASE_FILE);
}

export function openDatabase(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  return new Database(databasePath(dataDir));
}
