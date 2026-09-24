import type Database from 'better-sqlite3';
import type { GridPreset, Image, ImageMime, ImageVariants } from '@emberglass/shared';

// Images in SQLite (specs/03-domain-model.md §1, §3, §5, §7, D-075, D-080). The id is
// the lowercase hex sha256 of the original bytes; the preset is stored as eight
// `grid_preset_*` columns, wholly absent or wholly present (a CHECK of migration 0001),
// and nested here. Every read and write names its columns.

export const PRESET_COLUMNS = `grid_preset_type, grid_preset_size, grid_preset_offset_x, grid_preset_offset_y,
  grid_preset_visible, grid_preset_feet_per_square, grid_preset_columns, grid_preset_rows`;
const IMAGE_COLUMNS = `id, mime, width, height, variants, ${PRESET_COLUMNS}`;

export interface PresetRow {
  grid_preset_type: 'square' | null;
  grid_preset_size: number | null;
  grid_preset_offset_x: number | null;
  grid_preset_offset_y: number | null;
  grid_preset_visible: 0 | 1 | null;
  grid_preset_feet_per_square: number | null;
  grid_preset_columns: number | null;
  grid_preset_rows: number | null;
}

interface ImageRow extends PresetRow {
  id: string;
  mime: ImageMime;
  width: number;
  height: number;
  variants: string;
}

/** The preset of a row, or null while the image has none. */
export function toPreset(row: PresetRow): GridPreset | null {
  if (row.grid_preset_type === null) return null;
  return {
    type: row.grid_preset_type,
    size: row.grid_preset_size!,
    offset_x: row.grid_preset_offset_x!,
    offset_y: row.grid_preset_offset_y!,
    visible: row.grid_preset_visible === 1,
    feet_per_square: row.grid_preset_feet_per_square!,
    columns: row.grid_preset_columns!,
    rows: row.grid_preset_rows!,
  };
}

const toImage = (row: ImageRow): Image => ({
  id: row.id,
  mime: row.mime,
  width: row.width,
  height: row.height,
  variants: JSON.parse(row.variants) as ImageVariants,
  grid_preset: toPreset(row),
});

export function readImage(db: Database.Database, id: string): Image | undefined {
  const row = db.prepare(`SELECT ${IMAGE_COLUMNS} FROM image WHERE id = ?`).get(id) as ImageRow | undefined;
  return row && toImage(row);
}

export function imageExists(db: Database.Database, id: string): boolean {
  return db.prepare('SELECT count(*) FROM image WHERE id = ?').pluck().get(id) === 1;
}

export function listImageIds(db: Database.Database): string[] {
  return db.prepare('SELECT id FROM image ORDER BY id').pluck().all() as string[];
}

/** A new image, without a preset until the DM calibrates a scene of it. */
export function insertImage(
  db: Database.Database,
  image: { id: string; mime: ImageMime; width: number; height: number; variants: ImageVariants },
): Image {
  db.prepare('INSERT INTO image (id, mime, width, height, variants) VALUES (?, ?, ?, ?, ?)').run(
    image.id,
    image.mime,
    image.width,
    image.height,
    JSON.stringify(image.variants),
  );
  return readImage(db, image.id)!;
}

/** Replaces the preset later scenes of the image copy; existing scenes keep their own grid. */
export function updateGridPreset(db: Database.Database, id: string, preset: GridPreset): Image | undefined {
  db.prepare(
    `UPDATE image SET grid_preset_type = ?, grid_preset_size = ?, grid_preset_offset_x = ?, grid_preset_offset_y = ?,
      grid_preset_visible = ?, grid_preset_feet_per_square = ?, grid_preset_columns = ?, grid_preset_rows = ?
      WHERE id = ?`,
  ).run(
    preset.type,
    preset.size,
    preset.offset_x,
    preset.offset_y,
    preset.visible ? 1 : 0,
    preset.feet_per_square,
    preset.columns,
    preset.rows,
    id,
  );
  return readImage(db, id);
}

/** Records a regenerated display version; false when the image is gone meanwhile. */
export function setDisplayVariant(
  db: Database.Database,
  id: string,
  display: { width: number; height: number },
): boolean {
  return (
    db
      .prepare("UPDATE image SET variants = json_set(variants, '$.display', json(?)) WHERE id = ?")
      .run(JSON.stringify(display), id).changes === 1
  );
}

/**
 * Deletes each of `ids` that no asset and no scene references any more, with its
 * preset, which lives in the same row (specs/03-domain-model.md §7, Q-002). Returns
 * the ids deleted, whose files the caller removes once the transaction commits.
 */
export function deleteUnreferencedImages(db: Database.Database, ids: Iterable<string>): string[] {
  const remove = db.prepare(
    `DELETE FROM image WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM asset WHERE image_id = image.id)
      AND NOT EXISTS (SELECT 1 FROM scene WHERE map_image_id = image.id)`,
  );
  return [...new Set(ids)].filter((id) => remove.run(id).changes === 1);
}

/**
 * Deletes every image that no asset and no scene references, preset included: at start-up,
 * before any upload can be in flight, this removes the uploads a DM abandoned before
 * creating the asset or the scene they were for (G-016, D-084). Returns the ids deleted.
 */
export function deleteAllUnreferencedImages(db: Database.Database): string[] {
  return db.transaction(() =>
    deleteUnreferencedImages(db, db.prepare('SELECT id FROM image ORDER BY id').pluck().all() as string[]),
  )();
}
