import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { Value } from 'typebox/value';
import {
  EncounterSchema,
  hasMarker,
  PcEntrySchema,
  seenByPlayers,
  takesTurn,
  turnView,
  type Encounter,
  type EncounterEntry,
  type EncounterToken,
  type FogMask,
} from '@emberglass/shared';

// The steps a migration takes in code, after its SQL and inside the same transaction, keyed by the migration's
// file name so that a test's own migrations never run one (specs/09-operations.md §2, D-180). A step reads the
// schema as its migration leaves it, with its own queries: the code of later packages reads a later schema.

export type MigrationStep = (db: Database.Database) => void;

/** The TBL-06 Enemies entry, as encounters stored before migration 0011 hold it. */
interface EnemiesEntry {
  id: string;
  kind: 'dm';
  initiative: number | null;
}

const isEnemiesEntry = (value: unknown): value is EnemiesEntry =>
  typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'dm';

/** An encounter as stored before migration 0011: entries of either kind of before. */
export interface StoredEncounter {
  current_index: number;
  round: number;
  active: boolean;
  enemies_seen: boolean;
  entries: (EncounterEntry | EnemiesEntry)[];
}

/**
 * The encounter with its Enemies entry expanded in place (DMT-02, specs/04-live-sync.md §14, D-181): one
 * monster entry per member it had, the monster and npc tokens players can see that do not carry Dead, in the
 * order of the DM's token list, each with the Enemies entry's number. The turn, if the Enemies entry had it,
 * passes to the first of them; an Enemies entry without a member is removed, its turn passing as on removal,
 * to the next entry that takes it, a round more past the last. Entries the contract does not know are dropped,
 * as reading them always did. Unchanged without an Enemies entry.
 */
export function expandEnemiesEntry<T extends StoredEncounter>(
  stored: T,
  tokens: readonly EncounterToken[],
  fog: FogMask,
  newId: () => string,
): Omit<T, 'entries'> & { entries: EncounterEntry[] } {
  const kept = stored.entries.filter((entry) => isEnemiesEntry(entry) || Value.Check(PcEntrySchema, entry));
  const found = (entry: StoredEncounter['entries'][number]) => kept.findIndex((each) => each === entry);
  const at = kept.findIndex(isEnemiesEntry);
  // The entry the turn was on, among those kept; the first when it was dropped.
  const pointed = stored.entries[Math.min(stored.current_index, stored.entries.length - 1)];
  let current = Math.max(pointed === undefined ? 0 : found(pointed), 0);
  if (at === -1) return { ...stored, current_index: current, entries: kept as EncounterEntry[] };
  const enemies = kept[at] as EnemiesEntry;
  const entered = new Set(kept.flatMap((entry) => (isEnemiesEntry(entry) ? [] : [entry.token_id])));
  const members = tokens
    .filter(
      (token) =>
        (token.asset.category === 'monster' || token.asset.category === 'npc') &&
        seenByPlayers(token, token.asset.size, fog) &&
        !hasMarker(token.markers, 'dead') &&
        !entered.has(token.id),
    )
    .sort((a, b) => a.z_order - b.z_order || a.id.localeCompare(b.id));
  const expanded = members.map((token): EncounterEntry => ({
    id: newId(),
    kind: 'monster',
    token_id: token.id,
    initiative: enemies.initiative,
  }));
  const entries = [
    ...(kept.slice(0, at) as EncounterEntry[]),
    ...expanded,
    ...(kept.slice(at + 1) as EncounterEntry[]),
  ];
  let round = stored.round;
  if (current > at) current += expanded.length - 1;
  else if (current === at && expanded.length === 0) {
    // The Enemies entry had the turn and goes: the next entry that takes it, from where it stood.
    const view = turnView(tokens, fog);
    const passed = entries.findIndex((entry, index) => index >= at && takesTurn(entry, view));
    const wrapped = entries.findIndex((entry, index) => index < at && takesTurn(entry, view));
    if (passed !== -1) current = passed;
    else if (wrapped !== -1) {
      current = wrapped;
      round += 1;
    } else current = 0;
  }
  return {
    ...stored,
    round,
    current_index: Math.min(current, Math.max(entries.length - 1, 0)),
    enemies_seen: stored.enemies_seen || (stored.active && expanded.length > 0),
    entries,
  };
}

interface EncounterRow {
  id: string;
  scene_id: string;
  active: 0 | 1;
  round: number;
  current_index: number;
  enemies_seen: 0 | 1;
  entries: string;
}

interface TokenRow {
  id: string;
  x: number;
  y: number;
  hidden: 0 | 1;
  z_order: number;
  markers: string;
  size: EncounterToken['asset']['size'];
  category: EncounterToken['asset']['category'];
}

/** Migration 0011: every stored encounter's Enemies entry expanded in place, each result checked first. */
function expandStoredEncounters(db: Database.Database): void {
  const rows = db
    .prepare('SELECT id, scene_id, active, round, current_index, enemies_seen, entries FROM encounter')
    .all() as EncounterRow[];
  const tokensOf = db.prepare(
    `SELECT token.id, token.x, token.y, token.hidden, token.z_order, token.markers, asset.size, asset.category
     FROM token JOIN asset ON asset.id = token.asset_id WHERE token.scene_id = ?`,
  );
  const fogOf = db.prepare('SELECT fog FROM scene WHERE id = ?').pluck();
  const write = db.prepare(
    `UPDATE encounter SET round = @round, current_index = @current_index, enemies_seen = @enemies_seen,
       entries = @entries WHERE id = @id`,
  );
  for (const row of rows) {
    const stored = JSON.parse(row.entries) as unknown[];
    if (!stored.some(isEnemiesEntry)) continue;
    const tokens = (tokensOf.all(row.scene_id) as TokenRow[]).map((token): EncounterToken => ({
      id: token.id,
      x: token.x,
      y: token.y,
      hidden: token.hidden === 1,
      z_order: token.z_order,
      markers: JSON.parse(token.markers) as EncounterToken['markers'],
      asset: { size: token.size, category: token.category },
    }));
    const fog = JSON.parse((fogOf.get(row.scene_id) as string | undefined) ?? '[]') as FogMask;
    const expanded = expandEnemiesEntry(
      {
        current_index: row.current_index,
        round: row.round,
        active: row.active === 1,
        enemies_seen: row.enemies_seen === 1,
        entries: stored as StoredEncounter['entries'],
      },
      tokens,
      fog,
      randomUUID,
    );
    const encounter: Encounter = { id: row.id, scene_id: row.scene_id, ...expanded };
    if (!Value.Check(EncounterSchema, encounter)) {
      throw new Error(`The encounter ${row.id} does not fit the contract once its Enemies entry is expanded.`);
    }
    write.run({
      id: row.id,
      round: encounter.round,
      current_index: encounter.current_index,
      enemies_seen: encounter.enemies_seen ? 1 : 0,
      entries: JSON.stringify(encounter.entries),
    });
  }
}

export const MIGRATION_STEPS: Readonly<Record<string, MigrationStep>> = {
  '0011_enemy_entries.sql': expandStoredEncounters,
};
