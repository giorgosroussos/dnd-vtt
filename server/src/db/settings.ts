import type Database from 'better-sqlite3';
import type { Settings } from '@emberglass/shared';

// The one settings row (specs/03-domain-model.md §1), read and written through
// explicit column lists only. The PIN hash shares the row with the settings a DM
// route returns, so no query here that reads settings for a response names it,
// and the hash is read and written by its own functions (G-008).

const SETTINGS_COLUMNS = 'id, live_scene_id, ruler_rule, upload_limit_bytes, display_variant_size';

export function readSettings(db: Database.Database): Settings {
  return db.prepare(`SELECT ${SETTINGS_COLUMNS} FROM settings`).get() as Settings;
}

export function readPinHash(db: Database.Database): string | null {
  return db.prepare('SELECT pin_hash FROM settings').pluck().get() as string | null;
}

/** Sets the first PIN; false when one is already set, so two setups at once cannot both win. */
export function setFirstPinHash(db: Database.Database, hash: string): boolean {
  return db.prepare('UPDATE settings SET pin_hash = ? WHERE pin_hash IS NULL').run(hash).changes === 1;
}

/** Replaces the PIN hash only if it is still `current`; false when it changed meanwhile. */
export function replacePinHash(db: Database.Database, current: string, hash: string): boolean {
  return db.prepare('UPDATE settings SET pin_hash = ? WHERE pin_hash = ?').run(hash, current).changes === 1;
}

/** Clears the PIN (`npm run reset-pin`); true when there was one. */
export function clearPinHash(db: Database.Database): boolean {
  return db.prepare('UPDATE settings SET pin_hash = NULL WHERE pin_hash IS NOT NULL').run().changes === 1;
}
