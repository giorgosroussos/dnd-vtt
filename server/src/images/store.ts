import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type Database from 'better-sqlite3';
import sharp, { type Sharp } from 'sharp';
import { THUMBNAIL_SIZE, type Image, type ImageMime, type ImageVariant } from '@emberglass/shared';
import {
  deleteAllUnreferencedImages,
  imageExists,
  insertImage,
  listImageIds,
  readImage,
  setDisplayVariant,
} from '../db/images.js';
import { SHARP_FORMAT, SNIFF_BYTES, sniff, type Sniffed } from './detect.js';

// The image upload pipeline (specs/05-assets-and-images.md §6, §7, specs/03-domain-model.md §3,
// §7, D-021, D-032, D-044, D-080). Each image has a folder in the images folder of the data
// directory, named by the sha256 of its original, holding the three versions. An upload is
// received into its own folder under `.incoming`, checked and processed there, and moved into
// place with one rename only when everything succeeded, so a refusal or a failure midway leaves
// no file and no row. Moving into place and writing the row happen in one synchronous step, as
// does removing a row and its files, so no other request can interleave with either.

// libvips keeps recently opened files open for reuse, and on Windows an open file can be neither
// renamed nor removed.
sharp.cache(false);

export const IMAGES_DIR = 'images';
const INCOMING_DIR = '.incoming';
const SHA256 = /^[0-9a-f]{64}$/;
// The largest width or height a WebP image can have.
const WEBP_MAX_EDGE = 16_383;

const VARIANT_FILES: Record<ImageVariant, string> = {
  original: 'original',
  display: 'display.webp',
  thumbnail: 'thumbnail.webp',
};

export function imagesDirOf(dataDir: string): string {
  return path.join(dataDir, IMAGES_DIR);
}

export function imageFilePath(imagesDir: string, id: string, variant: ImageVariant): string {
  return path.join(imagesDir, id, VARIANT_FILES[variant]);
}

/** Why an upload is refused: its type (415) or its size (413), with a diagnostic that names it. */
export class UploadRejected extends Error {
  constructor(
    readonly reason: 'type' | 'size',
    readonly detail: string,
  ) {
    super(`upload refused: ${reason}`);
  }
}

const typeRefused = (sniffed: Extract<Sniffed, { accepted: false }>): UploadRejected =>
  new UploadRejected('type', `detected type: ${sniffed.type}`);
const corrupt = (mime: ImageMime): UploadRejected =>
  new UploadRejected('type', `detected type: ${mime}, incomplete or corrupt`);
const overLimit = (limit: number): UploadRejected => new UploadRejected('size', `limit: ${limit} bytes`);

/**
 * Creates the images folder and empties `.incoming`, where uploads that a stop or a crash
 * interrupted are left; deletes every image that nothing references, an upload abandoned
 * before its asset or scene was created (G-016, D-084); then removes each image folder
 * without a row, theirs and those a crash left between removing a row and its files.
 * Returns the ids of the images deleted and of the other folders removed.
 */
export function prepareImagesDir(
  db: Database.Database,
  imagesDir: string,
): { unreferenced: string[]; orphans: string[] } {
  mkdirSync(imagesDir, { recursive: true });
  rmSync(path.join(imagesDir, INCOMING_DIR), { recursive: true, force: true });
  mkdirSync(path.join(imagesDir, INCOMING_DIR));
  const unreferenced = deleteAllUnreferencedImages(db);
  const swept = new Set(unreferenced);
  const orphans: string[] = [];
  for (const entry of readdirSync(imagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !SHA256.test(entry.name) || imageExists(db, entry.name)) continue;
    rmSync(path.join(imagesDir, entry.name), { recursive: true, force: true });
    if (!swept.has(entry.name)) orphans.push(entry.name);
  }
  return { unreferenced, orphans };
}

/**
 * Writes `body` to `file` while hashing it, and stops receiving as soon as it is over `limit`
 * bytes or its first bytes are not an accepted type (D-044): nothing more is read, so an
 * oversized upload never reaches the disk beyond the limit, nor memory at all.
 */
function receive(body: Readable, file: string, limit: number): Promise<{ sha256: string; mime: ImageMime }> {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(file, { flags: 'wx' });
    const hash = createHash('sha256');
    let size = 0;
    let head = Buffer.alloc(0);
    let sniffed: Sniffed | undefined;
    let settled = false;

    const detach = (): void => {
      settled = true;
      body.off('data', onData);
      body.off('end', onEnd);
      body.off('error', stop);
      body.off('close', onClose);
      body.pause();
    };
    // The file is closed before the promise settles, so that its folder can be removed at once.
    const stop = (error: Error): void => {
      if (settled) return;
      detach();
      if (out.closed) reject(error);
      else {
        out.once('close', () => reject(error));
        out.destroy();
      }
    };
    const refusal = (found: Sniffed): UploadRejected | undefined => (found.accepted ? undefined : typeRefused(found));

    function onData(chunk: Buffer): void {
      size += chunk.length;
      if (size > limit) return stop(overLimit(limit));
      if (sniffed === undefined) {
        head = Buffer.concat([head, chunk.subarray(0, SNIFF_BYTES - head.length)]);
        if (head.length >= SNIFF_BYTES) {
          sniffed = sniff(head);
          const refused = refusal(sniffed);
          if (refused) return stop(refused);
        }
      }
      hash.update(chunk);
      if (!out.write(chunk)) {
        body.pause();
        out.once('drain', () => {
          if (!settled) body.resume();
        });
      }
    }
    function onEnd(): void {
      sniffed ??= sniff(head);
      const refused = refusal(sniffed);
      if (refused) return stop(refused);
      const { mime } = sniffed as Extract<Sniffed, { accepted: true }>;
      detach();
      out.once('close', () => resolve({ sha256: hash.digest('hex'), mime }));
      out.end();
    }
    // A client that goes away midway: the body closes without ending.
    function onClose(): void {
      stop(new Error('the upload ended before its body was complete'));
    }

    out.on('error', stop);
    body.on('data', onData);
    body.once('end', onEnd);
    body.on('error', stop);
    body.once('close', onClose);
    body.resume();
  });
}

const decoder = (file: string): Sharp => sharp(file, { failOn: 'error' });

/** The display version's long edge: the setting, within what WebP can store. */
const displayEdge = (displaySize: number): number => Math.min(displaySize, WEBP_MAX_EDGE);

/** A WebP version of `original`, auto-oriented, its long edge at most `edge` and never upscaled. */
async function writeVersion(
  original: string,
  edge: number,
  target: string,
): Promise<{ width: number; height: number }> {
  const { width, height } = await decoder(original)
    .rotate()
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .webp()
    .toFile(target);
  return { width, height };
}

/**
 * Checks that the whole file decodes as the type its first bytes claim, then writes the display
 * version and the thumbnail beside it. Only the check can refuse the upload: a failure while
 * writing the versions (a full disk) is the server's, and answers 500 rather than blaming the
 * file. Width and height are the image as shown, after its orientation, which is what
 * calibration measures.
 */
async function processUpload(
  staged: string,
  mime: ImageMime,
  displaySize: number,
): Promise<{ width: number; height: number; variants: Image['variants'] }> {
  const original = path.join(staged, VARIANT_FILES.original);
  let shown: { width: number; height: number };
  try {
    const meta = await decoder(original).metadata();
    if (meta.format !== SHARP_FORMAT[mime]) throw corrupt(mime);
    // A full decode to a few numbers: what refuses a truncated file.
    await decoder(original).stats();
    shown = meta.autoOrient;
  } catch (error) {
    if (error instanceof UploadRejected) throw error;
    // sharp refuses an image above its pixel limit (about 16,384 × 16,384) before decoding it.
    if (error instanceof Error && /pixel limit/i.test(error.message)) {
      throw new UploadRejected('size', 'the image has more pixels than the server decodes');
    }
    throw corrupt(mime);
  }
  const display = await writeVersion(original, displayEdge(displaySize), path.join(staged, VARIANT_FILES.display));
  const thumbnail = await writeVersion(original, THUMBNAIL_SIZE, path.join(staged, VARIANT_FILES.thumbnail));
  return { ...shown, variants: { display, thumbnail } };
}

export interface StoredUpload {
  image: Image;
  /** False when the same bytes were stored already: nothing was written. */
  created: boolean;
}

/**
 * Receives, checks, processes and stores one upload (specs/05-assets-and-images.md §6, §7).
 * Throws UploadRejected for a refused type or size; in every failure the staged folder is
 * removed and nothing reaches the images folder or the database.
 */
export async function storeUpload(
  db: Database.Database,
  imagesDir: string,
  body: Readable,
  options: { limit: number; displaySize: number },
): Promise<StoredUpload> {
  const staged = path.join(imagesDir, INCOMING_DIR, randomUUID());
  mkdirSync(staged, { recursive: true });
  try {
    const { sha256, mime } = await receive(body, path.join(staged, VARIANT_FILES.original), options.limit);
    const stored = readImage(db, sha256);
    if (stored) return { image: stored, created: false };
    const processed = await processUpload(staged, mime, options.displaySize);
    // From here to the end, synchronous: the same bytes may have been stored by a parallel
    // upload while this one was processed.
    const meanwhile = readImage(db, sha256);
    if (meanwhile) return { image: meanwhile, created: false };
    const target = path.join(imagesDir, sha256);
    rmSync(target, { recursive: true, force: true });
    renameSync(staged, target);
    try {
      return { image: insertImage(db, { id: sha256, mime, ...processed }), created: true };
    } catch (error) {
      rmSync(target, { recursive: true, force: true });
      throw error;
    }
  } finally {
    // Already gone once moved into place.
    rmSync(staged, { recursive: true, force: true });
  }
}

/**
 * Removes the folders of images whose rows were deleted. Returns the ids whose folder could not
 * be removed (a file held open on Windows); the next start removes them (prepareImagesDir).
 */
export function removeImageFiles(imagesDir: string, ids: readonly string[]): string[] {
  const failed: string[] = [];
  for (const id of ids) {
    try {
      rmSync(path.join(imagesDir, id), { recursive: true, force: true });
    } catch {
      failed.push(id);
    }
  }
  return failed;
}

/**
 * Writes every image's display version again at `displaySize`, one image at a time, after the
 * setting changed (specs/05-assets-and-images.md §7, D-021). The settings screen (REL-01) runs
 * it without waiting; an image deleted meanwhile is skipped. Returns what was regenerated and
 * what failed, which keeps its previous display version.
 */
export async function regenerateDisplayVersions(
  db: Database.Database,
  imagesDir: string,
  displaySize: number,
): Promise<{ regenerated: string[]; failed: string[] }> {
  const regenerated: string[] = [];
  const failed: string[] = [];
  for (const id of listImageIds(db)) {
    const staged = path.join(imagesDir, INCOMING_DIR, `${randomUUID()}.webp`);
    try {
      const display = await writeVersion(imageFilePath(imagesDir, id, 'original'), displayEdge(displaySize), staged);
      // Synchronous from here: a deletion cannot interleave.
      if (!imageExists(db, id)) continue;
      renameSync(staged, imageFilePath(imagesDir, id, 'display'));
      setDisplayVariant(db, id, display);
      regenerated.push(id);
    } catch {
      if (imageExists(db, id)) failed.push(id);
    } finally {
      rmSync(staged, { force: true });
    }
  }
  return { regenerated, failed };
}
