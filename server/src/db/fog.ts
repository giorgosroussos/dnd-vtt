import type Database from 'better-sqlite3';
import { seenByPlayers, type RegionShape, type SceneToken } from '@emberglass/shared';

// What players can see of a scene's tokens (TBL-03, specs/04-live-sync.md §4, §13, Q-099): a token is seen
// when it is not hidden and its centre is under no fogged region of its scene. Every decision of what
// reaches players reads it here: the snapshots, the events, the image files and the numbering.

/** The shapes of the scene's fogged regions, in the order they were drawn. */
export function readFog(db: Database.Database, sceneId: string): RegionShape[] {
  return (
    db
      .prepare('SELECT shape FROM region WHERE scene_id = ? AND hidden = 1 ORDER BY "order", id')
      .pluck()
      .all(sceneId) as string[]
  ).map((shape) => JSON.parse(shape) as RegionShape);
}

/** Whether players see each token, by the scene's fog now. */
export function sightOf(db: Database.Database, sceneId: string): (token: SceneToken) => boolean {
  const fog = readFog(db, sceneId);
  return (token) => seenByPlayers(token, token.asset.size, fog);
}
