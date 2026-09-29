import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { nextLabel, numberingPeers, type SceneToken, type TokenSize, type TokenStack } from '@emberglass/shared';

// Tokens of a scene in SQLite (PRP-04, specs/03-domain-model.md §1, §2, §4,
// specs/05-assets-and-images.md §2–§5, specs/04-live-sync.md §2, D-019, Q-063, Q-091). Every
// read and write names its columns. A token holds only its own state (position, visibility,
// label, stacking order); its name, image and size are its asset's and are read by joining it.
// Positions are decimal grid units and are stored exactly as sent. Every write names the scope it
// is for, checked inside the transaction that would change the token: preparation (REST) is refused
// on the live scene, whose tokens change only by the live commands, and a live command is refused
// on any scene that is not live (LIV-02, specs/04-live-sync.md §2, D-100).

const COLUMNS = `token.id, token.scene_id, token.asset_id, token.label, token.x, token.y, token.hidden,
  token.z_order, token.character_id, asset.name AS asset_name, asset.image_id AS asset_image_id,
  asset.size AS asset_size`;
const FROM = 'FROM token JOIN asset ON asset.id = token.asset_id';

interface Row {
  id: string;
  scene_id: string;
  asset_id: string;
  label: string;
  x: number;
  y: number;
  hidden: 0 | 1;
  z_order: number;
  character_id: null;
  asset_name: string;
  asset_image_id: string;
  asset_size: TokenSize;
}

const toToken = (row: Row): SceneToken => ({
  id: row.id,
  scene_id: row.scene_id,
  asset_id: row.asset_id,
  label: row.label,
  x: row.x,
  y: row.y,
  hidden: row.hidden === 1,
  z_order: row.z_order,
  character_id: row.character_id,
  asset: { name: row.asset_name, image_id: row.asset_image_id, size: row.asset_size },
});

/** Whether players have seen the token (Q-096); kept out of SceneToken, which clients receive. */
const shownOf = (db: Database.Database, id: string): boolean =>
  db.prepare('SELECT shown FROM token WHERE id = ?').pluck().get(id) === 1;

const isLive = (db: Database.Database, sceneId: string): boolean =>
  (db.prepare('SELECT live_scene_id FROM settings').pluck().get() as string | null) === sceneId;

/** Who writes: preparation over REST, or a live command over the WebSocket (LIV-02). */
export type TokenScope = 'prep' | 'live';

/** Why a write in `scope` to a token of the scene is refused, if it is. */
const refusal = (db: Database.Database, sceneId: string, scope: TokenScope): 'live' | 'not_live' | undefined => {
  const live = isLive(db, sceneId);
  if (scope === 'prep' && live) return 'live';
  if (scope === 'live' && !live) return 'not_live';
  return undefined;
};

export function readToken(db: Database.Database, id: string): SceneToken | undefined {
  const row = db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE token.id = ?`).get(id) as Row | undefined;
  return row && toToken(row);
}

/** The scene's tokens, bottom of the stack first; undefined when the scene does not exist. */
export function listTokens(db: Database.Database, sceneId: string): SceneToken[] | undefined {
  if (db.prepare('SELECT count(*) FROM scene WHERE id = ?').pluck().get(sceneId) === 0) return undefined;
  const rows = db
    .prepare(`SELECT ${COLUMNS} ${FROM} WHERE token.scene_id = ? ORDER BY token.z_order, token.id`)
    .all(sceneId) as Row[];
  return rows.map(toToken);
}

export type TokenCreateOutcome =
  | { outcome: 'created'; token: SceneToken; relabelled: SceneToken[] }
  | { outcome: 'not_found' }
  | { outcome: 'asset_not_found' }
  | { outcome: 'live' }
  | { outcome: 'not_live' };

/**
 * Numbers token `id` of the asset on the scene as it is shown to players (D-019, Q-091, Q-092),
 * writing its label, the lone bare-named token's "<name> 1" and the highest number issued, which
 * the scene's `token_numbers` records so that none is issued twice. Answers the renamed token's id.
 * The caller's transaction holds it all.
 */
function numberAs(
  db: Database.Database,
  sceneId: string,
  asset: { id: string; name: string },
  id: string,
): string | undefined {
  const numbers = db.prepare('SELECT token_numbers FROM scene WHERE id = ?').pluck().get(sceneId) as string;
  const others = (
    db
      .prepare(
        'SELECT id, label, hidden FROM token WHERE scene_id = ? AND asset_id = ? AND id <> ? ORDER BY z_order, id',
      )
      .all(sceneId, asset.id, id) as { id: string; label: string; hidden: 0 | 1 }[]
  ).map((token) => ({ ...token, hidden: token.hidden === 1 }));
  const issued = (JSON.parse(numbers) as Record<string, number>)[asset.id] ?? 0;
  const numbering = nextLabel(asset.name, numberingPeers(asset.name, others), issued);
  db.prepare('UPDATE token SET label = ? WHERE id = ?').run(numbering.label, id);
  if (numbering.relabel) {
    db.prepare('UPDATE token SET label = ? WHERE id = ?').run(numbering.relabel.label, numbering.relabel.id);
  }
  db.prepare('UPDATE scene SET token_numbers = json_set(token_numbers, ?, ?) WHERE id = ?').run(
    numberPath(asset.id),
    numbering.issued,
    sceneId,
  );
  return numbering.relabel?.id;
}

/**
 * Places a token of the asset at (x, y), on top of the scene's other tokens. It starts hidden
 * when its asset's `default_hidden` is set (specs/05-assets-and-images.md §4): then it takes the
 * bare name and no number, which it gets when revealed (Q-092); a visible one is numbered at once.
 */
export function createToken(
  db: Database.Database,
  sceneId: string,
  fields: { asset_id: string; x: number; y: number },
  scope: TokenScope = 'prep',
): TokenCreateOutcome {
  const id = randomUUID();
  return db.transaction((): TokenCreateOutcome => {
    const numbers = db.prepare('SELECT token_numbers FROM scene WHERE id = ?').pluck().get(sceneId) as
      string | undefined;
    if (numbers === undefined) return { outcome: 'not_found' };
    const refused = refusal(db, sceneId, scope);
    if (refused) return { outcome: refused };
    const asset = db.prepare('SELECT name, default_hidden FROM asset WHERE id = ?').get(fields.asset_id) as
      { name: string; default_hidden: 0 | 1 } | undefined;
    if (asset === undefined) return { outcome: 'asset_not_found' };
    const top = db.prepare('SELECT max(z_order) FROM token WHERE scene_id = ?').pluck().get(sceneId) as number | null;
    db.prepare(
      'INSERT INTO token (id, scene_id, asset_id, label, x, y, hidden, z_order, shown) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      id,
      sceneId,
      fields.asset_id,
      asset.name,
      fields.x,
      fields.y,
      asset.default_hidden,
      (top ?? -1) + 1,
      // Placed visible is its first showing (Q-096).
      asset.default_hidden === 1 ? 0 : 1,
    );
    const renamed =
      asset.default_hidden === 1 ? undefined : numberAs(db, sceneId, { id: fields.asset_id, name: asset.name }, id);
    return {
      outcome: 'created',
      token: readToken(db, id)!,
      relabelled: renamed ? [readToken(db, renamed)!] : [],
    };
  })();
}

// The JSON path of an asset's entry; an asset id is a UUID, so quoting it is all it needs.
const numberPath = (assetId: string): string => `$."${assetId}"`;

/** Forgets the numbers issued for an asset that is being deleted, which no token uses any more. */
export function forgetTokenNumbers(db: Database.Database, assetId: string): void {
  db.prepare(
    'UPDATE scene SET token_numbers = json_remove(token_numbers, ?) WHERE json_type(token_numbers, ?) IS NOT NULL',
  ).run(numberPath(assetId), numberPath(assetId));
}

export type TokenChangeOutcome =
  | { outcome: 'updated'; before: SceneToken; token: SceneToken; relabelled: SceneToken[] }
  | { outcome: 'not_found' }
  | { outcome: 'live' }
  | { outcome: 'not_live' };

/**
 * Moves, hides or reveals, relabels or restacks a token; in preparation, of a scene that is not
 * live, and by a live command (only a move or a visibility change, specs/04-live-sync.md §2), of the
 * live scene. `stack`
 * puts it above (`front`) or below (`back`) every other token of the scene, unless it already is.
 * Revealing a token that still carries its asset's bare name numbers it (Q-092), unless the same
 * change gives it a label or players have seen it before (Q-096); hiding one keeps its label.
 */
export function updateToken(
  db: Database.Database,
  id: string,
  fields: { x?: number; y?: number; hidden?: boolean; label?: string; stack?: TokenStack },
  scope: TokenScope = 'prep',
): TokenChangeOutcome {
  return db.transaction((): TokenChangeOutcome => {
    const before = readToken(db, id);
    if (before === undefined) return { outcome: 'not_found' };
    const refused = refusal(db, before.scene_id, scope);
    if (refused) return { outcome: refused };
    let z = before.z_order;
    if (fields.stack !== undefined) {
      const others = db
        .prepare(
          `SELECT ${fields.stack === 'front' ? 'max' : 'min'}(z_order) FROM token WHERE scene_id = ? AND id <> ?`,
        )
        .pluck()
        .get(before.scene_id, id) as number | null;
      if (others !== null && (fields.stack === 'front' ? z <= others : z >= others)) {
        z = fields.stack === 'front' ? others + 1 : others - 1;
      }
    }
    db.prepare('UPDATE token SET x = ?, y = ?, hidden = ?, label = ?, z_order = ? WHERE id = ?').run(
      fields.x ?? before.x,
      fields.y ?? before.y,
      (fields.hidden ?? before.hidden) ? 1 : 0,
      fields.label ?? before.label,
      z,
      id,
    );
    const revealed = before.hidden && fields.hidden === false;
    // Numbered only at its first showing (Q-096): a token players saw is revealed with the label
    // they saw, bare name included.
    const firstShowing = revealed && !shownOf(db, id);
    if (revealed) db.prepare('UPDATE token SET shown = 1 WHERE id = ?').run(id);
    const renamed =
      firstShowing && fields.label === undefined && before.label === before.asset.name
        ? numberAs(db, before.scene_id, { id: before.asset_id, name: before.asset.name }, id)
        : undefined;
    return {
      outcome: 'updated',
      before,
      token: readToken(db, id)!,
      relabelled: renamed ? [readToken(db, renamed)!] : [],
    };
  })();
}

export type TokenDeleteOutcome =
  | { outcome: 'deleted'; token: SceneToken; shown: boolean }
  | { outcome: 'not_found' }
  | { outcome: 'live' }
  | { outcome: 'not_live' };

/** Deletes a token, answering what it was; its number is not issued again (Q-063). */
export function deleteToken(db: Database.Database, id: string, scope: TokenScope = 'prep'): TokenDeleteOutcome {
  return db.transaction((): TokenDeleteOutcome => {
    const token = readToken(db, id);
    if (token === undefined) return { outcome: 'not_found' };
    const refused = refusal(db, token.scene_id, scope);
    if (refused) return { outcome: refused };
    // Whether players had seen it, for an undo that puts it back (Q-096); never sent to a client.
    const shown = shownOf(db, id);
    db.prepare('DELETE FROM token WHERE id = ?').run(id);
    return { outcome: 'deleted', token, shown };
  })();
}

export type TokenRestoreOutcome =
  | { outcome: 'restored'; token: SceneToken }
  | { outcome: 'not_found' }
  | { outcome: 'asset_not_found' }
  | { outcome: 'live' }
  | { outcome: 'not_live' };

/**
 * Puts a deleted token back exactly as it was: its id, label, position, visibility, stacking
 * order and whether players had seen it (`shown`, Q-096; by default, whether it was visible) (LIV-05, undo of `token.delete`, specs/04-live-sync.md §8, D-117). No number is issued, and
 * none is taken back: its label is the one it had, or the asset's current name if it carried the
 * asset's bare name and the asset was renamed since. Refused when its scene is gone or not in `scope`,
 * or its asset was deleted meanwhile. Each deletion's inverse is taken once, so its id is free; were
 * it not, the primary key would refuse the insert and the transaction roll back.
 */
export function restoreToken(
  db: Database.Database,
  token: SceneToken,
  scope: TokenScope = 'live',
  shown = !token.hidden,
): TokenRestoreOutcome {
  return db.transaction((): TokenRestoreOutcome => {
    if (db.prepare('SELECT count(*) FROM scene WHERE id = ?').pluck().get(token.scene_id) === 0) {
      return { outcome: 'not_found' };
    }
    const refused = refusal(db, token.scene_id, scope);
    if (refused) return { outcome: refused };
    const name = db.prepare('SELECT name FROM asset WHERE id = ?').pluck().get(token.asset_id) as string | undefined;
    if (name === undefined) return { outcome: 'asset_not_found' };
    // A token that carried its asset's bare name carries the asset's name now: an asset renamed since
    // renames its bare-named tokens (D-111), and this one would otherwise keep the old name, which
    // numbering would then take for a label the DM typed (Q-094, LIV-05 review C2).
    const label = token.label === token.asset.name ? name : token.label;
    db.prepare(
      `INSERT INTO token (id, scene_id, asset_id, label, x, y, hidden, z_order, character_id, shown)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      token.id,
      token.scene_id,
      token.asset_id,
      label,
      token.x,
      token.y,
      token.hidden ? 1 : 0,
      token.z_order,
      token.character_id,
      shown ? 1 : 0,
    );
    return { outcome: 'restored', token: readToken(db, token.id)! };
  })();
}
