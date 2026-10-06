import type { Readable } from 'node:stream';
import yazl from 'yazl';
import {
  ARCHIVE_DATA_FILES,
  ARCHIVE_FORMAT_VERSION,
  IMAGE_EXTENSIONS,
  type ArchiveCounts,
  type ArchiveKind,
  type ArchiveManifest,
} from '@emberglass/shared';
import type { AssetsExport, CampaignExport } from '../db/archive.js';
import { imageFilePath } from '../images/store.js';
import { APP_VERSION } from '../version.js';

// Writing an archive (DMT-05; specs/09-operations.md §9, Q-115, D-181): the manifest, the data files and every
// image's original, named by its sha256, streamed out as the zip is written and never built whole in memory. The
// data were read in one transaction (db/archive.ts); the images are read from the images folder as the zip reaches
// them. Images are stored as they are, already compressed; the JSON is deflated.

const json = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));

/** The zip of a campaign export or an assets export, as a stream to send. */
export function writeArchive(
  imagesDir: string,
  data: ({ kind: 'campaign' } & CampaignExport) | ({ kind: 'assets' } & AssetsExport),
  now: Date,
): Readable {
  const zip = new yazl.ZipFile();
  const kind: ArchiveKind = data.kind;
  const counts: ArchiveCounts =
    data.kind === 'campaign'
      ? {
          campaigns: 1,
          sessions: data.sessions.length,
          scenes: data.scenes.length,
          tokens: data.tokens.length,
          encounters: data.encounters.length,
          assets: data.assets.length,
          images: data.images.length,
        }
      : {
          campaigns: 0,
          sessions: 0,
          scenes: 0,
          tokens: 0,
          encounters: 0,
          assets: data.assets.length,
          images: data.images.length,
        };
  const manifest: ArchiveManifest = {
    format_version: ARCHIVE_FORMAT_VERSION,
    app_version: APP_VERSION,
    exported_at: now.toISOString(),
    kind,
    counts,
    images: data.images.map((image) => image.id),
  };
  const options = { mtime: now };
  zip.addBuffer(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), 'manifest.json', options);
  for (const name of ARCHIVE_DATA_FILES[kind]) {
    zip.addBuffer(json((data as unknown as Record<string, unknown>)[name]), `data/${name}.json`, options);
  }
  for (const image of data.images) {
    zip.addFile(imageFilePath(imagesDir, image.id, 'original'), `images/${image.id}.${IMAGE_EXTENSIONS[image.mime]}`, {
      ...options,
      compress: false,
    });
  }
  zip.end();
  return zip.outputStream as Readable;
}
