import { existsSync } from 'node:fs';
import { databasePath, openDatabase } from '../db/database.js';
import { migrateDataDirectory } from '../db/migrate.js';
import { clearPinHash } from '../db/settings.js';

// `npm run reset-pin` (specs/07-security-and-access.md §1, D-028): run on the
// server machine, it clears the PIN hash so that setup runs again from
// localhost. It works whether the server is running or not: the server reads the
// hash from the database on every check. Sessions a running server holds stay
// open until it restarts or the new PIN is set, which ends them all.

export type ResetResult = 'cleared' | 'no-pin' | 'no-database';

export function resetPin(dataDir: string, migrationsDir: string): ResetResult {
  // A mistyped data directory must not become a new, empty database.
  if (!existsSync(databasePath(dataDir))) return 'no-database';
  migrateDataDirectory(dataDir, migrationsDir);
  const db = openDatabase(dataDir);
  try {
    return clearPinHash(db) ? 'cleared' : 'no-pin';
  } finally {
    db.close();
  }
}
