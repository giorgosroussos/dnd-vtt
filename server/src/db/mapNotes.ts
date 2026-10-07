import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { hasNotes, type MapNote, type MapNoteCreateBody, type MapNoteUpdateBody } from '@emberglass/shared';

// Map notes (UXR-08; specs/03-domain-model.md §1, §10, specs/04-live-sync.md §2, §16, Q-128): notes the DM pins at a
// point of a scene's map. They change on any scene, the live one included, as notes do: they are neither preparation
// nor a live command, and they are not undoable. Listed by id, a stable order the DM view draws them in.

const COLUMNS = 'id, scene_id, x, y, notes';

const sceneExists = (db: Database.Database, sceneId: string): boolean =>
  db.prepare('SELECT 1 FROM scene WHERE id = ?').get(sceneId) !== undefined;

export function readMapNote(db: Database.Database, id: string): MapNote | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM map_note WHERE id = ?`).get(id) as MapNote | undefined;
}

/** The scene's map notes, or undefined when the scene does not exist. */
export function listMapNotes(db: Database.Database, sceneId: string): MapNote[] | undefined {
  if (!sceneExists(db, sceneId)) return undefined;
  return db.prepare(`SELECT ${COLUMNS} FROM map_note WHERE scene_id = ? ORDER BY id`).all(sceneId) as MapNote[];
}

/** A new map note on the scene, or undefined when the scene does not exist. */
export function createMapNote(db: Database.Database, sceneId: string, body: MapNoteCreateBody): MapNote | undefined {
  return db.transaction(() => {
    if (!sceneExists(db, sceneId)) return undefined;
    const id = randomUUID();
    db.prepare(`INSERT INTO map_note (${COLUMNS}) VALUES (?, ?, ?, ?, ?)`).run(
      id,
      sceneId,
      body.x,
      body.y,
      body.notes ?? '',
    );
    return readMapNote(db, id);
  })();
}

/** The map note moved, its text replaced, or both; undefined when it does not exist. */
export function updateMapNote(db: Database.Database, id: string, body: MapNoteUpdateBody): MapNote | undefined {
  return db.transaction(() => {
    const note = readMapNote(db, id);
    if (note === undefined) return undefined;
    db.prepare('UPDATE map_note SET x = ?, y = ?, notes = ? WHERE id = ?').run(
      body.x ?? note.x,
      body.y ?? note.y,
      body.notes ?? note.notes,
      id,
    );
    return readMapNote(db, id);
  })();
}

/**
 * The map note removed, as it was; undefined when it did not exist. With `ifEmpty`, only a note whose stored text is
 * empty or blank (`hasNotes`, as the DM view judges it), judged in the same transaction: one holding text is kept,
 * and 'not_empty' says so (UXR-08).
 */
export function deleteMapNote(
  db: Database.Database,
  id: string,
  { ifEmpty = false }: { ifEmpty?: boolean } = {},
): MapNote | 'not_empty' | undefined {
  return db.transaction(() => {
    const note = readMapNote(db, id);
    if (note === undefined) return undefined;
    if (ifEmpty && hasNotes(note.notes)) return 'not_empty' as const;
    db.prepare('DELETE FROM map_note WHERE id = ?').run(id);
    return note;
  })();
}

/** Copies every map note of one scene onto another under new identifiers (a duplicated scene, specs/03 §7). */
export function copyMapNotes(db: Database.Database, fromSceneId: string, toSceneId: string): void {
  const insert = db.prepare(`INSERT INTO map_note (${COLUMNS}) VALUES (?, ?, ?, ?, ?)`);
  for (const note of listMapNotes(db, fromSceneId) ?? [])
    insert.run(randomUUID(), toSceneId, note.x, note.y, note.notes);
}
