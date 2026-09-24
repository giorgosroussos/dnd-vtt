import { createHash, randomUUID } from 'node:crypto';
import zlib from 'node:zlib';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import sharp, { type Metadata } from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  ErrorEnvelopeSchema,
  IMAGE_VARIANTS,
  ImageSchema,
  ImageVariantsSchema,
  PUBLIC_API_ROUTES,
  imageFileUrl,
  type Campaign,
  type DeletionSummary,
  type ErrorEnvelope,
  type GridPreset,
  type Image,
  type Scene,
  type Session,
} from '@emberglass/shared';
import { countRows } from '../db/testing/fixture.js';
import { imageFilePath, imagesDirOf, regenerateDisplayVersions } from '../images/store.js';
import { compileSchema } from '../validation.js';
import { DM_COOKIE } from './auth.js';
import { buildTestApp, createTestData, dmCookie, setUpPin, type TestData } from './testing/app.js';

// SRV-04: the image upload pipeline against a real SQLite file and a real images folder
// (specs/02-architecture.md §5, §7, specs/03-domain-model.md §3, §7, specs/05-assets-and-images.md
// §6, §7, specs/07-security-and-access.md §5, D-021, D-032, D-044, D-080). Every image is
// generated here (Q-088).

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const isEnvelope = compileSchema<ErrorEnvelope>(ErrorEnvelopeSchema);
const isImage = compileSchema<Image>(ImageSchema);
const isVariants = compileSchema<Image['variants']>(ImageVariantsSchema);

let data: TestData;
let app: FastifyInstance;
let cookie: string;
let imagesDir: string;

beforeEach(async () => {
  data = createTestData('emberglass-images-');
  app = await buildTestApp(data);
  cookie = await setUpPin(app, '4826');
  imagesDir = imagesDirOf(data.dataDir);
});

afterEach(async () => {
  await app.close();
  data.remove();
});

// Generated images: a flat colour and one pixel that differs, so that every image has its own sha256.
let seed = 0;
function picture(format: 'png' | 'jpeg' | 'webp' | 'gif', width = 64, height = 48): Promise<Buffer> {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: seed % 256, g: 80, b: 160 } },
  }).composite([
    {
      input: { create: { width: 1, height: 1, channels: 3, background: { r: 255, g: (seed++ * 37) % 256, b: 0 } } },
      left: 0,
      top: 0,
    },
  ]);
  return image[format]().toBuffer();
}
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const inject = (options: InjectOptions) =>
  app.inject({ ...options, headers: { cookie, ...(options.headers as Record<string, string> | undefined) } });
const upload = (bytes: Buffer, contentType: string | null = 'application/octet-stream') =>
  inject({
    method: 'POST',
    url: '/api/images',
    payload: bytes,
    headers: contentType === null ? {} : { 'content-type': contentType },
  });
const post = (url: string, payload: unknown) => inject({ method: 'POST', url, payload: payload as object });

function ok<T>(response: LightMyRequestResponse, status = 200): T {
  expect(response.statusCode, response.body).toBe(status);
  return response.json<T>();
}

function expectFailure(
  response: LightMyRequestResponse,
  status: number,
  code: ErrorEnvelope['error']['code'],
): ErrorEnvelope {
  expect(response.statusCode, response.body).toBe(status);
  const body: unknown = response.json();
  expect(isEnvelope(body), JSON.stringify(isEnvelope.errors)).toBe(true);
  expect((body as ErrorEnvelope).error.code).toBe(code);
  return body as ErrorEnvelope;
}

async function uploaded(bytes: Buffer): Promise<Image> {
  const image = ok<Image>(await upload(bytes), 201);
  expect(isImage(image), JSON.stringify(isImage.errors)).toBe(true);
  return image;
}

/** Every file and folder under the images folder, relative to it. */
const imagesTree = (): string[] =>
  (readdirSync(imagesDir, { recursive: true }) as string[]).map((entry) => entry.split(path.sep).join('/')).sort();
/** Nothing stored: no row, and nothing in the images folder but the empty staging folder. */
function expectNothingStored(before: Record<string, number>): void {
  expect(countRows(data.db)).toEqual(before);
  expect(imagesTree()).toEqual(['.incoming']);
}

const setSetting = (column: 'upload_limit_bytes' | 'display_variant_size', value: number): void => {
  data.db.prepare(`UPDATE settings SET ${column} = ?`).run(value);
};

const PRESET: GridPreset = {
  type: 'square',
  size: 70.5,
  offset_x: 12.25,
  offset_y: -3.5,
  visible: false,
  feet_per_square: 10,
  columns: 40,
  rows: 30,
};

describe('uploads judged by content (specs/05-assets-and-images.md §6, D-032)', () => {
  it.each(['png', 'jpeg', 'webp'] as const)(
    'accepts a %s whatever its Content-Type says, under the lowercase sha256 of its bytes',
    async (format) => {
      for (const contentType of ['application/octet-stream', 'image/gif', 'text/plain', null]) {
        const bytes = await picture(format, 120, 80);
        const image = await uploaded(bytes);
        expect(image.id).toBe(sha256(bytes));
        expect(image.id).toMatch(/^[0-9a-f]{64}$/);
        expect(image).toMatchObject({ mime: `image/${format}`, width: 120, height: 80, grid_preset: null });
        expect(readFileSync(imageFilePath(imagesDir, image.id, 'original')).equals(bytes), String(contentType)).toBe(
          true,
        );
      }
    },
  );

  it('refuses a GIF, a GIF named or typed as a PNG, other types and text with 415 naming the type, storing nothing', async () => {
    const before = countRows(data.db);
    const gif = await picture('gif');
    const cases: [Buffer, string | null, string][] = [
      [gif, 'application/octet-stream', 'image/gif'],
      [gif, 'image/png', 'image/gif'],
      [Buffer.concat([Buffer.from('BM'), Buffer.alloc(64)]), 'image/png', 'image/bmp'],
      [Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64)]), 'image/jpeg', 'application/pdf'],
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml', 'unknown'],
      [Buffer.from('{"not":"an image"}'), 'application/json', 'unknown'],
      [Buffer.from([0x89, 0x50]), 'image/png', 'unknown'],
    ];
    for (const [bytes, contentType, detected] of cases) {
      const body = expectFailure(await upload(bytes, contentType), 415, 'unsupported_media_type');
      expect(body.error.details).toEqual([{ path: '', message: `detected type: ${detected}` }]);
      expectNothingStored(before);
    }
  });

  it.each(['png', 'jpeg', 'webp'] as const)(
    'refuses a truncated %s, and one whose signature is followed by garbage, with 415, storing nothing',
    async (format) => {
      const before = countRows(data.db);
      const bytes = await picture(format, 400, 300);
      const forged = [
        bytes.subarray(0, Math.floor(bytes.length * 0.6)),
        Buffer.concat([bytes.subarray(0, 16), Buffer.alloc(4096, 0x41)]),
      ];
      for (const file of forged) {
        const body = expectFailure(await upload(file), 415, 'unsupported_media_type');
        expect(body.error.details).toEqual([
          { path: '', message: `detected type: image/${format}, incomplete or corrupt` },
        ]);
        expectNothingStored(before);
      }
    },
  );

  it('refuses an empty upload with 415, storing nothing', async () => {
    const before = countRows(data.db);
    expectFailure(await upload(Buffer.alloc(0)), 415, 'unsupported_media_type');
    expectFailure(await inject({ method: 'POST', url: '/api/images' }), 415, 'unsupported_media_type');
    expectNothingStored(before);
  });
});

describe('the upload limit (specs/05-assets-and-images.md §6, D-044)', () => {
  it('refuses an upload over upload_limit_bytes with 413 naming the limit, storing nothing', async () => {
    const bytes = await picture('png', 300, 300);
    const before = countRows(data.db);
    setSetting('upload_limit_bytes', bytes.length - 1);
    const body = expectFailure(await upload(bytes), 413, 'payload_too_large');
    expect(body.error.details).toEqual([{ path: '', message: `limit: ${bytes.length - 1} bytes` }]);
    expectNothingStored(before);
    setSetting('upload_limit_bytes', bytes.length);
    await uploaded(bytes);
  });

  it('reads the limit from settings on every upload, so a lowered limit applies without a restart', async () => {
    expect(DEFAULT_SETTINGS.upload_limit_bytes).toBe(50 * 1024 * 1024);
    const first = await picture('webp', 200, 200);
    await uploaded(first);
    setSetting('upload_limit_bytes', 20);
    const before = countRows(data.db);
    expectFailure(await upload(await picture('webp', 200, 200)), 413, 'payload_too_large');
    expectNothingStoredBeside(before, [first]);
    setSetting('upload_limit_bytes', DEFAULT_SETTINGS.upload_limit_bytes);
    await uploaded(await picture('webp', 200, 200));
  });

  // Like a browser, the client sends its whole body whatever it hears meanwhile, and only then
  // reads the answer. A server that closes the connection with unread body data makes the
  // client's system reset it (ECONNRESET on Windows, EPIPE on Linux), and the DM would never see
  // the 413. A raw socket, because Node's own HTTP client stops sending once an answer arrives.
  async function sendLikeABrowser(
    headers: Record<string, string>,
    parts: Buffer[],
  ): Promise<{ status: number; body: string; sentWhenAnswered: number; error?: string }> {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    const chunked = headers['content-length'] === undefined;
    const head = [
      'POST /api/images HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      `Cookie: ${cookie}`,
      'Content-Type: application/octet-stream',
      ...(chunked ? ['Transfer-Encoding: chunked'] : []),
      ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
      '',
      '',
    ].join('\r\n');
    const frames = [
      Buffer.from(head),
      ...parts.map((part) =>
        chunked ? Buffer.concat([Buffer.from(`${part.length.toString(16)}\r\n`), part, Buffer.from('\r\n')]) : part,
      ),
      ...(chunked ? [Buffer.from('0\r\n\r\n')] : []),
    ];
    return new Promise((resolve) => {
      let sent = 0;
      let sentWhenAnswered = -1;
      let received = Buffer.alloc(0);
      const socket = net.connect(port, '127.0.0.1');
      const settle = (error?: string): void => {
        clearTimeout(timer);
        socket.destroy();
        const text = received.toString('utf8');
        const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(text)?.[1] ?? 0);
        const body = text.slice(text.indexOf('\r\n\r\n') + 4);
        resolve({ status, body, sentWhenAnswered, ...(error ? { error } : {}) });
      };
      const timer = setTimeout(() => settle(`timed out after sending ${sent} of ${frames.length} parts`), 20_000);
      // Complete once every part went out and the whole answer, by its Content-Length, came in.
      const answered = (): boolean => {
        const text = received.toString('latin1');
        const split = text.indexOf('\r\n\r\n');
        const length = Number(/\r\ncontent-length: (\d+)/i.exec(text)?.[1] ?? NaN);
        return split >= 0 && received.length >= split + 4 + length;
      };
      const check = (): void => {
        if (sent === frames.length && socket.writableLength === 0 && answered()) settle();
      };
      socket.on('data', (data: Buffer) => {
        if (sentWhenAnswered < 0) sentWhenAnswered = sent;
        received = Buffer.concat([received, data]);
        check();
      });
      socket.on('end', () => settle(`the server ended the connection after ${sent} of ${frames.length} parts`));
      socket.on('error', (error) => settle(String(error)));
      const send = (): void => {
        while (sent < frames.length) {
          if (!socket.write(frames[sent++]!)) return void socket.once('drain', send);
        }
        socket.once('drain', check);
        socket.write('', check);
      };
      socket.once('connect', send);
    });
  }

  it('answers 413 over a real connection while the oversized body still arrives, and stores nothing of it', async () => {
    setSetting('upload_limit_bytes', 64 * 1024);
    const before = countRows(data.db);
    const png = await picture('png', 64, 64);
    const parts = [png, ...Array.from({ length: 256 }, () => Buffer.alloc(64 * 1024, 7))]; // 16 MiB
    // Chunked, with no Content-Length: only reading the body can find the size.
    const outcome = await sendLikeABrowser({}, parts);
    expect(outcome.error).toBeUndefined();
    expect(outcome.status, outcome.body).toBe(413);
    expect(JSON.parse(outcome.body)).toMatchObject({ error: { code: 'payload_too_large' } });
    // The answer came while the body was still being sent, not after it.
    expect(outcome.sentWhenAnswered).toBeGreaterThanOrEqual(0);
    expect(outcome.sentWhenAnswered).toBeLessThan(parts.length);
    expectNothingStored(before);
    // The connection outlived the refusal: the next upload on the same server succeeds.
    setSetting('upload_limit_bytes', DEFAULT_SETTINGS.upload_limit_bytes);
    await uploaded(await picture('png'));
  });

  it('answers 413 for a declared Content-Length over the limit before the body arrives, over a real connection', async () => {
    setSetting('upload_limit_bytes', 64 * 1024);
    const before = countRows(data.db);
    const parts = Array.from({ length: 64 }, () => Buffer.alloc(64 * 1024, 7));
    const outcome = await sendLikeABrowser({ 'content-length': String(64 * 64 * 1024) }, parts);
    expect(outcome.error).toBeUndefined();
    expect(outcome.status, outcome.body).toBe(413);
    expectNothingStored(before);
  });

  it('refuses a declared Content-Length over the limit before reading the body', async () => {
    setSetting('upload_limit_bytes', 1000);
    const before = countRows(data.db);
    const response = await inject({
      method: 'POST',
      url: '/api/images',
      payload: Buffer.alloc(5000, 1),
      headers: { 'content-type': 'application/octet-stream' },
    });
    expectFailure(response, 413, 'payload_too_large');
    expectNothingStored(before);
  });
});

// Several images stored before: the tree holds their folders too.
function expectNothingStoredBeside(before: Record<string, number>, stored: Buffer[]): void {
  expect(countRows(data.db)).toEqual(before);
  const folders = stored.map(sha256);
  expect(imagesTree().filter((entry) => !folders.some((id) => entry.startsWith(id)))).toEqual(['.incoming']);
}

describe('identity and reuse (specs/03-domain-model.md §3, specs/05-assets-and-images.md §7)', () => {
  it('returns the stored image and its grid preset for the same bytes, writing no second file', async () => {
    const bytes = await picture('jpeg', 300, 200);
    const image = await uploaded(bytes);
    ok<Image>(await inject({ method: 'PUT', url: `/api/images/${image.id}/preset`, payload: PRESET }));
    const tree = imagesTree();
    const stats = IMAGE_VARIANTS.map((variant) => statSync(imageFilePath(imagesDir, image.id, variant)).mtimeMs);
    const before = countRows(data.db);
    const again = ok<Image>(await upload(bytes, 'image/png'), 200);
    expect(again).toEqual({ ...image, grid_preset: PRESET });
    expect(countRows(data.db)).toEqual(before);
    expect(imagesTree()).toEqual(tree);
    expect(IMAGE_VARIANTS.map((variant) => statSync(imageFilePath(imagesDir, image.id, variant)).mtimeMs)).toEqual(
      stats,
    );
  });

  it('stores one image when the same bytes are uploaded twice at once', async () => {
    const bytes = await picture('png', 500, 400);
    const [a, b] = await Promise.all([upload(bytes), upload(bytes)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    expect(a.json()).toEqual(b.json());
    expect(countRows(data.db).image).toBe(1);
    expect(imagesTree()).toEqual(
      [
        '.incoming',
        sha256(bytes),
        ...['display.webp', 'original', 'thumbnail.webp'].map((f) => `${sha256(bytes)}/${f}`),
      ].sort(),
    );
  });
});

describe('display version and thumbnail (specs/05-assets-and-images.md §7, D-021, G-009)', () => {
  async function versions(image: Image): Promise<Record<'display' | 'thumbnail', Metadata>> {
    return {
      display: await sharp(imageFilePath(imagesDir, image.id, 'display')).metadata(),
      thumbnail: await sharp(imageFilePath(imagesDir, image.id, 'thumbnail')).metadata(),
    };
  }

  it('writes both as WebP, the display version within display_variant_size and the thumbnail at 256 px', async () => {
    setSetting('display_variant_size', 1000);
    const wide = await uploaded(await picture('png', 1500, 900));
    const tall = await uploaded(await picture('jpeg', 600, 1200));
    for (const [image, display, thumbnail] of [
      [wide, { width: 1000, height: 600 }, { width: 256, height: 154 }],
      [tall, { width: 500, height: 1000 }, { width: 128, height: 256 }],
    ] as const) {
      expect(isVariants(image.variants), JSON.stringify(isVariants.errors)).toBe(true);
      expect(image.variants).toEqual({ display, thumbnail });
      const files = await versions(image);
      expect(files.display).toMatchObject({ format: 'webp', ...display });
      expect(files.thumbnail).toMatchObject({ format: 'webp', ...thumbnail });
    }
  });

  it('never upscales: a small image keeps its size in both versions', async () => {
    const image = await uploaded(await picture('webp', 120, 90));
    expect(image.variants).toEqual({ display: { width: 120, height: 90 }, thumbnail: { width: 120, height: 90 } });
    const files = await versions(image);
    expect(files.display).toMatchObject({ format: 'webp', width: 120, height: 90 });
  });

  it('uses the default display size of 4096 px', async () => {
    expect(DEFAULT_SETTINGS.display_variant_size).toBe(4096);
    const image = await uploaded(await picture('jpeg', 5000, 2500));
    expect(image.variants.display).toEqual({ width: 4096, height: 2048 });
  });

  it('stores the size of the image as shown: an EXIF rotation is applied to its size and its versions', async () => {
    const bytes = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#335577' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const image = await uploaded(bytes);
    expect(image).toMatchObject({ width: 200, height: 400 });
    expect(image.variants).toEqual({ display: { width: 200, height: 400 }, thumbnail: { width: 128, height: 256 } });
  });

  it('regenerates every display version after the setting changes, leaving originals and thumbnails alone', async () => {
    setSetting('display_variant_size', 800);
    const a = await uploaded(await picture('png', 1600, 1200));
    const b = await uploaded(await picture('jpeg', 300, 600));
    const gone = await uploaded(await picture('webp', 900, 900));
    const untouched = [a, b].flatMap((image) =>
      (['original', 'thumbnail'] as const).map((variant) => readFileSync(imageFilePath(imagesDir, image.id, variant))),
    );
    // An image deleted before its turn is skipped, not a failure.
    data.db.prepare('DELETE FROM image WHERE id = ?').run(gone.id);

    const result = await regenerateDisplayVersions(data.db, imagesDir, 400);
    expect(result).toEqual({ regenerated: [a.id, b.id].sort(), failed: [] });
    const after = (id: string): Image['variants'] =>
      JSON.parse(
        data.db.prepare('SELECT variants FROM image WHERE id = ?').pluck().get(id) as string,
      ) as Image['variants'];
    expect(after(a.id)).toEqual({
      display: { width: 400, height: 300 },
      thumbnail: { width: 256, height: 192 },
    });
    expect(after(b.id)).toEqual({
      display: { width: 200, height: 400 },
      thumbnail: { width: 128, height: 256 },
    });
    expect(await sharp(imageFilePath(imagesDir, a.id, 'display')).metadata()).toMatchObject({
      format: 'webp',
      width: 400,
      height: 300,
    });
    expect(
      [a, b].flatMap((image) =>
        (['original', 'thumbnail'] as const).map((variant) =>
          readFileSync(imageFilePath(imagesDir, image.id, variant)),
        ),
      ),
    ).toEqual(untouched);

    // Raised above the original: back to the original's size, never beyond it.
    await regenerateDisplayVersions(data.db, imagesDir, 5000);
    expect(after(b.id).display).toEqual({ width: 300, height: 600 });
    expect(imagesTree().filter((entry) => entry.startsWith('.incoming/'))).toEqual([]);
  });
});

describe('regeneration that fails (specs/05-assets-and-images.md §7)', () => {
  it('reports an image whose original no longer decodes and keeps its previous display version', async () => {
    setSetting('display_variant_size', 600);
    const good = await uploaded(await picture('png', 900, 900));
    const broken = await uploaded(await picture('jpeg', 900, 900));
    const display = readFileSync(imageFilePath(imagesDir, broken.id, 'display'));
    writeFileSync(imageFilePath(imagesDir, broken.id, 'original'), 'no longer an image');
    expect(await regenerateDisplayVersions(data.db, imagesDir, 300)).toEqual({
      regenerated: [good.id],
      failed: [broken.id],
    });
    expect(readFileSync(imageFilePath(imagesDir, broken.id, 'display')).equals(display)).toBe(true);
    expect(ok<Image>(await inject({ method: 'GET', url: `/api/images/${broken.id}` })).variants.display).toEqual({
      width: 600,
      height: 600,
    });
    expect(imagesTree().filter((entry) => entry.startsWith('.incoming/'))).toEqual([]);
  });
});

describe('staging and failure midway (D-032)', () => {
  it('leaves no file and no row when storing the row fails after processing', async () => {
    const before = countRows(data.db);
    data.db.exec("CREATE TRIGGER refuse_image BEFORE INSERT ON image BEGIN SELECT RAISE(ABORT, 'refused'); END");
    expectFailure(await upload(await picture('png', 300, 200)), 500, 'internal_error');
    expectNothingStored(before);
  });

  it('answers 500, not a refusal of the file, when writing a version fails, and leaves no file and no row', async () => {
    const before = countRows(data.db);
    const toFile = vi
      .spyOn(sharp.prototype, 'toFile')
      .mockRejectedValueOnce(new Error('VipsForeignSave: write failed'));
    try {
      expectFailure(await upload(await picture('png', 300, 200)), 500, 'internal_error');
    } finally {
      toFile.mockRestore();
    }
    expectNothingStored(before);
  });

  it('refuses an image with more pixels than the server decodes as 413, storing nothing', async () => {
    const before = countRows(data.db);
    const chunk = (type: string, body: Buffer): Buffer => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(body.length);
      const typed = Buffer.concat([Buffer.from(type), body]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(zlib.crc32(typed));
      return Buffer.concat([length, typed, crc]);
    };
    // A valid header claiming 20,000 × 20,000: about 3 KB on the wire, 400 megapixels decoded.
    const header = Buffer.alloc(13);
    header.writeUInt32BE(20_000, 0);
    header.writeUInt32BE(20_000, 4);
    header[8] = 8;
    const bomb = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', zlib.deflateSync(Buffer.alloc(2048))),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    const body = expectFailure(await upload(bomb), 413, 'payload_too_large');
    expect(body.error.details).toEqual([{ path: '', message: 'the image has more pixels than the server decodes' }]);
    expectNothingStored(before);
  });

  it('empties the staging folder and removes image folders without a row when the server starts', async () => {
    const kept = await uploaded(await picture('png'));
    const orphan = sha256(Buffer.from('an orphan'));
    mkdirSync(path.join(imagesDir, orphan));
    writeFileSync(path.join(imagesDir, orphan, 'original'), 'left by a crash');
    mkdirSync(path.join(imagesDir, '.incoming', 'interrupted'));
    writeFileSync(path.join(imagesDir, '.incoming', 'interrupted', 'original'), 'half an upload');
    writeFileSync(path.join(imagesDir, 'README.txt'), 'not ours to remove');
    await app.close();
    app = await buildTestApp(data);
    expect(imagesTree()).toEqual(
      [
        '.incoming',
        'README.txt',
        kept.id,
        ...['display.webp', 'original', 'thumbnail.webp'].map((f) => `${kept.id}/${f}`),
      ].sort(),
    );
  });

  it('leaves nothing when the client goes away midway through its upload', async () => {
    const before = countRows(data.db);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    const png = await picture('png', 800, 800);
    await new Promise<void>((resolve) => {
      const request = http.request({
        port,
        host: '127.0.0.1',
        method: 'POST',
        path: '/api/images',
        headers: { cookie, 'content-length': String(png.length) },
      });
      request.on('error', () => resolve());
      request.write(png.subarray(0, Math.floor(png.length / 2)), () => {
        setTimeout(() => {
          request.destroy();
          resolve();
        }, 100);
      });
    });
    await vi.waitFor(() => expectNothingStored(before), { timeout: 5_000 });
  });
});

describe('metadata and grid preset (specs/02-architecture.md §5, specs/03-domain-model.md §5)', () => {
  it('reads an image with its preset, and PUT replaces the preset that later scenes copy', async () => {
    const image = await uploaded(await picture('png', 700, 500));
    expect(ok<Image>(await inject({ method: 'GET', url: `/api/images/${image.id}` }))).toEqual(image);
    const campaign = ok<Campaign>(await post('/api/campaigns', { name: 'C' }), 201);
    const session = ok<Session>(await post(`/api/campaigns/${campaign.id}/sessions`, { title: 'S' }), 201);
    const before = ok<Scene>(
      await post(`/api/sessions/${session.id}/scenes`, { name: 'Before', map_image_id: image.id }),
      201,
    );

    const updated = ok<Image>(await inject({ method: 'PUT', url: `/api/images/${image.id}/preset`, payload: PRESET }));
    expect(updated).toEqual({ ...image, grid_preset: PRESET });
    expect(ok<Image>(await inject({ method: 'GET', url: `/api/images/${image.id}` }))).toEqual(updated);

    const after = ok<Scene>(
      await post(`/api/sessions/${session.id}/scenes`, { name: 'After', map_image_id: image.id }),
      201,
    );
    expect(after.grid).toEqual(PRESET);
    // An existing scene keeps its own grid (Q-001).
    expect(ok<Scene>(await inject({ method: 'GET', url: `/api/scenes/${before.id}` }))).toEqual(before);
  });

  it('refuses an invalid preset and changes nothing; answers 404 for an unknown image and 400 for a malformed id', async () => {
    const image = await uploaded(await picture('png'));
    for (const payload of [
      { ...PRESET, size: 0 },
      { ...PRESET, type: 'hex' },
      { ...PRESET, columns: 0 },
      { ...PRESET, extra: 1 },
      { ...PRESET, size: null },
      Object.fromEntries(Object.entries(PRESET).filter(([key]) => key !== 'rows')),
    ]) {
      expectFailure(
        await inject({ method: 'PUT', url: `/api/images/${image.id}/preset`, payload }),
        400,
        'validation_failed',
      );
    }
    expect(ok<Image>(await inject({ method: 'GET', url: `/api/images/${image.id}` })).grid_preset).toBeNull();
    const unknown = 'f'.repeat(64);
    expectFailure(await inject({ method: 'GET', url: `/api/images/${unknown}` }), 404, 'not_found');
    expectFailure(
      await inject({ method: 'PUT', url: `/api/images/${unknown}/preset`, payload: PRESET }),
      404,
      'not_found',
    );
    for (const id of ['F'.repeat(64), 'abc', randomUUID()]) {
      expectFailure(await inject({ method: 'GET', url: `/api/images/${id}` }), 400, 'validation_failed');
    }
  });
});

describe('image files (specs/05-assets-and-images.md §7, specs/07-security-and-access.md §5)', () => {
  const fetchFile = (url: string, headers: Record<string, string> = {}, method: 'GET' | 'HEAD' = 'GET') =>
    app.inject({ method, url, headers });

  it('serves every version to a DM session at /images/<sha256>/<variant>', async () => {
    const bytes = await picture('jpeg', 600, 400);
    const image = await uploaded(bytes);
    for (const variant of IMAGE_VARIANTS) {
      const response = await fetchFile(imageFileUrl(image.id, variant), { cookie });
      expect(response.statusCode, variant).toBe(200);
      expect(response.headers['content-type']).toBe(variant === 'original' ? 'image/jpeg' : 'image/webp');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.rawPayload.equals(readFileSync(imageFilePath(imagesDir, image.id, variant)))).toBe(true);
      const head = await fetchFile(imageFileUrl(image.id, variant), { cookie }, 'HEAD');
      expect(head.statusCode).toBe(200);
    }
    expect((await fetchFile(imageFileUrl(image.id, 'original'), { cookie })).rawPayload.equals(bytes)).toBe(true);
  });

  it('answers not found to a DM session for an unknown image, variant or path', async () => {
    const image = await uploaded(await picture('png'));
    for (const url of [
      imageFileUrl('0'.repeat(64), 'display'),
      `/images/${image.id}/preview`,
      `/images/${image.id}/original.png`,
      `/images/${image.id.toUpperCase()}/display`,
      `/images/${image.id}`,
      '/images/.incoming/original',
      `/images/..%2f..%2femberglass.db/original`,
      `/images/${image.id}/..%2f..%2f..%2femberglass.db`,
    ]) {
      expectFailure(await fetchFile(url, { cookie }), 404, 'not_found');
    }
  });

  it('answers every request without a DM session, such as the player view, with the same not found, whether the image exists or not', async () => {
    const image = await uploaded(await picture('png', 300, 300));
    const comparable = (response: LightMyRequestResponse) => {
      const headers: Record<string, unknown> = { ...response.headers };
      delete headers.date;
      return { status: response.statusCode, headers, body: response.body };
    };
    const reference = comparable(await fetchFile(imageFileUrl('0'.repeat(64), 'display')));
    expect(reference.status).toBe(404);
    expect(reference.headers['cache-control']).toBe('no-store');
    for (const headers of [{}, { cookie: `${DM_COOKIE}=${'cd'.repeat(32)}` }, { cookie: 'emberglass_player=1' }]) {
      for (const variant of IMAGE_VARIANTS) {
        const response = await fetchFile(imageFileUrl(image.id, variant), headers);
        expect(comparable(response), `${variant} ${JSON.stringify(headers)}`).toEqual(reference);
        expect(response.body).not.toContain(image.id);
        const head = await fetchFile(imageFileUrl(image.id, variant), headers, 'HEAD');
        expect(head.statusCode).toBe(404);
        expect(head.headers['content-type']).toBe(reference.headers['content-type']);
      }
      expect(comparable(await fetchFile(`/images/${image.id}/nope`, headers))).toEqual(reference);
    }
  });
});

describe('image files after a DM session ends (specs/07-security-and-access.md §2, §5, Q-033, Q-058)', () => {
  it('answers not found to a browser that signed out, and to every other browser after a PIN change', async () => {
    const image = await uploaded(await picture('png', 100, 100));
    const url = imageFileUrl(image.id, 'display');
    const other = dmCookie(
      await app.inject({ method: 'POST', url: '/api/auth', payload: { pin: '4826' }, remoteAddress: '192.168.1.20' }),
    );
    const third = dmCookie(await app.inject({ method: 'POST', url: '/api/auth', payload: { pin: '4826' } }));
    for (const session of [cookie, other, third]) {
      expect((await app.inject({ method: 'GET', url, headers: { cookie: session } })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: 'DELETE', url: '/api/auth', headers: { cookie: third } })).statusCode).toBe(204);
    expectFailure(await app.inject({ method: 'GET', url, headers: { cookie: third } }), 404, 'not_found');
    const change = await app.inject({
      method: 'PUT',
      url: '/api/settings/pin',
      headers: { cookie },
      payload: { current_pin: '4826', new_pin: '7391' },
    });
    expect(change.statusCode, change.body).toBe(204);
    expectFailure(await app.inject({ method: 'GET', url, headers: { cookie: other } }), 404, 'not_found');
    expect((await app.inject({ method: 'GET', url, headers: { cookie } })).statusCode).toBe(200);
  });
});

describe('removal of unreferenced images (specs/03-domain-model.md §7, Q-002, G-013)', () => {
  const campaignTree = async () => {
    const campaign = ok<Campaign>(await post('/api/campaigns', { name: 'C' }), 201);
    const session = ok<Session>(await post(`/api/campaigns/${campaign.id}/sessions`, { title: 'S' }), 201);
    return { campaign, session };
  };
  const scene = async (sessionId: string, mapImageId: string | null) =>
    ok<Scene>(await post(`/api/sessions/${sessionId}/scenes`, { name: 'Scene', map_image_id: mapImageId }), 201);
  const remove = async (url: string) => {
    const confirm = ok<DeletionSummary>(await inject({ method: 'GET', url: `${url}/deletion` }));
    expect((await inject({ method: 'DELETE', url, payload: { confirm } })).statusCode).toBe(204);
  };
  const stored = (id: string): boolean => existsSync(path.join(imagesDir, id)) || countImage(id) > 0;
  const countImage = (id: string): number =>
    data.db.prepare('SELECT count(*) FROM image WHERE id = ?').pluck().get(id) as number;
  async function withPreset(): Promise<Image> {
    const image = await uploaded(await picture('png', 400, 300));
    ok<Image>(await inject({ method: 'PUT', url: `/api/images/${image.id}/preset`, payload: PRESET }));
    return image;
  }
  function assetOf(imageId: string): void {
    data.db
      .prepare(
        `INSERT INTO asset (id, name, category, image_id, size, default_hidden) VALUES (?, 'Goblin', 'monster', ?, 'small', 1)`,
      )
      .run(randomUUID(), imageId);
  }

  it('removes the map image of a deleted scene with its files and preset once nothing references it', async () => {
    const { session } = await campaignTree();
    const bytes = await picture('png', 400, 300);
    const map = await uploaded(bytes);
    ok<Image>(await inject({ method: 'PUT', url: `/api/images/${map.id}/preset`, payload: PRESET }));
    const shared = await uploaded(await picture('webp', 300, 300));
    const doomed = await scene(session.id, map.id);
    const first = await scene(session.id, shared.id);
    const second = await scene(session.id, shared.id);
    await remove(`/api/scenes/${doomed.id}`);
    expect(stored(map.id)).toBe(false);
    // Still used by another scene.
    await remove(`/api/scenes/${first.id}`);
    expect(countImage(shared.id)).toBe(1);
    expect(existsSync(imageFilePath(imagesDir, shared.id, 'display'))).toBe(true);
    await remove(`/api/scenes/${second.id}`);
    expect(stored(shared.id)).toBe(false);
    expect(imagesTree()).toEqual(['.incoming']);
    // The preset went with the row: the same bytes again are a new image without it.
    expect(await uploaded(bytes)).toEqual({ ...map, grid_preset: null });
  });

  it('removes the map images of a deleted session that nothing else references, and keeps one an asset uses', async () => {
    const { campaign, session } = await campaignTree();
    const other = ok<Session>(await post(`/api/campaigns/${campaign.id}/sessions`, { title: 'Other' }), 201);
    const own = await withPreset();
    const token = await uploaded(await picture('png', 128, 128));
    const elsewhere = await uploaded(await picture('jpeg', 500, 300));
    await scene(session.id, own.id);
    await scene(session.id, own.id);
    await scene(session.id, token.id);
    await scene(session.id, elsewhere.id);
    await scene(session.id, null);
    await scene(other.id, elsewhere.id);
    assetOf(token.id);
    await remove(`/api/sessions/${session.id}`);
    expect(stored(own.id)).toBe(false);
    expect(countImage(token.id)).toBe(1);
    expect(countImage(elsewhere.id)).toBe(1);
    for (const id of [token.id, elsewhere.id]) {
      for (const variant of IMAGE_VARIANTS) expect(existsSync(imageFilePath(imagesDir, id, variant))).toBe(true);
    }
  });

  it('removes the map images of a deleted campaign that nothing else references', async () => {
    const { campaign, session } = await campaignTree();
    const second = ok<Session>(await post(`/api/campaigns/${campaign.id}/sessions`, { title: 'Two' }), 201);
    const kept = await campaignTree();
    const a = await withPreset();
    const b = await uploaded(await picture('jpeg', 640, 480));
    const c = await uploaded(await picture('webp', 320, 240));
    await scene(session.id, a.id);
    await scene(second.id, b.id);
    await scene(second.id, c.id);
    await scene(kept.session.id, c.id);
    const before = countRows(data.db);
    await remove(`/api/campaigns/${campaign.id}`);
    expect(stored(a.id)).toBe(false);
    expect(stored(b.id)).toBe(false);
    expect(countImage(c.id)).toBe(1);
    expect(countRows(data.db)).toMatchObject({ image: before.image - 2 });
    expect(imagesTree().filter((entry) => !entry.startsWith(c.id))).toEqual(['.incoming']);
  });

  it('keeps a new upload that nothing references yet, and an image whose scene deletion was refused', async () => {
    const lone = await uploaded(await picture('png'));
    const { session } = await campaignTree();
    const map = await uploaded(await picture('png', 200, 200));
    const kept = await scene(session.id, map.id);
    const response = await inject({
      method: 'DELETE',
      url: `/api/scenes/${kept.id}`,
      payload: { confirm: { sessions: 0, scenes: 2, tokens: 0, live: false } },
    });
    expectFailure(response, 409, 'confirmation_mismatch');
    expect(countImage(lone.id)).toBe(1);
    expect(countImage(map.id)).toBe(1);
    expect(existsSync(imageFilePath(imagesDir, map.id, 'original'))).toBe(true);
  });
});

describe('access (specs/02-architecture.md §5, specs/07-security-and-access.md §2, §7)', () => {
  const SRV_04_ROUTES = [
    'POST /api/images',
    'GET /api/images/:id',
    'HEAD /api/images/:id',
    'PUT /api/images/:id/preset',
  ];

  it('declares every SRV-04 route and makes none of them public, so the identical-answer test of auth.test.ts covers them', async () => {
    await app.ready();
    const declared = app.declaredRoutes.map(({ method, url }) => `${method} ${url}`);
    expect(declared).toEqual(expect.arrayContaining([...SRV_04_ROUTES, 'GET /images/:id/:variant']));
    for (const route of SRV_04_ROUTES) {
      const [method, url] = route.split(' ');
      expect(
        PUBLIC_API_ROUTES.some((open) => open.method === method && open.url === url),
        route,
      ).toBe(false);
    }
  });

  it('refuses an upload without a DM session with 401, and one from a foreign Origin with 403, storing nothing', async () => {
    const before = countRows(data.db);
    const bytes = await picture('png', 200, 200);
    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/images',
      payload: bytes,
      headers: { 'content-type': 'image/png' },
    });
    expectFailure(anonymous, 401, 'unauthorized');
    expectNothingStored(before);
    const forged = await app.inject({
      method: 'POST',
      url: '/api/images',
      payload: bytes,
      headers: { cookie, origin: 'http://evil.example', host: 'localhost:3000', 'content-type': 'image/png' },
    });
    expectFailure(forged, 403, 'forbidden');
    expectNothingStored(before);
  });

  it('answers the metadata and preset routes with 401 and no image data without a DM session', async () => {
    const image = await uploaded(await picture('png'));
    for (const [method, url, payload] of [
      ['GET', `/api/images/${image.id}`, undefined],
      ['PUT', `/api/images/${image.id}/preset`, PRESET],
    ] as const) {
      const response = await app.inject({ method, url, ...(payload ? { payload } : {}) });
      expectFailure(response, 401, 'unauthorized');
      expect(response.body).not.toContain(image.id);
    }
    expect(ok<Image>(await inject({ method: 'GET', url: `/api/images/${image.id}` })).grid_preset).toBeNull();
  });
});
