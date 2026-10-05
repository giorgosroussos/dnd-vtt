import { createWriteStream, rmSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  API_ARCHIVE_PATHS as PATHS,
  AssetExportQuerySchema,
  IdParamsSchema,
  ImportProgressSchema,
  ImportSummarySchema,
  exportFileName,
  type AssetExportQuery,
  type IdParams,
  type ImportProgress,
  type ImportStage,
} from '@emberglass/shared';
import { importArchive } from '../archive/import.js';
import { writeArchive } from '../archive/export.js';
import { ImportRefused } from '../archive/zip.js';
import { readAssetsExport, readCampaignExport } from '../db/archive.js';
import { readSettings } from '../db/settings.js';
import type { DisplayRegenerator } from '../images/regenerator.js';
import { newStagingDir } from '../images/store.js';
import type { Logger } from '../log/logger.js';
import { clientAddress } from './auth.js';
import { ApiFailure } from './errors.js';
import { discardRest } from './images.js';

// Export and import over REST (DMT-05; specs/02-architecture.md §5, specs/07-security-and-access.md §9,
// specs/09-operations.md §9, Q-115, Q-119, D-181). Every route needs a DM session, which the /api guard of auth.ts
// checks before anything here runs, and an import's POST passes the Origin check like every other write: an archive
// carries the DM's notes, hit points and hidden tokens, so nothing here is ever offered to the player view.
//
// GET /api/export/campaigns/:id and GET /api/export/assets stream the zip as a download, written as it is sent.
// POST /api/import takes the zip's bytes as its body, whatever Content-Type the browser gave it, streamed to a file
// in the import's own staging folder and refused as soon as it passes the import limit. Only one import runs at a
// time: another is refused at once, before its body is read. GET /api/import/progress says how far the running one
// got, for the DM view's progress. An import touches no live state, so it is allowed while a scene is live.

const STATUS: Record<ImportRefused['code'], number> = {
  import_too_large: 413,
  import_newer_format: 422,
  import_unsafe_entry: 422,
  import_invalid: 422,
  import_image_refused: 422,
};

const MESSAGES: Record<ImportRefused['code'], string> = {
  import_too_large: 'The archive is larger than the import limit.',
  import_newer_format: 'The archive was made by a newer Emberglass.',
  import_unsafe_entry: 'The archive holds an entry an import refuses.',
  import_invalid: 'The archive is not one this server can import.',
  import_image_refused: 'An image in the archive fails the checks of an upload.',
};

function refusal(refused: ImportRefused): ApiFailure {
  return new ApiFailure(STATUS[refused.code], refused.code, MESSAGES[refused.code], {
    details: [{ path: refused.entry ?? '', message: refused.detail }],
    ...(refused.formatVersion !== undefined ? { formatVersion: refused.formatVersion } : {}),
  });
}

const busy = (): ApiFailure =>
  new ApiFailure(409, 'import_busy', 'Another import is running; only one runs at a time.');

/** A download's headers: an ASCII file name for every browser, and the exact one for those that read it. */
function download(reply: FastifyReply, name: string): FastifyReply {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return reply
    .type('application/zip')
    .header('content-disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`)
    .header('x-content-type-options', 'nosniff');
}

/**
 * Writes the upload to `file`, and stops receiving as soon as it is over `limit` bytes. The request is never
 * destroyed here, so the refusal still reaches the browser; the caller discards the rest (images.ts, D-082).
 */
function receiveArchive(body: Readable, file: string, limit: number, onBytes: (bytes: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(file, { flags: 'wx' });
    let size = 0;
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
    function onData(chunk: Buffer): void {
      size += chunk.length;
      if (size > limit)
        return stop(new ImportRefused('import_too_large', 'the archive is larger than the import limit'));
      onBytes(size);
      if (!out.write(chunk)) {
        body.pause();
        out.once('drain', () => {
          if (!settled) body.resume();
        });
      }
    }
    function onEnd(): void {
      detach();
      out.once('close', () => resolve());
      out.end();
    }
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

export interface ArchiveRoutesOptions {
  db: Database.Database;
  imagesDir: string;
  logger: Logger;
  regenerator: Pick<DisplayRegenerator, 'kick'>;
  now?: () => Date;
}

export async function registerArchive(
  app: FastifyInstance,
  { db, imagesDir, logger, regenerator, now = () => new Date() }: ArchiveRoutesOptions,
): Promise<void> {
  app.get<{ Params: IdParams }>(PATHS.exportCampaign, { schema: { params: IdParamsSchema } }, (request, reply) => {
    const data = readCampaignExport(db, request.params.id);
    if (data === undefined) throw new ApiFailure(404, 'not_found', 'No such resource.');
    const at = now();
    logger.info('export.campaign', `Exported a campaign: ${data.scenes.length} scenes, ${data.images.length} images.`, {
      address: clientAddress(request),
      scenes: data.scenes.length,
      tokens: data.tokens.length,
      images: data.images.length,
    });
    return download(reply, exportFileName(data.campaign.name, at)).send(
      writeArchive(imagesDir, { kind: 'campaign', ...data }, at),
    );
  });

  app.get<{ Querystring: AssetExportQuery }>(
    PATHS.exportAssets,
    { schema: { querystring: AssetExportQuerySchema } },
    (request, reply) => {
      const { id } = request.query;
      const data = readAssetsExport(db, id === undefined ? undefined : [id].flat());
      if ('missing' in data) throw new ApiFailure(404, 'not_found', 'No such resource.');
      const at = now();
      logger.info('export.assets', `Exported ${data.assets.length} assets.`, {
        address: clientAddress(request),
        assets: data.assets.length,
        images: data.images.length,
      });
      return download(reply, exportFileName(null, at)).send(writeArchive(imagesDir, { kind: 'assets', ...data }, at));
    },
  );

  let running: ImportProgress | undefined;
  const progress = (stage: ImportStage, done: number, total: number) => {
    if (running) Object.assign(running, { stage, done, total });
  };

  app.get(PATHS.importProgress, { schema: { response: { 200: ImportProgressSchema } } }, () =>
    running ? { ...running } : { running: false, stage: null, done: 0, total: 0 },
  );

  await app.register((scope, _options, ready) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_request, payload, done) => done(null, payload));
    scope.post(PATHS.import, { schema: { response: { 200: ImportSummarySchema } } }, async (request) => {
      if (running) {
        discardRest(request.raw);
        throw busy();
      }
      const declared = Number(request.headers['content-length']);
      running = { running: true, stage: 'receiving', done: 0, total: Number.isFinite(declared) ? declared : 0 };
      let staging: string | undefined;
      try {
        // Read at each import, so a changed setting applies at once (specs/09-operations.md §7).
        const settings = readSettings(db);
        const limit = settings.import_limit_bytes;
        if (Number.isFinite(declared) && declared > limit) {
          throw new ImportRefused('import_too_large', 'the archive is larger than the import limit');
        }
        staging = newStagingDir(imagesDir);
        const file = path.join(staging, 'archive.zip');
        const body = request.body instanceof Readable ? request.body : Readable.from([]);
        await receiveArchive(body, file, limit, (bytes) => progress('receiving', bytes, running?.total ?? 0));
        const { summary, imagesAdded } = await importArchive(file, {
          db,
          imagesDir,
          staging,
          limit,
          uploadLimit: settings.upload_limit_bytes,
          displaySize: settings.display_variant_size,
          progress,
        });
        // The display size changed while the import made its versions: the regenerator brings them to it (G-015).
        if (imagesAdded.length > 0 && readSettings(db).display_variant_size !== settings.display_variant_size) {
          regenerator.kick();
        }
        logger.info('import.done', `Imported ${summary.kind === 'campaign' ? 'a campaign' : 'library assets'}.`, {
          address: clientAddress(request),
          kind: summary.kind,
          scenes: summary.scenes,
          tokens: summary.tokens,
          assets_added: summary.assets.added,
          assets_reused: summary.assets.reused,
          images_added: summary.images.added,
          images_reused: summary.images.reused,
        });
        return summary;
      } catch (error) {
        // The browser went away before its upload ended: nobody is waiting for an answer.
        if (!(error instanceof ImportRefused) && request.raw.destroyed) {
          throw new ApiFailure(400, 'bad_request', 'The upload ended before its body was complete.', { quiet: true });
        }
        discardRest(request.raw);
        if (error instanceof ImportRefused) {
          logger.warn('import.refused', 'An import was refused; nothing was stored.', {
            address: clientAddress(request),
            code: error.code,
            reason: error.detail,
          });
          throw refusal(error);
        }
        throw error;
      } finally {
        // Everything the import staged, the archive included; at the next start in the worst case (`.incoming`).
        if (staging !== undefined) rmSync(staging, { recursive: true, force: true, maxRetries: 3 });
        running = undefined;
      }
    });
    ready();
  });
}
