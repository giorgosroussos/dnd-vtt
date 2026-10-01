import type Database from 'better-sqlite3';
import {
  applyStroke,
  fillFog,
  FOG_MAX_RUNS,
  FOG_STROKE_MAX_WORK,
  fogExtent,
  fogRuns,
  sameFog,
  strokeWork,
  seenByPlayers,
  type FogMask,
  type FogStroke,
  type SceneToken,
} from '@emberglass/shared';
import { readScene } from './campaigns.js';
import { refusal, type TokenScope } from './scope.js';
import { listTokens, showNewlySeen } from './tokens.js';

// The painted fog of a scene in SQLite (TBL-04, specs/03-domain-model.md §1, specs/04-live-sync.md §2, §4,
// §13, Q-101): one mask per scene, in `scene.fog`, never part of the Scene contract. What players can see of
// a scene's tokens is decided here: a token is seen when it is not hidden and its centre is under no fogged
// cell. Every decision of what reaches players reads it here: the snapshots, the events, the image files and
// the numbering.
//
// The fog is painted, erased, filled and cleared in preparation over REST, and on the live scene by the fog
// commands; each write names its scope as a token write does. A write that changes the fog answers, besides
// the mask before and after, what players see change: the tokens it showed them (`appeared`, bottom of the
// stack first), the tokens it hid from them (`vanished`), and the tokens the numbering renamed because of it
// (`relabelled`), all read in the same transaction as the write.

/** The scene's fog; none for a scene that does not exist. */
export function readFog(db: Database.Database, sceneId: string): FogMask {
  const fog = db.prepare('SELECT fog FROM scene WHERE id = ?').pluck().get(sceneId) as string | undefined;
  return fog === undefined ? [] : (JSON.parse(fog) as FogMask);
}

/** Whether players see each token, by the scene's fog now. */
export function sightOf(db: Database.Database, sceneId: string): (token: SceneToken) => boolean {
  const fog = readFog(db, sceneId);
  return (token) => seenByPlayers(token, token.asset.size, fog);
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

export type FogWriteOutcome =
  | ({ outcome: 'written'; sceneId: string; before: FogMask; fog: FogMask } & Sight)
  | { outcome: 'unchanged'; fog: FogMask }
  /** A stroke that would cost too much to apply, or fog past FOG_MAX_RUNS: nothing is written. */
  | { outcome: 'too_large' }
  | { outcome: 'not_found' }
  | { outcome: 'live' }
  | { outcome: 'not_live' };

/** What a fog write does: a stroke of the brush, the whole map fogged or cleared, or a mask put back. */
export type FogChange = { stroke: FogStroke } | { fill: boolean } | { restore: FogMask };

/**
 * Changes the scene's fog. A stroke and filling stay within the map (its whole image, or a map-less
 * scene's columns and rows); clearing takes every cell off. A change that leaves the fog as it was writes
 * nothing and is answered `unchanged`, so nobody is told and nothing is undone.
 */
export function writeFog(
  db: Database.Database,
  sceneId: string,
  change: FogChange,
  scope: TokenScope = 'prep',
): FogWriteOutcome {
  // Refused before any work: one stroke never holds the server for long (TBL-04 review).
  if ('stroke' in change && strokeWork(change.stroke) > FOG_STROKE_MAX_WORK) return { outcome: 'too_large' };
  return db.transaction((): FogWriteOutcome => {
    const scene = readScene(db, sceneId);
    if (scene === undefined) return { outcome: 'not_found' };
    const refused = refusal(db, sceneId, scope);
    if (refused) return { outcome: refused };
    const before = readFog(db, sceneId);
    let fog: FogMask;
    if ('restore' in change) fog = change.restore;
    else {
      const map =
        scene.map_image_id === null
          ? null
          : (db.prepare('SELECT width, height FROM image WHERE id = ?').get(scene.map_image_id) as {
              width: number;
              height: number;
            });
      const extent = fogExtent(scene.grid, map);
      if ('stroke' in change) fog = applyStroke(before, change.stroke, extent);
      else fog = change.fill ? fillFog(extent) : [];
    }
    if (sameFog(before, fog)) return { outcome: 'unchanged', fog: before };
    if (fogRuns(fog) > FOG_MAX_RUNS) return { outcome: 'too_large' };
    const sight = watching(db, sceneId, () =>
      db.prepare('UPDATE scene SET fog = ? WHERE id = ?').run(JSON.stringify(fog), sceneId),
    );
    return { outcome: 'written', sceneId, before, fog, ...sight };
  })();
}
