import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Region, RegionShape, SceneToken } from '@emberglass/shared';
import { refusal, type TokenScope } from './scope.js';
import { sightOf } from './fog.js';
import { listTokens, showNewlySeen } from './tokens.js';

// Fog regions of a scene in SQLite (TBL-03, specs/03-domain-model.md §1, §2, §7, specs/04-live-sync.md §2,
// §4, §13, Q-099). A region is drawn, renamed, fogged or revealed and deleted in preparation over REST, and
// on the live scene by the region commands; each write names its scope as a token write does. A write that
// changes the fog answers, besides the region, what players see change: the tokens it showed them
// (`appeared`, bottom of the stack first), the tokens it hid from them (`vanished`), and the tokens the
// numbering renamed because of it (`relabelled`), all read in the same transaction as the write.

const COLUMNS = 'id, scene_id, name, "order", shape, hidden';

interface Row {
  id: string;
  scene_id: string;
  name: string;
  order: number;
  shape: string;
  hidden: 0 | 1;
}

const toRegion = (row: Row): Region => ({
  id: row.id,
  scene_id: row.scene_id,
  name: row.name,
  order: row.order,
  shape: JSON.parse(row.shape) as RegionShape,
  hidden: row.hidden === 1,
});

export function readRegion(db: Database.Database, id: string): Region | undefined {
  const row = db.prepare(`SELECT ${COLUMNS} FROM region WHERE id = ?`).get(id) as Row | undefined;
  return row && toRegion(row);
}

/** The scene's regions in the order they were drawn; undefined when the scene does not exist. */
export function listRegions(db: Database.Database, sceneId: string): Region[] | undefined {
  if (db.prepare('SELECT count(*) FROM scene WHERE id = ?').pluck().get(sceneId) === 0) return undefined;
  return (
    db.prepare(`SELECT ${COLUMNS} FROM region WHERE scene_id = ? ORDER BY "order", id`).all(sceneId) as Row[]
  ).map(toRegion);
}

/**
 * What players see change with a write to the fog: each token shown, bottom of the stack first, with the
 * token its numbering renamed "<name> 1" if players saw that one already, and each token covered.
 */
export interface Sight {
  appeared: { token: SceneToken; relabelled: SceneToken[]; numbered: boolean }[];
  vanished: SceneToken[];
}

/** Runs `write`, then numbers what players now see for the first time, and answers what changed for them. */
function watching(db: Database.Database, sceneId: string, write: () => void): Sight {
  const seenBefore = sightOf(db, sceneId);
  const before = new Map((listTokens(db, sceneId) ?? []).filter(seenBefore).map((token) => [token.id, token]));
  write();
  const relabels = new Map(showNewlySeen(db, sceneId).map(({ id, relabel }) => [id, relabel]));
  const after = (listTokens(db, sceneId) ?? []).filter(sightOf(db, sceneId));
  const afterById = new Map(after.map((token) => [token.id, token]));
  return {
    appeared: after
      .filter((token) => !before.has(token.id))
      .map((token) => {
        const relabel = relabels.get(token.id);
        // One shown in this same change travels as itself, with its new label.
        const renamed = relabel !== undefined && before.has(relabel) ? afterById.get(relabel) : undefined;
        return { token, relabelled: renamed ? [renamed] : [], numbered: relabels.has(token.id) };
      }),
    vanished: [...before.values()].filter((token) => !afterById.has(token.id)),
  };
}

export type RegionWriteOutcome =
  | ({ outcome: 'written'; before: Region | undefined; region: Region } & Sight)
  | { outcome: 'not_found' }
  | { outcome: 'live' }
  | { outcome: 'not_live' };

/** Draws a region on the scene, after its other regions; fogged unless `hidden` is false. */
export function createRegion(
  db: Database.Database,
  sceneId: string,
  fields: { name: string; shape: RegionShape; hidden?: boolean | undefined },
  scope: TokenScope = 'prep',
): RegionWriteOutcome {
  return db.transaction((): RegionWriteOutcome => {
    if (db.prepare('SELECT count(*) FROM scene WHERE id = ?').pluck().get(sceneId) === 0)
      return { outcome: 'not_found' };
    const refused = refusal(db, sceneId, scope);
    if (refused) return { outcome: refused };
    const id = randomUUID();
    const last = db.prepare('SELECT max("order") FROM region WHERE scene_id = ?').pluck().get(sceneId) as number | null;
    const sight = watching(db, sceneId, () =>
      db
        .prepare(`INSERT INTO region (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(
          id,
          sceneId,
          fields.name.trim(),
          (last ?? 0) + 1,
          JSON.stringify(fields.shape),
          fields.hidden === false ? 0 : 1,
        ),
    );
    return { outcome: 'written', before: undefined, region: readRegion(db, id)!, ...sight };
  })();
}

/** Renames a region, or fogs or reveals it. */
export function updateRegion(
  db: Database.Database,
  id: string,
  fields: { name?: string | undefined; hidden?: boolean | undefined },
  scope: TokenScope = 'prep',
): RegionWriteOutcome {
  return db.transaction((): RegionWriteOutcome => {
    const before = readRegion(db, id);
    if (before === undefined) return { outcome: 'not_found' };
    const refused = refusal(db, before.scene_id, scope);
    if (refused) return { outcome: refused };
    const sight = watching(db, before.scene_id, () =>
      db
        .prepare('UPDATE region SET name = ?, hidden = ? WHERE id = ?')
        .run(fields.name?.trim() ?? before.name, (fields.hidden ?? before.hidden) ? 1 : 0, id),
    );
    return { outcome: 'written', before, region: readRegion(db, id)!, ...sight };
  })();
}

/** Deletes a region for good, answering what it was; the tokens under it are seen if nothing else hides them. */
export function deleteRegion(db: Database.Database, id: string, scope: TokenScope = 'prep'): RegionWriteOutcome {
  return db.transaction((): RegionWriteOutcome => {
    const before = readRegion(db, id);
    if (before === undefined) return { outcome: 'not_found' };
    const refused = refusal(db, before.scene_id, scope);
    if (refused) return { outcome: refused };
    const sight = watching(db, before.scene_id, () => db.prepare('DELETE FROM region WHERE id = ?').run(id));
    return { outcome: 'written', before, region: before, ...sight };
  })();
}

/**
 * Puts a deleted region back exactly as it was, its id and place in the list included (the undo of
 * `region.delete`). Refused when its scene is gone or not in `scope`; each deletion's inverse is taken once,
 * so its id is free.
 */
export function restoreRegion(db: Database.Database, region: Region, scope: TokenScope = 'live'): RegionWriteOutcome {
  return db.transaction((): RegionWriteOutcome => {
    if (db.prepare('SELECT count(*) FROM scene WHERE id = ?').pluck().get(region.scene_id) === 0) {
      return { outcome: 'not_found' };
    }
    const refused = refusal(db, region.scene_id, scope);
    if (refused) return { outcome: refused };
    const sight = watching(db, region.scene_id, () =>
      db
        .prepare(`INSERT INTO region (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(
          region.id,
          region.scene_id,
          region.name,
          region.order,
          JSON.stringify(region.shape),
          region.hidden ? 1 : 0,
        ),
    );
    return { outcome: 'written', before: undefined, region: readRegion(db, region.id)!, ...sight };
  })();
}
