import type Database from 'better-sqlite3';

// Who writes to a scene's tokens and fog regions (LIV-02, TBL-03, specs/04-live-sync.md §2, D-100):
// preparation over REST, refused on the live scene, or a live command over the WebSocket, refused on
// any scene that is not live. Checked inside the transaction that would make the change.

/** Who writes: preparation over REST, or a live command over the WebSocket (LIV-02). */
export type TokenScope = 'prep' | 'live';

export const isLive = (db: Database.Database, sceneId: string): boolean =>
  (db.prepare('SELECT live_scene_id FROM settings').pluck().get() as string | null) === sceneId;

/** Why a write in `scope` to the scene is refused, if it is. */
export const refusal = (db: Database.Database, sceneId: string, scope: TokenScope): 'live' | 'not_live' | undefined => {
  const live = isLive(db, sceneId);
  if (scope === 'prep' && live) return 'live';
  if (scope === 'live' && !live) return 'not_live';
  return undefined;
};
