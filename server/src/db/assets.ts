import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  normalizeTag,
  type AssetCategory,
  type AssetUsage,
  type LibraryAsset,
  type TokenSize,
} from '@emberglass/shared';
import { deleteUnreferencedImages, imageExists } from './images.js';
import { forgetTokenNumbers } from './tokens.js';

// The shared asset library in SQLite (specs/03-domain-model.md §1, §2, §7,
// specs/05-assets-and-images.md §1, §4, §5, D-020, D-022, D-075, D-083). Every read
// and write names its columns. Tags arrive here already normalised (`normalizeTag`,
// G-009) and unique; they are stored one row each in `asset_tag`, deleted with their
// asset. A token holds no image of its own: its image is its asset's, so changing
// the asset's image changes every token of it.

const ASSET_COLUMNS = 'id, name, category, image_id, size, default_hidden, notes';

interface AssetRow {
  id: string;
  name: string;
  category: AssetCategory;
  image_id: string;
  size: TokenSize;
  default_hidden: 0 | 1;
  notes: string;
}

const toAsset = (row: AssetRow, tags: string[]): LibraryAsset => ({
  id: row.id,
  name: row.name,
  category: row.category,
  image_id: row.image_id,
  size: row.size,
  default_hidden: row.default_hidden === 1,
  notes: row.notes,
  tags,
});

function tagsOf(db: Database.Database, assetId: string): string[] {
  return db.prepare('SELECT tag FROM asset_tag WHERE asset_id = ? ORDER BY tag').pluck().all(assetId) as string[];
}

export function readAsset(db: Database.Database, id: string): LibraryAsset | undefined {
  const row = db.prepare(`SELECT ${ASSET_COLUMNS} FROM asset WHERE id = ?`).get(id) as AssetRow | undefined;
  return row && toAsset(row, tagsOf(db, id));
}

export interface AssetFilter {
  /** Already normalised; empty for no search. */
  search: string;
  category?: AssetCategory | undefined;
  /** Already normalised; an asset must carry every one. */
  tags: readonly string[];
}

/**
 * The library sorted by name, ignoring case, then by id (specs/05-assets-and-images.md §1,
 * D-022, Q-064). The search is a case-insensitive substring of the name or of a tag. It runs
 * here rather than in SQL, whose `LIKE` and `lower` fold ASCII letters only; a personal
 * library is small.
 */
export function listAssets(db: Database.Database, filter: AssetFilter): LibraryAsset[] {
  const rows = db
    .prepare(`SELECT ${ASSET_COLUMNS} FROM asset ORDER BY name COLLATE NOCASE, name, id`)
    .all() as AssetRow[];
  const tags = new Map<string, string[]>();
  for (const { asset_id, tag } of db.prepare('SELECT asset_id, tag FROM asset_tag ORDER BY tag').all() as {
    asset_id: string;
    tag: string;
  }[]) {
    tags.set(asset_id, [...(tags.get(asset_id) ?? []), tag]);
  }
  return rows
    .map((row) => toAsset(row, tags.get(row.id) ?? []))
    .filter(
      (asset) =>
        (filter.category === undefined || asset.category === filter.category) &&
        filter.tags.every((tag) => asset.tags.includes(tag)) &&
        (filter.search === '' ||
          normalizeTag(asset.name).includes(filter.search) ||
          asset.tags.some((tag) => tag.includes(filter.search))),
    );
}

function writeTags(db: Database.Database, assetId: string, tags: readonly string[]): void {
  const current = new Set(tagsOf(db, assetId));
  const wanted = new Set(tags);
  const remove = db.prepare('DELETE FROM asset_tag WHERE asset_id = ? AND tag = ?');
  for (const tag of current) if (!wanted.has(tag)) remove.run(assetId, tag);
  const insert = db.prepare('INSERT INTO asset_tag (id, asset_id, tag) VALUES (?, ?, ?)');
  for (const tag of wanted) if (!current.has(tag)) insert.run(randomUUID(), assetId, tag);
}

export interface AssetFields {
  name: string;
  image_id: string;
  category: AssetCategory;
  size: TokenSize;
  default_hidden?: boolean | undefined;
  tags: readonly string[];
  notes?: string | undefined;
}

/**
 * A new asset. Left out, `default_hidden` starts from the category: a monster hidden,
 * a pc, npc or object visible (specs/05-assets-and-images.md §4, D-020, Q-045).
 * Undefined, storing nothing, when the image does not exist.
 */
export function createAsset(db: Database.Database, fields: AssetFields): LibraryAsset | undefined {
  const id = randomUUID();
  const created = db.transaction(() => {
    if (!imageExists(db, fields.image_id)) return false;
    db.prepare(`INSERT INTO asset (${ASSET_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      fields.name,
      fields.category,
      fields.image_id,
      fields.size,
      (fields.default_hidden ?? fields.category === 'monster') ? 1 : 0,
      fields.notes ?? '',
    );
    writeTags(db, id, fields.tags);
    return true;
  })();
  return created ? readAsset(db, id) : undefined;
}

export type AssetUpdateOutcome =
  | { outcome: 'updated'; asset: LibraryAsset; removedImages: string[] }
  | { outcome: 'not_found' }
  | { outcome: 'image_not_found' };

/**
 * Changes the given fields; `tags` replaces the whole set. A new image is every token's
 * new image, and the previous one is deleted in the same transaction when nothing
 * references it any more (specs/03-domain-model.md §7, Q-002); `removedImages` are the
 * caller's to remove from disk once this has committed.
 */
export function updateAsset(
  db: Database.Database,
  id: string,
  fields: Partial<Omit<AssetFields, 'tags'>> & { tags?: readonly string[] | undefined },
): AssetUpdateOutcome {
  return db.transaction((): AssetUpdateOutcome => {
    const row = db.prepare('SELECT image_id, name FROM asset WHERE id = ?').get(id) as
      { image_id: string; name: string } | undefined;
    if (row === undefined) return { outcome: 'not_found' };
    const before = row.image_id;
    if (fields.image_id !== undefined && !imageExists(db, fields.image_id)) return { outcome: 'image_not_found' };
    const hidden = fields.default_hidden === undefined ? null : fields.default_hidden ? 1 : 0;
    db.prepare(
      `UPDATE asset SET name = coalesce(?, name), category = coalesce(?, category), image_id = coalesce(?, image_id),
        size = coalesce(?, size), default_hidden = coalesce(?, default_hidden), notes = coalesce(?, notes)
        WHERE id = ?`,
    ).run(
      fields.name ?? null,
      fields.category ?? null,
      fields.image_id ?? null,
      fields.size ?? null,
      hidden,
      fields.notes ?? null,
      id,
    );
    // A token carrying the bare name follows the asset's new name, so that numbering, which knows a
    // never-numbered token by its bare name, still tells it from a label the DM typed and never
    // counts a hidden one (Q-094). Numbered and typed labels are the DM's and stay.
    if (fields.name !== undefined && fields.name !== row.name) {
      db.prepare('UPDATE token SET label = ? WHERE asset_id = ? AND label = ?').run(fields.name, id, row.name);
    }
    if (fields.tags !== undefined) writeTags(db, id, fields.tags);
    const removedImages = fields.image_id !== undefined ? deleteUnreferencedImages(db, [before]) : [];
    return { outcome: 'updated', asset: readAsset(db, id)!, removedImages };
  })();
}

/**
 * Every scene whose tokens use the asset, by campaign name, then session and scene order;
 * undefined when the asset does not exist.
 */
export function assetUsages(db: Database.Database, id: string): AssetUsage[] | undefined {
  if ((db.prepare('SELECT count(*) FROM asset WHERE id = ?').pluck().get(id) as number) === 0) return undefined;
  return db
    .prepare(
      `SELECT scene.id AS scene_id, scene.name AS scene_name, session.id AS session_id,
          session.title AS session_title, campaign.id AS campaign_id, campaign.name AS campaign_name,
          count(token.id) AS tokens
        FROM token
        JOIN scene ON scene.id = token.scene_id
        JOIN session ON session.id = scene.session_id
        JOIN campaign ON campaign.id = session.campaign_id
        WHERE token.asset_id = ?
        GROUP BY scene.id
        ORDER BY campaign.name COLLATE NOCASE, campaign.name, campaign.id, session."order", scene."order"`,
    )
    .all(id) as AssetUsage[];
}

export type AssetDeletionOutcome =
  | { outcome: 'deleted'; removedImages: string[] }
  | { outcome: 'not_found' }
  | { outcome: 'in_use'; usages: AssetUsage[] };

/**
 * Deletes an asset that no token uses, with its tags, the token numbers scenes recorded for it
 * (Q-091), and its image when nothing else references it (specs/03-domain-model.md §7, Q-002). An asset in use is refused with the
 * scenes that use it, changing nothing.
 */
export function deleteAsset(db: Database.Database, id: string): AssetDeletionOutcome {
  return db.transaction((): AssetDeletionOutcome => {
    const usages = assetUsages(db, id);
    if (usages === undefined) return { outcome: 'not_found' };
    if (usages.length > 0) return { outcome: 'in_use', usages };
    const imageId = db.prepare('SELECT image_id FROM asset WHERE id = ?').pluck().get(id) as string;
    db.prepare('DELETE FROM asset WHERE id = ?').run(id);
    forgetTokenNumbers(db, id);
    return { outcome: 'deleted', removedImages: deleteUnreferencedImages(db, [imageId]) };
  })();
}
