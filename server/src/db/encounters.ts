import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { Value } from 'typebox/value';
import {
  changeOf,
  EncounterEntrySchema,
  notingEnemies,
  turnView,
  withoutEntry,
  type Encounter,
  type EncounterChange,
  type EncounterEntry,
  type ErrorCode,
} from '@emberglass/shared';
import { readFog } from './fog.js';
import { refusal } from './scope.js';
import { listTokens } from './tokens.js';

// The initiative tracker in SQLite (TBL-06, DMT-02; specs/03-domain-model.md §1, §7, specs/04-live-sync.md
// §14, Q-111, Q-118, D-180): at most one encounter per scene, in the `encounter` table, deleted with its
// scene. The encounter commands change it on the live scene only; each change is read, decided and written
// in one transaction, from the scene's tokens and fog at that moment, so which entries take their turn, which
// is never stored, follows from what players can see now. A change answers the encounter before and after
// it, which undo puts back.

interface Row {
  id: string;
  scene_id: string;
  active: 0 | 1;
  round: number;
  current_index: number;
  enemies_seen: 0 | 1;
  entries: string;
}

const COLUMNS = 'id, scene_id, active, round, current_index, enemies_seen, entries';

/** The entries stored, each as the contract has it; anything else is dropped. */
const entriesOf = (entries: readonly unknown[]): EncounterEntry[] =>
  entries.filter((entry): entry is EncounterEntry => Value.Check(EncounterEntrySchema, entry));

const toEncounter = (row: Row): Encounter => {
  const entries = entriesOf(JSON.parse(row.entries) as unknown[]);
  return {
    id: row.id,
    scene_id: row.scene_id,
    active: row.active === 1,
    round: row.round,
    current_index: Math.min(row.current_index, Math.max(entries.length - 1, 0)),
    enemies_seen: row.enemies_seen === 1,
    entries,
  };
};

/** The scene's encounter; null when it never had one. */
export function readEncounter(db: Database.Database, sceneId: string): Encounter | null {
  const row = db.prepare(`SELECT ${COLUMNS} FROM encounter WHERE scene_id = ?`).get(sceneId) as Row | undefined;
  return row === undefined ? null : toEncounter(row);
}

/** Writes the scene's encounter as given, or removes it (null): what undo puts back. */
function store(db: Database.Database, sceneId: string, encounter: Encounter | null): void {
  if (encounter === null) {
    db.prepare('DELETE FROM encounter WHERE scene_id = ?').run(sceneId);
    return;
  }
  db.prepare(
    `INSERT INTO encounter (${COLUMNS}) VALUES (@id, @scene_id, @active, @round, @current_index, @enemies_seen, @entries)
     ON CONFLICT (scene_id) DO UPDATE SET id = excluded.id, active = excluded.active, round = excluded.round,
       current_index = excluded.current_index, enemies_seen = excluded.enemies_seen, entries = excluded.entries`,
  ).run({
    id: encounter.id,
    scene_id: sceneId,
    active: encounter.active ? 1 : 0,
    round: encounter.round,
    current_index: encounter.current_index,
    enemies_seen: encounter.enemies_seen ? 1 : 0,
    entries: JSON.stringify(encounter.entries),
  });
}

const same = (a: Encounter | null, b: Encounter | null): boolean => JSON.stringify(a) === JSON.stringify(b);

export type EncounterOutcome =
  | { outcome: 'changed'; sceneId: string; before: Encounter | null; encounter: Encounter | null }
  | { outcome: 'unchanged' }
  | { outcome: 'not_live' }
  | { outcome: 'refused'; code: ErrorCode; message: string };

/**
 * Applies an encounter command to scene `sceneId`, which must be the live one. Refused when it is not live,
 * or when the change does not apply; a change that would change nothing answers `unchanged`.
 */
export function changeEncounter(db: Database.Database, sceneId: string, change: EncounterChange): EncounterOutcome {
  return db.transaction((): EncounterOutcome => {
    const tokens = listTokens(db, sceneId);
    if (tokens === undefined || refusal(db, sceneId, 'live')) return { outcome: 'not_live' };
    const before = readEncounter(db, sceneId);
    const decision = changeOf(before, change, { sceneId, tokens, fog: readFog(db, sceneId), newId: randomUUID });
    if (decision === undefined) return { outcome: 'unchanged' };
    if ('refused' in decision) return { outcome: 'refused', ...decision.refused };
    store(db, sceneId, decision.encounter);
    return { outcome: 'changed', sceneId, before, encounter: decision.encounter };
  })();
}

/**
 * After any live command: marks the live scene's encounter as having had an enemy once a monster or npc entry
 * can take its turn (Q-118). Not a step of the undo history; the encounter before and after when it changed.
 */
export function noteEnemies(
  db: Database.Database,
  sceneId: string,
): { before: Encounter; encounter: Encounter } | undefined {
  return db.transaction(() => {
    const before = readEncounter(db, sceneId);
    if (before === null || !before.active || before.enemies_seen) return undefined;
    const tokens = listTokens(db, sceneId) ?? [];
    const after = notingEnemies(before, turnView(tokens, readFog(db, sceneId)));
    if (after === null || same(before, after)) return undefined;
    store(db, sceneId, after);
    return { before, encounter: after };
  })();
}

/**
 * Removes a deleted token's entry from its scene's encounter (specs/03-domain-model.md §7), inside the
 * deletion's transaction; the encounter before and after when it had one.
 */
export function dropEntriesOf(
  db: Database.Database,
  sceneId: string,
  tokenId: string,
): { before: Encounter; encounter: Encounter } | undefined {
  const before = readEncounter(db, sceneId);
  if (before === null) return undefined;
  const at = before.entries.findIndex((entry) => entry.token_id === tokenId);
  if (at === -1) return undefined;
  const after = withoutEntry(before, at, turnView(listTokens(db, sceneId) ?? [], readFog(db, sceneId)));
  store(db, sceneId, after);
  return { before, encounter: after };
}
