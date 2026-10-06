import { Transform, type Readable, type TransformCallback } from 'node:stream';
import zlib from 'node:zlib';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { ARCHIVE_ENTRY_PATTERN, type ErrorCode } from '@emberglass/shared';

// Reading an archive for an import (DMT-05; specs/07-security-and-access.md §9, specs/09-operations.md §9, Q-115,
// Q-119). The archive is a file the upload was streamed to, never held in memory; yauzl reads it from its central
// directory, which is the zip's own index, and every entry's bytes are streamed out of it. Nothing here trusts what
// the archive says about itself:
//
// - before any entry is read, every entry of the central directory is checked: the name against the layout, which
//   leaves no absolute path, `..`, backslash or drive letter; no link and nothing but a file or a folder; no
//   duplicate; no encryption; a known compression method; and at most MAX_ARCHIVE_ENTRIES of them;
// - the sizes the central directory declares are added up and refused over the import limit before anything is
//   inflated, but never trusted: while an entry is inflated its bytes are counted, and the read stops as soon as
//   the entry passes the size its headers declared, its own cap, or the running total of every entry passes the
//   import limit. A zip bomb that lies in its headers is cut off at its first chunk past what it declared;
// - every entry's size and CRC-32 are checked at its end.
//
// Entry names are never used as paths: what an import writes is named by the image's sha256 it computed. Refusing
// them anyway is what `07` §9 asks, and it keeps an archive this server would refuse from passing for one it reads.

/** An import refused, storing nothing: its code, and what in the archive caused it, in English. */
export class ImportRefused extends Error {
  constructor(
    readonly code: Extract<
      ErrorCode,
      'import_too_large' | 'import_newer_format' | 'import_unsafe_entry' | 'import_invalid' | 'import_image_refused'
    >,
    readonly detail: string,
    /** The entry the refusal is about, if one. */
    readonly entry?: string,
    /** With `import_newer_format`: the format the manifest names. */
    readonly formatVersion?: number,
  ) {
    super(`import refused: ${code}: ${detail}`);
  }
}

const unsafe = (detail: string, entry?: string) => new ImportRefused('import_unsafe_entry', detail, entry);
const invalid = (detail: string, entry?: string) => new ImportRefused('import_invalid', detail, entry);
const tooLarge = (detail: string, entry?: string) => new ImportRefused('import_too_large', detail, entry);

// The file type bits of a Unix mode, which zips made on Unix keep in the high half of the external attributes.
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
// The host system a zip entry was made on, the high byte of "version made by".
const UNIX_HOSTS = new Set([3, 19]); // Unix, OS X
// MS-DOS attribute bits in the low byte: directory, and the reparse point Windows tools set on a link.
const DOS_DIRECTORY = 0x10;
const DOS_REPARSE_POINT = 0x400;
const STORED = 0;
const DEFLATED = 8;

/** A name as the layout spells it: printable ASCII, without the tricks a path can hide. */
function checkName(raw: Buffer): string {
  if (raw.length === 0 || raw.length > 128) throw unsafe('an entry name is empty or too long');
  for (const byte of raw) {
    // Printable ASCII only: no NUL, no control character, no backslash, no bytes another code page reads as a path.
    if (byte < 0x20 || byte > 0x7e || byte === 0x5c) throw unsafe('an entry name holds a character no path may hold');
  }
  const name = raw.toString('ascii');
  const shown = JSON.stringify(name);
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) throw unsafe(`${shown} is an absolute path`, name);
  if (name.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw unsafe(`${shown} would land outside the folder it is unpacked to`, name);
  }
  if (!ARCHIVE_ENTRY_PATTERN.test(name)) throw unsafe(`${shown} is not part of an Emberglass archive`, name);
  return name;
}

/** Whether the entry's attributes say it is something other than a regular file or a folder: a link, a device. */
function isSpecial(entry: Entry, folder: boolean): boolean {
  const host = entry.versionMadeBy >>> 8;
  const attributes = entry.externalFileAttributes >>> 0;
  if (attributes & DOS_REPARSE_POINT) return true;
  if (UNIX_HOSTS.has(host)) {
    const type = (attributes >>> 16) & S_IFMT;
    // A zip made on Unix without a mode (0) says nothing more; anything else is a file or a folder, as named.
    if (type !== 0 && type !== (folder ? S_IFDIR : S_IFREG)) return true;
  }
  if (!folder && attributes & DOS_DIRECTORY && !UNIX_HOSTS.has(host)) return true;
  return false;
}

export interface Archive {
  /** The archive's files by name, folders left out. */
  files: ReadonlyMap<string, Entry>;
  /** Streams one file's bytes out, counted against the limits and checked against its CRC-32 at its end. */
  read(name: string, cap: { bytes: number; what: string }): Promise<Readable>;
  /** How many bytes every file read so far unpacked to. */
  unpacked(): number;
  close(): void;
}

function openZip(file: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      file,
      // Names are checked here from their raw bytes, and sizes against the bytes as they come (`read`).
      { lazyEntries: true, autoClose: false, decodeStrings: false, validateEntrySizes: false },
      (error, zip) => (error ? reject(invalid('the file is not a zip archive')) : resolve(zip)),
    );
  });
}

function entriesOf(zip: ZipFile): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: Entry[] = [];
    zip.on('entry', (entry: Entry) => {
      entries.push(entry);
      zip.readEntry();
    });
    zip.once('end', () => resolve(entries));
    zip.once('error', () => reject(invalid('the zip archive is damaged')));
    zip.readEntry();
  });
}

/**
 * Opens `file` and checks its central directory before anything is unpacked. `limit` bounds the total its files
 * declare and, later, the total they really unpack to; `maxEntries` the number of entries.
 */
export async function openArchive(file: string, limit: number, maxEntries: number): Promise<Archive> {
  const zip = await openZip(file);
  try {
    if (zip.entryCount > maxEntries) {
      throw unsafe(`the archive holds ${zip.entryCount} entries, more than the ${maxEntries} an import reads`);
    }
    const files = new Map<string, Entry>();
    const seen = new Set<string>();
    let declared = 0;
    for (const entry of await entriesOf(zip)) {
      const name = checkName(entry.fileNameRaw);
      if (seen.has(name)) throw unsafe(`${JSON.stringify(name)} appears twice`, name);
      seen.add(name);
      const folder = name.endsWith('/');
      if (isSpecial(entry, folder)) throw unsafe(`${JSON.stringify(name)} is a link or a special file`, name);
      // Bit 0: encrypted; bit 6: strong encryption.
      if (entry.generalPurposeBitFlag & 0x41) throw unsafe(`${JSON.stringify(name)} is encrypted`, name);
      if (folder) {
        if (entry.uncompressedSize !== 0) throw unsafe(`${JSON.stringify(name)} is a folder with content`, name);
        continue;
      }
      if (entry.compressionMethod !== STORED && entry.compressionMethod !== DEFLATED) {
        throw invalid(`${JSON.stringify(name)} uses a compression this server does not read`, name);
      }
      declared += entry.uncompressedSize;
      if (declared > limit) throw tooLarge('the archive unpacks to more than the import limit');
      files.set(name, entry);
    }
    let unpacked = 0;
    return {
      files,
      unpacked: () => unpacked,
      close: () => zip.close(),
      read: (name, cap) =>
        new Promise((resolve, reject) => {
          const entry = files.get(name);
          if (!entry) return reject(invalid(`${JSON.stringify(name)} is missing`, name));
          zip.openReadStream(entry, (error, stream) => {
            if (error) return reject(invalid(`${JSON.stringify(name)} cannot be read`, name));
            let size = 0;
            let crc = 0;
            const counter = new Transform({
              transform(chunk: Buffer, _encoding, done: TransformCallback) {
                size += chunk.length;
                unpacked += chunk.length;
                // The counts, not the headers, decide: checked on every chunk, so a lying entry stops here.
                if (unpacked > limit) return done(tooLarge('the archive unpacks to more than the import limit', name));
                if (size > entry.uncompressedSize) {
                  return done(invalid(`${JSON.stringify(name)} unpacks to more than its headers declare`, name));
                }
                if (size > cap.bytes) {
                  return done(
                    cap.what === 'image'
                      ? new ImportRefused('import_image_refused', `${name} is larger than the upload limit`, name)
                      : tooLarge(`${name} is larger than a ${cap.what} may be`, name),
                  );
                }
                crc = zlib.crc32(chunk, crc);
                done(null, chunk);
              },
              flush(done: TransformCallback) {
                if (size !== entry.uncompressedSize) {
                  return done(invalid(`${JSON.stringify(name)} unpacks to less than its headers declare`, name));
                }
                if (crc !== entry.crc32 >>> 0) return done(invalid(`${JSON.stringify(name)} is damaged`, name));
                done();
              },
            });
            // yauzl's own errors (bad deflate data, a stored entry whose sizes differ) refuse the archive too.
            stream.once('error', () => {
              counter.destroy(invalid(`${JSON.stringify(name)} is damaged`, name));
            });
            counter.once('error', () => {
              stream.unpipe(counter);
              stream.destroy();
            });
            resolve(stream.pipe(counter));
          });
        }),
    };
  } catch (error) {
    zip.close();
    throw error;
  }
}

/** The whole of a stream as one buffer: for the manifest and data files, each bounded by its cap. */
export async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
