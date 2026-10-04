import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  hpChanged,
  markersForHp,
  nextLabel,
  normaliseMarkers,
  statsFromAsset,
  withStats,
  numberingPeers,
  type AssetCategory,
  type SceneToken,
  type TokenMarker,
  type TokenSize,
  type TokenStats,
  type Encounter,
  type TokenStack,
} from '@emberglass/shared';
import { dropEntriesOf } from './encounters.js';
import { sightOf } from './fog.js';
import { refusal, type TokenScope } from './scope.js';

// Tokens of a scene in SQLite (PRP-04, specs/03-domain-model.md §1, §2, §4,
// specs/05-assets-and-images.md §2–§5, specs/04-live-sync.md §2, D-019, Q-063, Q-091). Every
// read and write names its columns. A token holds only its own state (position, visibility,
// label, stacking order, condition markers); its name, image, size and category are its asset's and are
// read by joining it. Markers are stored as a JSON array of objects, each condition once, in the order the DM
// applied them (TBL-05, D-157).
// Hit points and armour class (DMT-01, specs/03-domain-model.md §9, specs/04-live-sync.md §15): a token placed
// from an asset starts with the asset's defaults, at full hit points; every write that changes a token's hit
// points sets the markers they drive (`markersForHp`) in the same transaction, unless it gives the markers itself,
// as an undo that puts both back does.
// Positions are decimal grid units and are stored exactly as sent. Every write names the scope it
// is for, checked inside the transaction that would change the token: preparation (REST) is refused
// on the live scene, whose tokens change only by the live commands, and a live command is refused
// on any scene that is not live (LIV-02, specs/04-live-sync.md §2, D-100).
//
// Numbering follows what players see (TBL-03, Q-092, Q-096): a token is numbered, and marked shown, the
// first time players can see it, not hidden and under no fogged region, whatever made it so: a placement,
// a reveal, a move out of the fog or the fog lifted. `showNewlySeen` does it after every write, so a token
// placed visible inside the fog renames no sibling players see until they can see it too.

const COLUMNS = `token.id, token.scene_id, token.asset_id, token.label, token.x, token.y, token.hidden,
  token.z_order, token.markers, token.character_id, token.hp_current, token.hp_max, token.hp_temp, token.ac,
  asset.name AS asset_name, asset.image_id AS asset_image_id,
  asset.size AS asset_size, asset.category AS asset_category`;
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
  markers: string;
  character_id: null;
  hp_current: number | null;
  hp_max: number | null;
  hp_temp: number | null;
  ac: number | null;
  asset_name: string;
  asset_image_id: string;
  asset_size: TokenSize;
  asset_category: AssetCategory;
}

/** The markers given, each condition once, in the order given; anything else is dropped (D-157). */
export const markersOf = (markers: readonly unknown[]): TokenMarker[] => normaliseMarkers(markers);

const toToken = (row: Row): SceneToken => ({
  id: row.id,
  scene_id: row.scene_id,
  asset_id: row.asset_id,
  label: row.label,
  x: row.x,
  y: row.y,
  hidden: row.hidden === 1,
  z_order: row.z_order,
  markers: markersOf(JSON.parse(row.markers) as unknown[]),
  character_id: row.character_id,
  hp_current: row.hp_current,
  hp_max: row.hp_max,
  hp_temp: row.hp_temp,
  ac: row.ac,
  asset: { name: row.asset_name, image_id: row.asset_image_id, size: row.asset_size, category: row.asset_category },
});

/** Whether players have seen the token (Q-096); kept out of SceneToken, which clients receive. */
const shownOf = (db: Database.Database, id: string): boolean =>
  db.prepare('SELECT shown FROM token WHERE id = ?').pluck().get(id) === 1;

export type { TokenScope };

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
  // Players' view of the others: one they cannot see is as a hidden one (TBL-03).
  const seen = sightOf(db, sceneId);
  const others = (listTokens(db, sceneId) ?? [])
    .filter((token) => token.asset_id === asset.id && token.id !== id)
    .map((token) => ({ id: token.id, label: token.label, hidden: !seen(token) }));
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
 * Marks shown every token of the scene players can see now and had never seen, numbering each that still
 * carries its asset's bare name, bottom of the stack first (Q-092, Q-096, TBL-03), except those in
 * `keepLabel`, whose label the same change gave. Answers each token numbered, with the lone bare-named
 * token its number renamed "<name> 1", if any. The caller's transaction holds it all.
 */
export function showNewlySeen(
  db: Database.Database,
  sceneId: string,
  keepLabel: ReadonlySet<string> = new Set(),
): { id: string; relabel: string | undefined }[] {
  const seen = sightOf(db, sceneId);
  const numbered: { id: string; relabel: string | undefined }[] = [];
  for (const token of listTokens(db, sceneId) ?? []) {
    if (!seen(token) || shownOf(db, token.id)) continue;
    db.prepare('UPDATE token SET shown = 1 WHERE id = ?').run(token.id);
    // Read again: numbering an earlier one may have renamed this one "<name> 1" already.
    const now = readToken(db, token.id)!;
    if (keepLabel.has(token.id) || now.label !== now.asset.name) continue;
    numbered.push({
      id: token.id,
      relabel: numberAs(db, sceneId, { id: now.asset_id, name: now.asset.name }, token.id),
    });
  }
  return numbered;
}

/** The ids of the tokens whose label a numbering pass changed, other than `except`. */
const renamedBy = (numbered: readonly { id: string; relabel: string | undefined }[], except: string): string[] =>
  [...new Set(numbered.flatMap(({ id, relabel }) => (relabel === undefined ? [id] : [id, relabel])))].filter(
    (each) => each !== except,
  );

/**
 * Places a token of the asset at (x, y), on top of the scene's other tokens. It starts hidden
 * when its asset's `default_hidden` is set (specs/05-assets-and-images.md §4): then it takes the
 * bare name and no number, which it gets when players first see it (Q-092, TBL-03); a visible one is
 * numbered at once, unless it is placed under the fog.
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
    const asset = db.prepare('SELECT name, default_hidden, hp_max, ac FROM asset WHERE id = ?').get(fields.asset_id) as
      { name: string; default_hidden: 0 | 1; hp_max: number | null; ac: number | null } | undefined;
    if (asset === undefined) return { outcome: 'asset_not_found' };
    const top = db.prepare('SELECT max(z_order) FROM token WHERE scene_id = ?').pluck().get(sceneId) as number | null;
    // The asset's defaults, copied: a later change of them changes no token (D-181).
    const stats = statsFromAsset(asset);
    db.prepare(
      `INSERT INTO token (id, scene_id, asset_id, label, x, y, hidden, z_order, shown, hp_current, hp_max, hp_temp, ac)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      sceneId,
      fields.asset_id,
      asset.name,
      fields.x,
      fields.y,
      asset.default_hidden,
      (top ?? -1) + 1,
      // Shown, and numbered, by the pass below when players can see it (Q-096, TBL-03).
      0,
      stats.hp_current,
      stats.hp_max,
      stats.hp_temp,
      stats.ac,
    );
    // Numbered first, then read: the token's own label may be the one that changes.
    const renamed = renamedBy(showNewlySeen(db, sceneId), id);
    return { outcome: 'created', token: readToken(db, id)!, relabelled: renamed.map((each) => readToken(db, each)!) };
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
 * Moves, hides or reveals, relabels, restacks, marks a token or sets its hit points and armour class; in
 * preparation, of a scene that is not live, and by a live command (only a move, a visibility change, the
 * markers or the hit points and armour class, specs/04-live-sync.md §2), of the live scene. `stack`
 * puts it above (`front`) or below (`back`) every other token of the scene, unless it already is.
 * Revealing a token that still carries its asset's bare name numbers it (Q-092), unless the same
 * change gives it a label or players have seen it before (Q-096); hiding one keeps its label.
 */
export function updateToken(
  db: Database.Database,
  id: string,
  fields: {
    x?: number;
    y?: number;
    hidden?: boolean;
    label?: string;
    stack?: TokenStack;
    markers?: readonly TokenMarker[];
  } & Partial<TokenStats>,
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
    // Hit points and armour class given set over the token's; a change of hit points sets the markers they drive,
    // unless the same change gives the markers (DMT-01, specs/04-live-sync.md §15).
    const stats = withStats(before, {
      ...(fields.hp_current === undefined ? {} : { hp_current: fields.hp_current }),
      ...(fields.hp_max === undefined ? {} : { hp_max: fields.hp_max }),
      ...(fields.hp_temp === undefined ? {} : { hp_temp: fields.hp_temp }),
      ...(fields.ac === undefined ? {} : { ac: fields.ac }),
    });
    const markers =
      fields.markers ??
      (hpChanged(before, stats) ? markersForHp(before.asset.category, stats, before.markers) : before.markers);
    db.prepare(
      `UPDATE token SET x = ?, y = ?, hidden = ?, label = ?, z_order = ?, markers = ?,
         hp_current = ?, hp_max = ?, hp_temp = ?, ac = ? WHERE id = ?`,
    ).run(
      fields.x ?? before.x,
      fields.y ?? before.y,
      (fields.hidden ?? before.hidden) ? 1 : 0,
      fields.label ?? before.label,
      z,
      JSON.stringify(markersOf(markers)),
      stats.hp_current,
      stats.hp_max,
      stats.hp_temp,
      stats.ac,
      id,
    );
    // Numbered only at its first showing (Q-096): a token players saw is revealed with the label
    // they saw, bare name included; one given a label by the same change keeps it. A move out of the fog
    // is a first showing too (TBL-03).
    const numbered = showNewlySeen(db, before.scene_id, fields.label === undefined ? new Set() : new Set([id]));
    return {
      outcome: 'updated',
      before,
      token: readToken(db, id)!,
      relabelled: renamedBy(numbered, id).map((each) => readToken(db, each)!),
    };
  })();
}

export type TokenDeleteOutcome =
  // `encounter`: the scene's encounter before and after the token's entry went, when it had one (TBL-06).
  | { outcome: 'deleted'; token: SceneToken; shown: boolean; encounter?: { before: Encounter; encounter: Encounter } }
  | { outcome: 'not_found' }
  | { outcome: 'live' }
  | { outcome: 'not_live' };

/**
 * Deletes a token, answering what it was; its number is not issued again (Q-063). Its initiative entry goes
 * with it, in the same transaction, whatever the scope (TBL-06, specs/03-domain-model.md §7).
 */
export function deleteToken(db: Database.Database, id: string, scope: TokenScope = 'prep'): TokenDeleteOutcome {
  return db.transaction((): TokenDeleteOutcome => {
    const token = readToken(db, id);
    if (token === undefined) return { outcome: 'not_found' };
    const refused = refusal(db, token.scene_id, scope);
    if (refused) return { outcome: refused };
    // Whether players had seen it, for an undo that puts it back (Q-096); never sent to a client.
    const shown = shownOf(db, id);
    db.prepare('DELETE FROM token WHERE id = ?').run(id);
    const encounter = dropEntriesOf(db, token.scene_id, id);
    return encounter === undefined
      ? { outcome: 'deleted', token, shown }
      : { outcome: 'deleted', token, shown, encounter };
  })();
}

export type TokenRestoreOutcome =
  | { outcome: 'restored'; token: SceneToken; relabelled: SceneToken[] }
  | { outcome: 'not_found' }
  | { outcome: 'asset_not_found' }
  | { outcome: 'live' }
  | { outcome: 'not_live' };

/**
 * Puts a deleted token back exactly as it was: its id, label, position, visibility, stacking
 * order, markers and whether players had seen it (`shown`, Q-096; by default, whether it was visible) (LIV-05, undo of `token.delete`, specs/04-live-sync.md §8, D-117). No number is issued, and
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
      `INSERT INTO token (id, scene_id, asset_id, label, x, y, hidden, z_order, markers, character_id, shown,
         hp_current, hp_max, hp_temp, ac)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      token.id,
      token.scene_id,
      token.asset_id,
      label,
      token.x,
      token.y,
      token.hidden ? 1 : 0,
      token.z_order,
      JSON.stringify(markersOf(token.markers)),
      token.character_id,
      shown ? 1 : 0,
      token.hp_current,
      token.hp_max,
      token.hp_temp,
      token.ac,
    );
    // Put back where players can see it though they never did (the fog lifted meanwhile): numbered as at
    // a first showing (TBL-03).
    const renamed = renamedBy(showNewlySeen(db, token.scene_id), token.id);
    return {
      outcome: 'restored',
      token: readToken(db, token.id)!,
      relabelled: renamed.map((each) => readToken(db, each)!),
    };
  })();
}
