import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// One server per data directory (PKG-01, D-173). A server's start-up empties the folder uploads arrive
// in and removes images nothing references (specs/03-domain-model.md §7), which is safe only while no
// other server uses the same data: a second one started beside it, by two double-clicks or by hand,
// would delete an upload in flight or an image just uploaded and not yet given to an asset. So a server
// takes this lock before it migrates or cleans anything, and holds it for as long as it runs.
//
// The lock is SQLite's own: an exclusive transaction on a file of its own, which the operating system
// releases when the process ends, however it ends, so a crash leaves no stale lock to clear by hand.

export const LOCK_FILE = 'emberglass.lock';

/** Another server holds the data directory. */
export class DataDirectoryInUseError extends Error {
  readonly code = 'EMBERGLASS_DATA_DIR_IN_USE';
  constructor(readonly dataDir: string) {
    super(`Another Emberglass is already running with the data directory ${dataDir}.`);
  }
}

export interface DataDirectoryLock {
  release(): void;
}

/** Takes the data directory for this process, or throws DataDirectoryInUseError at once. */
export function lockDataDirectory(dataDir: string): DataDirectoryLock {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, LOCK_FILE), { timeout: 0 });
  try {
    db.exec('BEGIN EXCLUSIVE');
  } catch (error) {
    db.close();
    if ((error as { code?: unknown }).code === 'SQLITE_BUSY') throw new DataDirectoryInUseError(dataDir);
    throw error;
  }
  return {
    release() {
      if (!db.open) return;
      db.exec('ROLLBACK');
      db.close();
    },
  };
}
