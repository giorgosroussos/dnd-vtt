import { open } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import {
  API_IMAGE_PATHS as PATHS,
  GridPresetSchema,
  IMAGE_FILE_PATH,
  IMAGE_VARIANTS,
  ImageIdParamsSchema,
  ImageSchema,
  type GridPreset,
  type ImageIdParams,
  type ImageVariant,
} from '@emberglass/shared';
import { isShownToPlayers, readImage, updateGridPreset } from '../db/images.js';
import { readSettings } from '../db/settings.js';
import { imageFilePath, removeImageFiles, storeUpload, UploadRejected } from '../images/store.js';
import type { Logger } from '../log/logger.js';
import type { Auth } from './auth.js';
import { ApiFailure } from './errors.js';

// Images over REST and their files (SRV-04, specs/02-architecture.md §5, specs/05-assets-and-images.md
// §6, §7, specs/07-security-and-access.md §5, D-021, D-032, D-044, D-080). The /api routes need a
// DM session through the guard of auth.ts, which answers before a body is read. The files at
// /images/<sha256>/<variant> are outside /api and check the session themselves: a DM session
// fetches every version of every image; a request without one only the display version of the
// live scene's map and of its visible tokens' images, read from the database on every request
// (LIV-02, specs/07-security-and-access.md §5, G-020). Every other request is answered not found,
// whether or not the image exists, so a player learns nothing from the answer.

const notFound = (): ApiFailure => new ApiFailure(404, 'not_found', 'No such resource.');
const SHA256 = /^[0-9a-f]{64}$/;
const isVariant = (value: string): value is ImageVariant => (IMAGE_VARIANTS as readonly string[]).includes(value);

// An upload may be refused before its body has arrived. The server answers at once but keeps
// reading the rest and throwing it away, storing and processing none of it: closing the
// connection instead would leave unread data behind, which makes the client's system reset the
// connection (ECONNRESET), and a browser, which reads the answer only after sending its whole
// body, would show a network error instead of the refusal. A body that has not ended after
// DISCARD_MS is cut off (D-082).
export const DISCARD_MS = 30_000;

function discardRest(raw: IncomingMessage): void {
  if (raw.readableEnded || raw.destroyed) return;
  // Destroying the request destroys its connection.
  const timer = setTimeout(() => raw.destroy(), DISCARD_MS);
  timer.unref();
  const done = (): void => clearTimeout(timer);
  raw.once('end', done);
  raw.once('close', done);
  raw.on('data', () => {});
  raw.resume();
}

function refusal(rejected: UploadRejected): ApiFailure {
  const details = [{ path: '', message: rejected.detail }];
  return rejected.reason === 'size'
    ? new ApiFailure(413, 'payload_too_large', 'The upload is larger than the upload limit.', { details })
    : new ApiFailure(415, 'unsupported_media_type', 'Only PNG, JPEG and WebP images are accepted.', { details });
}

export interface ImageRoutesOptions {
  db: Database.Database;
  imagesDir: string;
  auth: Auth;
}

export async function registerImages(app: FastifyInstance, { db, imagesDir, auth }: ImageRoutesOptions): Promise<void> {
  // The upload takes the file's bytes as its body, whatever Content-Type the browser gave it,
  // so its route has a scope of its own with one parser that hands over the unread stream.
  await app.register((scope, _options, ready) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_request, payload, done) => done(null, payload));

    scope.post(
      PATHS.images,
      { schema: { response: { 200: ImageSchema, 201: ImageSchema } } },
      async (request, reply) => {
        // Read on every upload, so that a changed limit applies at once (specs/09-operations.md §7).
        const { upload_limit_bytes: limit, display_variant_size: displaySize } = readSettings(db);
        const declared = Number(request.headers['content-length']);
        if (Number.isFinite(declared) && declared > limit) {
          discardRest(request.raw);
          throw refusal(new UploadRejected('size', `limit: ${limit} bytes`));
        }
        // No body at all is not an image either.
        const body = request.body instanceof Readable ? request.body : Readable.from([]);
        try {
          const { image, created } = await storeUpload(db, imagesDir, body, { limit, displaySize });
          return reply.code(created ? 201 : 200).send(image);
        } catch (error) {
          discardRest(request.raw);
          throw error instanceof UploadRejected ? refusal(error) : error;
        }
      },
    );
    ready();
  });

  app.get<{ Params: ImageIdParams }>(
    PATHS.image,
    { schema: { params: ImageIdParamsSchema, response: { 200: ImageSchema } } },
    (request) => readImage(db, request.params.id) ?? raise(notFound()),
  );

  // Calibrating a scene updates its image's preset for later scenes; existing scenes keep their
  // own grid (specs/03-domain-model.md §5, Q-001).
  app.put<{ Params: ImageIdParams; Body: GridPreset }>(
    PATHS.imagePreset,
    { schema: { params: ImageIdParamsSchema, body: GridPresetSchema, response: { 200: ImageSchema } } },
    (request) => updateGridPreset(db, request.params.id, request.body) ?? raise(notFound()),
  );

  // No params schema: a malformed id or variant is not found, like everything else here,
  // rather than a validation failure that would describe the route.
  app.get<{ Params: { id: string; variant: string } }>(IMAGE_FILE_PATH, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const { id, variant } = request.params;
    if (!SHA256.test(id) || !isVariant(variant)) throw notFound();
    if (auth.sessionOf(request) === undefined && !(variant === 'display' && isShownToPlayers(db, id))) {
      throw notFound();
    }
    const image = readImage(db, id) ?? raise(notFound());
    let file;
    try {
      file = await open(imageFilePath(imagesDir, id, variant));
    } catch {
      throw notFound();
    }
    let size;
    try {
      ({ size } = await file.stat());
    } catch {
      await file.close();
      throw notFound();
    }
    return reply
      .type(variant === 'original' ? image.mime : 'image/webp')
      .header('content-length', size)
      .header('x-content-type-options', 'nosniff')
      .send(file.createReadStream());
  });
}

/** Removes the files of images a deletion removed; a folder it cannot remove goes at the next start. */
export function imageFileRemover(imagesDir: string, logger: Logger): (ids: readonly string[]) => void {
  return (ids) => {
    if (ids.length === 0) return;
    const failed = removeImageFiles(imagesDir, ids);
    logger.info('images.removed', `Removed ${ids.length - failed.length} unreferenced images.`, {
      removed: ids.length - failed.length,
    });
    if (failed.length > 0) {
      logger.warn('images.remove_failed', 'Some image files could not be removed; the next start removes them.', {
        ids: failed,
      });
    }
  };
}

function raise(failure: ApiFailure): never {
  throw failure;
}
