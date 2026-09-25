import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Campaign, DeletionSummary, Grid, Scene, Session } from '@emberglass/shared';
import { deleteUnreferencedImages, PRESET_COLUMNS, toPreset, type PresetRow } from './images.js';

// Campaigns, sessions and scenes in SQLite (specs/03-domain-model.md §2, §3, §5,
// §6, §7, D-075, D-078). Every read and write names its columns. Identifiers are
// version 4 UUIDs generated here, lowercase (D-038). Sessions within a campaign
// and scenes within a session keep a gap-free `order` from 0: a new one goes
// last, and every reorder, deletion and duplication rewrites the siblings' order
// in two steps, because SQLite checks UNIQUE (parent, "order") row by row.

const CAMPAIGN_COLUMNS = 'id, name, description, rules_version';
const SESSION_COLUMNS = 'id, campaign_id, title, "order", date';
const SCENE_COLUMNS = `id, session_id, name, "order", map_image_id, grid_type, grid_size, grid_offset_x,
  grid_offset_y, grid_visible, grid_feet_per_square, grid_columns, grid_rows`;
const TOKEN_COLUMNS = 'id, scene_id, asset_id, label, x, y, hidden, z_order, character_id';

interface SceneRow {
  id: string;
  session_id: string;
  name: string;
  order: number;
  map_image_id: string | null;
  grid_type: 'square';
  grid_size: number | null;
  grid_offset_x: number;
  grid_offset_y: number;
  grid_visible: 0 | 1;
  grid_feet_per_square: number;
  grid_columns: number;
  grid_rows: number;
}

interface TokenRow {
  id: string;
  scene_id: string;
  asset_id: string;
  label: string;
  x: number;
  y: number;
  hidden: 0 | 1;
  z_order: number;
  character_id: null;
}

const toScene = (row: SceneRow): Scene => ({
  id: row.id,
  session_id: row.session_id,
  name: row.name,
  order: row.order,
  map_image_id: row.map_image_id,
  grid: {
    type: row.grid_type,
    size: row.grid_size,
    offset_x: row.grid_offset_x,
    offset_y: row.grid_offset_y,
    visible: row.grid_visible === 1,
    feet_per_square: row.grid_feet_per_square,
    columns: row.grid_columns,
    rows: row.grid_rows,
  },
});

// The children of a parent that carry an order.
type Ordered = { table: 'session'; parent: 'campaign_id' } | { table: 'scene'; parent: 'session_id' };
const SESSIONS: Ordered = { table: 'session', parent: 'campaign_id' };
const SCENES: Ordered = { table: 'scene', parent: 'session_id' };

function childIds(db: Database.Database, { table, parent }: Ordered, parentId: string): string[] {
  return db.prepare(`SELECT id FROM ${table} WHERE ${parent} = ? ORDER BY "order"`).pluck().all(parentId) as string[];
}

/** Gives `ids`, every child of the parent, the orders 0, 1, 2, … in that sequence. */
function writeOrder(db: Database.Database, { table, parent }: Ordered, parentId: string, ids: readonly string[]): void {
  // Step one moves every child above the highest order in use, step two onto its
  // final place: no row ever lands on an order another row still holds.
  const max = db.prepare(`SELECT max("order") FROM ${table} WHERE ${parent} = ?`).pluck().get(parentId) as
    number | null;
  if (max === null) return;
  const offset = max + 1;
  db.prepare(`UPDATE ${table} SET "order" = "order" + ? WHERE ${parent} = ?`).run(offset, parentId);
  const place = db.prepare(`UPDATE ${table} SET "order" = ? WHERE id = ? AND ${parent} = ?`);
  ids.forEach((id, index) => place.run(index, id, parentId));
}

// Above the highest order in use rather than the count, so that a gap left by
// anything but these functions (a restored or hand-edited database) cannot make
// a new row collide with an existing one.
const nextOrder = (db: Database.Database, { table, parent }: Ordered, parentId: string): number =>
  db.prepare(`SELECT coalesce(max("order") + 1, 0) FROM ${table} WHERE ${parent} = ?`).pluck().get(parentId) as number;

/** Same members in any sequence: a reorder names every child once and nothing else. */
const sameMembers = (current: readonly string[], ids: readonly string[]): boolean =>
  current.length === ids.length && new Set([...current, ...ids]).size === current.length;

// Campaigns

export function listCampaigns(db: Database.Database): Campaign[] {
  // No order is stored for campaigns (specs/03-domain-model.md §1, Q-090); by name, then id.
  return db
    .prepare(`SELECT ${CAMPAIGN_COLUMNS} FROM campaign ORDER BY name COLLATE NOCASE, name, id`)
    .all() as Campaign[];
}

export function readCampaign(db: Database.Database, id: string): Campaign | undefined {
  return db.prepare(`SELECT ${CAMPAIGN_COLUMNS} FROM campaign WHERE id = ?`).get(id) as Campaign | undefined;
}

export function createCampaign(db: Database.Database, fields: { name: string; description?: string }): Campaign {
  const id = randomUUID();
  db.prepare('INSERT INTO campaign (id, name, description) VALUES (?, ?, ?)').run(
    id,
    fields.name,
    fields.description ?? '',
  );
  return readCampaign(db, id)!;
}

export function updateCampaign(
  db: Database.Database,
  id: string,
  fields: { name?: string; description?: string },
): Campaign | undefined {
  db.prepare('UPDATE campaign SET name = coalesce(?, name), description = coalesce(?, description) WHERE id = ?').run(
    fields.name ?? null,
    fields.description ?? null,
    id,
  );
  return readCampaign(db, id);
}

// Sessions

export function listSessions(db: Database.Database, campaignId: string): Session[] {
  return db
    .prepare(`SELECT ${SESSION_COLUMNS} FROM session WHERE campaign_id = ? ORDER BY "order"`)
    .all(campaignId) as Session[];
}

export function readSession(db: Database.Database, id: string): Session | undefined {
  return db.prepare(`SELECT ${SESSION_COLUMNS} FROM session WHERE id = ?`).get(id) as Session | undefined;
}

export function createSession(
  db: Database.Database,
  campaignId: string,
  fields: { title: string; date?: string | null },
): Session {
  const id = randomUUID();
  db.transaction(() => {
    db.prepare('INSERT INTO session (id, campaign_id, title, "order", date) VALUES (?, ?, ?, ?, ?)').run(
      id,
      campaignId,
      fields.title,
      nextOrder(db, SESSIONS, campaignId),
      fields.date ?? null,
    );
  })();
  return readSession(db, id)!;
}

export function updateSession(
  db: Database.Database,
  id: string,
  fields: { title?: string; date?: string | null },
): Session | undefined {
  const setDate = fields.date !== undefined ? 1 : 0;
  db.prepare('UPDATE session SET title = coalesce(?, title), date = CASE WHEN ? THEN ? ELSE date END WHERE id = ?').run(
    fields.title ?? null,
    setDate,
    fields.date ?? null,
    id,
  );
  return readSession(db, id);
}

/** False, changing nothing, unless `ids` names every session of the campaign exactly once. */
export function reorderSessions(db: Database.Database, campaignId: string, ids: readonly string[]): boolean {
  return db.transaction(() => {
    if (!sameMembers(childIds(db, SESSIONS, campaignId), ids)) return false;
    writeOrder(db, SESSIONS, campaignId, ids);
    return true;
  })();
}

// Scenes

export function listScenes(db: Database.Database, sessionId: string): Scene[] {
  const rows = db
    .prepare(`SELECT ${SCENE_COLUMNS} FROM scene WHERE session_id = ? ORDER BY "order"`)
    .all(sessionId) as SceneRow[];
  return rows.map(toScene);
}

export function readScene(db: Database.Database, id: string): Scene | undefined {
  const row = db.prepare(`SELECT ${SCENE_COLUMNS} FROM scene WHERE id = ?`).get(id) as SceneRow | undefined;
  return row && toScene(row);
}

const INSERT_SCENE = `INSERT INTO scene (id, session_id, name, "order", map_image_id, grid_type, grid_size,
  grid_offset_x, grid_offset_y, grid_visible, grid_feet_per_square, grid_columns, grid_rows)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function insertScene(
  db: Database.Database,
  id: string,
  sessionId: string,
  name: string,
  order: number,
  mapImageId: string | null,
  grid: Grid,
): void {
  db.prepare(INSERT_SCENE).run(
    id,
    sessionId,
    name,
    order,
    mapImageId,
    grid.type,
    grid.size,
    grid.offset_x,
    grid.offset_y,
    grid.visible ? 1 : 0,
    grid.feet_per_square,
    grid.columns,
    grid.rows,
  );
}

/**
 * A new scene, last in its session. With a map it copies the image's grid
 * preset (specs/03-domain-model.md §5); without one, or while the image has no
 * preset yet, it takes the stored defaults, 30 × 20 (specs/03-domain-model.md §6).
 * Undefined when the image does not exist.
 */
export function createScene(
  db: Database.Database,
  sessionId: string,
  fields: { name: string; map_image_id?: string | null },
): Scene | undefined {
  const id = randomUUID();
  const mapImageId = fields.map_image_id ?? null;
  const created = db.transaction(() => {
    const order = nextOrder(db, SCENES, sessionId);
    if (mapImageId === null) {
      db.prepare('INSERT INTO scene (id, session_id, name, "order") VALUES (?, ?, ?, ?)').run(
        id,
        sessionId,
        fields.name,
        order,
      );
      return true;
    }
    const preset = db.prepare(`SELECT ${PRESET_COLUMNS} FROM image WHERE id = ?`).get(mapImageId) as
      PresetRow | undefined;
    if (preset === undefined) return false;
    const grid = toPreset(preset);
    if (grid === null) {
      db.prepare('INSERT INTO scene (id, session_id, name, "order", map_image_id) VALUES (?, ?, ?, ?, ?)').run(
        id,
        sessionId,
        fields.name,
        order,
        mapImageId,
      );
      return true;
    }
    insertScene(db, id, sessionId, fields.name, order, mapImageId, grid);
    return true;
  })();
  return created ? readScene(db, id) : undefined;
}

const DEFAULT_GRID_COLUMNS = `grid_type = 'square', grid_size = NULL, grid_offset_x = 0, grid_offset_y = 0,
  grid_visible = 1, grid_feet_per_square = 5, grid_columns = 30, grid_rows = 20`;

export type SceneUpdateOutcome =
  | { outcome: 'updated'; scene: Scene; removedImages: string[] }
  | { outcome: 'not_found' }
  | { outcome: 'image_not_found' };

/**
 * Renames the scene and changes its setup, in one transaction (specs/02-architecture.md §5).
 * A different map image starts the grid again from that image's preset, or from the
 * stored defaults while it has none (specs/03-domain-model.md §5, §6): the grid is in
 * the old map's pixels and means nothing on the new one. Tokens keep their positions,
 * which are in grid units (§4). `visible` then applies. The previous map is deleted
 * when nothing references it any more (§7, Q-002); its files are the caller's to
 * remove. Nothing changes when the scene or the image does not exist.
 */
export function updateScene(
  db: Database.Database,
  id: string,
  fields: { name?: string | undefined; map_image_id?: string | undefined; grid?: { visible: boolean } | undefined },
): SceneUpdateOutcome {
  return db.transaction((): SceneUpdateOutcome => {
    const before = readScene(db, id);
    if (before === undefined) return { outcome: 'not_found' };
    const map = fields.map_image_id;
    let removedImages: string[] = [];
    if (map !== undefined && map !== before.map_image_id) {
      const preset = db.prepare(`SELECT ${PRESET_COLUMNS} FROM image WHERE id = ?`).get(map) as PresetRow | undefined;
      if (preset === undefined) return { outcome: 'image_not_found' };
      const grid = toPreset(preset);
      if (grid === null) {
        db.prepare(`UPDATE scene SET map_image_id = ?, ${DEFAULT_GRID_COLUMNS} WHERE id = ?`).run(map, id);
      } else {
        db.prepare(
          `UPDATE scene SET map_image_id = ?, grid_type = ?, grid_size = ?, grid_offset_x = ?, grid_offset_y = ?,
            grid_visible = ?, grid_feet_per_square = ?, grid_columns = ?, grid_rows = ? WHERE id = ?`,
        ).run(
          map,
          grid.type,
          grid.size,
          grid.offset_x,
          grid.offset_y,
          grid.visible ? 1 : 0,
          grid.feet_per_square,
          grid.columns,
          grid.rows,
          id,
        );
      }
      if (before.map_image_id !== null) removedImages = deleteUnreferencedImages(db, [before.map_image_id]);
    }
    if (fields.name !== undefined) db.prepare('UPDATE scene SET name = ? WHERE id = ?').run(fields.name, id);
    if (fields.grid !== undefined) {
      db.prepare('UPDATE scene SET grid_visible = ? WHERE id = ?').run(fields.grid.visible ? 1 : 0, id);
    }
    return { outcome: 'updated', scene: readScene(db, id)!, removedImages };
  })();
}

/** False, changing nothing, unless `ids` names every scene of the session exactly once. */
export function reorderScenes(db: Database.Database, sessionId: string, ids: readonly string[]): boolean {
  return db.transaction(() => {
    if (!sameMembers(childIds(db, SCENES, sessionId), ids)) return false;
    writeOrder(db, SCENES, sessionId, ids);
    return true;
  })();
}

/**
 * A copy of the scene, right after it in its session, with its own copy of
 * every token under new identifiers (specs/03-domain-model.md §7). The grid is
 * the scene's own, not its image's preset.
 */
export function duplicateScene(db: Database.Database, id: string, name: string): Scene | undefined {
  const copyId = randomUUID();
  const done = db.transaction(() => {
    const original = readScene(db, id);
    if (original === undefined) return false;
    const siblings = childIds(db, SCENES, original.session_id);
    insertScene(
      db,
      copyId,
      original.session_id,
      name,
      nextOrder(db, SCENES, original.session_id),
      original.map_image_id,
      original.grid,
    );
    siblings.splice(siblings.indexOf(id) + 1, 0, copyId);
    writeOrder(db, SCENES, original.session_id, siblings);
    const tokens = db
      .prepare(`SELECT ${TOKEN_COLUMNS} FROM token WHERE scene_id = ? ORDER BY z_order, id`)
      .all(id) as TokenRow[];
    const insert = db.prepare(`INSERT INTO token (${TOKEN_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const token of tokens) {
      insert.run(
        randomUUID(),
        copyId,
        token.asset_id,
        token.label,
        token.x,
        token.y,
        token.hidden,
        token.z_order,
        token.character_id,
      );
    }
    return true;
  })();
  return done ? readScene(db, copyId) : undefined;
}

// Deletion (specs/03-domain-model.md §7). The foreign keys of migration 0001
// cascade to sessions, scenes and tokens and clear `settings.live_scene_id`;
// what is removed is counted first, so that the DM confirms exactly that. A map
// image that no asset and no scene references afterwards goes in the same
// transaction (Q-002, G-013); its files are the caller's to remove.

const liveSceneId = (db: Database.Database): string | null =>
  db.prepare('SELECT live_scene_id FROM settings').pluck().get() as string | null;

export type DeletionTarget = 'campaign' | 'session' | 'scene';

// The scenes a deletion removes, as a subquery over one bound parameter.
const SCENES_OF: Record<DeletionTarget, string> = {
  campaign: 'SELECT scene.id FROM scene JOIN session ON session.id = scene.session_id WHERE session.campaign_id = ?',
  session: 'SELECT id FROM scene WHERE session_id = ?',
  scene: 'SELECT id FROM scene WHERE id = ?',
};

const EXISTS: Record<DeletionTarget, string> = {
  campaign: 'SELECT count(*) FROM campaign WHERE id = ?',
  session: 'SELECT count(*) FROM session WHERE id = ?',
  scene: 'SELECT count(*) FROM scene WHERE id = ?',
};

/** What deleting the entity removes, itself included; undefined when it does not exist. */
export function deletionSummary(
  db: Database.Database,
  target: DeletionTarget,
  id: string,
): DeletionSummary | undefined {
  if ((db.prepare(EXISTS[target]).pluck().get(id) as number) === 0) return undefined;
  const scenes = db.prepare(SCENES_OF[target]).pluck().all(id) as string[];
  const sessions =
    target === 'campaign'
      ? (db.prepare('SELECT count(*) FROM session WHERE campaign_id = ?').pluck().get(id) as number)
      : target === 'session'
        ? 1
        : 0;
  const tokens = db
    .prepare(`SELECT count(*) FROM token WHERE scene_id IN (${SCENES_OF[target]})`)
    .pluck()
    .get(id) as number;
  const live = liveSceneId(db);
  return { sessions, scenes: scenes.length, tokens, live: live !== null && scenes.includes(live) };
}

export type DeletionOutcome =
  { outcome: 'deleted'; removedImages: string[] } | { outcome: 'not_found' } | { outcome: 'mismatch' };

const sameSummary = (a: DeletionSummary, b: DeletionSummary): boolean =>
  a.sessions === b.sessions && a.scenes === b.scenes && a.tokens === b.tokens && a.live === b.live;

/**
 * Deletes the entity and everything under it, only if `confirmed` is still what
 * the deletion removes; otherwise changes nothing. The siblings of a deleted
 * session or scene close the gap it leaves. `removedImages` are the map images
 * deleted with it because nothing references them any more.
 */
export function deleteEntity(
  db: Database.Database,
  target: DeletionTarget,
  id: string,
  confirmed: DeletionSummary,
): DeletionOutcome {
  return db.transaction((): DeletionOutcome => {
    const summary = deletionSummary(db, target, id);
    if (summary === undefined) return { outcome: 'not_found' };
    if (!sameSummary(summary, confirmed)) return { outcome: 'mismatch' };
    const maps = db
      .prepare(
        `SELECT DISTINCT map_image_id FROM scene WHERE id IN (${SCENES_OF[target]}) AND map_image_id IS NOT NULL`,
      )
      .pluck()
      .all(id) as string[];
    if (target === 'campaign') {
      db.prepare('DELETE FROM campaign WHERE id = ?').run(id);
    } else if (target === 'session') {
      const { campaign_id } = readSession(db, id)!;
      db.prepare('DELETE FROM session WHERE id = ?').run(id);
      writeOrder(db, SESSIONS, campaign_id, childIds(db, SESSIONS, campaign_id));
    } else {
      const { session_id } = readScene(db, id)!;
      db.prepare('DELETE FROM scene WHERE id = ?').run(id);
      writeOrder(db, SCENES, session_id, childIds(db, SCENES, session_id));
    }
    return { outcome: 'deleted', removedImages: deleteUnreferencedImages(db, maps) };
  })();
}
