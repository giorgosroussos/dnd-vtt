import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DISPLAY_SIZE_BOUNDS,
  ErrorEnvelopeSchema,
  IMPORT_LIMIT_BOUNDS,
  SettingsSchema,
  UPLOAD_LIMIT_BOUNDS,
  type ErrorEnvelope,
  type Image,
  type Settings,
} from '@emberglass/shared';
import { readImage } from '../db/images.js';
import { readPinHash, readSettings } from '../db/settings.js';
import { createLogger, logFilePath } from '../log/logger.js';
import { imageFilePath, imagesDirOf } from '../images/store.js';
import { compileSchema } from '../validation.js';
import { buildTestApp, createTestData, dmCookie, setUpPin, type TestData } from './testing/app.js';

// REL-01: the settings a DM changes without restarting, against a real SQLite file and a real images
// folder (specs/09-operations.md §7, specs/05-assets-and-images.md §6, §7, specs/07-security-and-access.md
// §2, §7, Q-051, G-008, G-015). The rule's effect on the live scene is in server/src/ws/settings.test.ts.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const isEnvelope = compileSchema<ErrorEnvelope>(ErrorEnvelopeSchema);
const isSettings = compileSchema<Settings>(SettingsSchema);
const MB = 1024 * 1024;

let data: TestData;
let app: FastifyInstance;
let cookie: string;
let imagesDir: string;

beforeEach(async () => {
  data = createTestData('emberglass-settings-');
  app = await buildTestApp(data, { logger: createLogger({ dataDir: data.dataDir, stdout: sink, stderr: sink }) });
  cookie = await setUpPin(app, '4826');
  imagesDir = imagesDirOf(data.dataDir);
});

afterEach(async () => {
  await app.close();
  data.remove();
});

const sink = { write: () => true };
const inject = (options: InjectOptions) =>
  app.inject({ ...options, headers: { cookie, ...(options.headers as Record<string, string> | undefined) } });
const patch = (payload: unknown, headers: Record<string, string> = {}) =>
  inject({ method: 'PATCH', url: '/api/settings', payload: payload as object, headers });

function expectFailure(response: LightMyRequestResponse, status: number, code: ErrorEnvelope['error']['code']): void {
  expect(response.statusCode, response.body).toBe(status);
  const body: unknown = response.json();
  expect(isEnvelope(body), JSON.stringify(isEnvelope.errors)).toBe(true);
  expect((body as ErrorEnvelope).error.code).toBe(code);
}

let seed = 0;
function picture(width: number, height: number): Promise<Buffer> {
  const [r, g, b] = createHash('sha256').update(`settings ${seed++}`).digest();
  return sharp({ create: { width, height, channels: 3, background: { r: r!, g: g!, b: b! } } })
    .png()
    .toBuffer();
}
const upload = (bytes: Buffer | PassThrough) =>
  inject({
    method: 'POST',
    url: '/api/images',
    payload: bytes,
    headers: { 'content-type': 'application/octet-stream' },
  });
const displayOf = (id: string) => readImage(data.db, id)!.variants.display;

describe('PATCH /api/settings (specs/09-operations.md §7)', () => {
  it('changes each setting, answers the strict settings and logs what changed', async () => {
    const response = await patch({ upload_limit_bytes: 20 * MB, display_variant_size: 2048, ruler_rule: 'dmg' });
    expect(response.statusCode, response.body).toBe(200);
    const settings = response.json<Settings>();
    expect(isSettings(settings), JSON.stringify(isSettings.errors)).toBe(true);
    expect(settings).toMatchObject({ upload_limit_bytes: 20 * MB, display_variant_size: 2048, ruler_rule: 'dmg' });
    expect(readSettings(data.db)).toEqual(settings);
    expect(settings.live_scene_id).toBeNull();
    // One field alone leaves the others.
    expect((await patch({ ruler_rule: 'phb' })).json<Settings>()).toMatchObject({
      upload_limit_bytes: 20 * MB,
      ruler_rule: 'phb',
    });
    const lines = readFileSync(logFilePath(data.dataDir), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.event === 'settings.changed');
    expect(lines).toEqual([
      expect.objectContaining({ upload_limit_bytes: 20 * MB, display_variant_size: 2048, ruler_rule: 'dmg' }),
      expect.objectContaining({ ruler_rule: 'phb' }),
    ]);
  });

  // The TV address of the connect panel (specs/08-ux-journeys.md §5, specs/09-operations.md §7, Q-110).
  it('sets the TV address alone and back to Automatic with null, logging each change and not a re-save', async () => {
    const before = readSettings(data.db);
    const chosen = ok(await patch({ tv_address: '192.168.1.133' }));
    expect(chosen).toEqual({ ...before, tv_address: '192.168.1.133' });
    expect(readSettings(data.db)).toEqual(chosen);
    ok(await patch({ tv_address: '192.168.1.133' }));
    const automatic = ok(await patch({ tv_address: null }));
    expect(automatic).toEqual(before);
    expect(automatic.tv_address).toBeNull();
    const lines = readFileSync(logFilePath(data.dataDir), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.event === 'settings.changed');
    expect(lines).toEqual([
      expect.objectContaining({ msg: 'Settings changed: tv_address.', tv_address: '192.168.1.133' }),
      expect.objectContaining({ msg: 'Settings changed: tv_address.', tv_address: null }),
    ]);
  });

  // The import limit (DMT-05, specs/09-operations.md §7, §9, Q-119); its effect on an import is in archive tests.
  it('starts the import limit at 2 GB and sets it alone, logging the change', async () => {
    const before = readSettings(data.db);
    expect(before.import_limit_bytes).toBe(DEFAULT_SETTINGS.import_limit_bytes);
    expect(before.import_limit_bytes).toBe(2 * 1024 * MB);
    const changed = ok(await patch({ import_limit_bytes: 500 * MB }));
    expect(changed).toEqual({ ...before, import_limit_bytes: 500 * MB });
    expect(readSettings(data.db)).toEqual(changed);
    const lines = readFileSync(logFilePath(data.dataDir), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.event === 'settings.changed');
    expect(lines).toEqual([
      expect.objectContaining({ msg: 'Settings changed: import_limit_bytes.', import_limit_bytes: 500 * MB }),
    ]);
  });

  it('is refused without a DM session, and with a foreign Origin, changing nothing', async () => {
    const before = readSettings(data.db);
    expectFailure(
      await app.inject({ method: 'PATCH', url: '/api/settings', payload: { ruler_rule: 'dmg' } }),
      401,
      'unauthorized',
    );
    expectFailure(await patch({ ruler_rule: 'dmg' }, { origin: 'http://evil.example' }), 403, 'forbidden');
    expect(readSettings(data.db)).toEqual(before);
  });

  it.each([
    ['an empty body', {}],
    ['an unknown field', { ruler_rule: 'dmg', pin_hash: 'scrypt$1' }],
    ['the live scene', { live_scene_id: null }],
    ['an upload limit under 1 MB', { upload_limit_bytes: UPLOAD_LIMIT_BOUNDS.min - 1 }],
    ['an upload limit over 1 GB', { upload_limit_bytes: UPLOAD_LIMIT_BOUNDS.max + 1 }],
    ['a fractional upload limit', { upload_limit_bytes: 2_000_000.5 }],
    ['an upload limit as text', { upload_limit_bytes: '52428800' }],
    ['a display size under the bound', { display_variant_size: DISPLAY_SIZE_BOUNDS.min - 1 }],
    ['a display size over what WebP stores', { display_variant_size: DISPLAY_SIZE_BOUNDS.max + 1 }],
    ['an unknown rule', { ruler_rule: 'euclid' }],
    ['a valid field beside an invalid one', { ruler_rule: 'dmg', display_variant_size: 0 }],
    ['a TV address that is not an IPv4 address', { tv_address: '192.168.1.256' }],
    ['a TV address with a port', { tv_address: '192.168.1.133:3000' }],
    ['a TV address as a number', { tv_address: 3232235909 }],
    ['a valid field beside an invalid TV address', { ruler_rule: 'dmg', tv_address: '1.2.3.256' }],
    ['a valid TV address beside an invalid field', { tv_address: '192.168.1.133', display_variant_size: 0 }],
    ['an import limit under 1 MB', { import_limit_bytes: IMPORT_LIMIT_BOUNDS.min - 1 }],
    ['an import limit over 64 GB', { import_limit_bytes: IMPORT_LIMIT_BOUNDS.max + 1 }],
    ['an import limit as text', { import_limit_bytes: '2147483648' }],
    ['not an object', [1]],
  ])('refuses %s and changes nothing', async (_name, body) => {
    const before = readSettings(data.db);
    const hash = readPinHash(data.db);
    expectFailure(await patch(body), 400, 'validation_failed');
    expect(readSettings(data.db)).toEqual(before);
    expect(readPinHash(data.db)).toBe(hash);
  });

  it('never carries the PIN hash in its answer', async () => {
    const stored = readPinHash(data.db)!;
    const response = await patch({ ruler_rule: 'dmg' });
    const text = JSON.stringify(response.headers) + response.body;
    expect(text).not.toContain('pin_hash');
    expect(text).not.toContain('scrypt');
    for (const part of stored.split('$').slice(4)) expect(text).not.toContain(part);
  });
});

describe('the upload limit (specs/05-assets-and-images.md §6)', () => {
  it('applies to the next upload, without a restart', async () => {
    // Noise, which PNG cannot compress below 1 MB.
    const big = await sharp({
      create: {
        width: 1200,
        height: 1200,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
        noise: { type: 'gaussian', mean: 128, sigma: 60 },
      },
    })
      .png()
      .toBuffer();
    expect(big.length).toBeGreaterThan(MB);
    ok(await patch({ upload_limit_bytes: UPLOAD_LIMIT_BOUNDS.min }));
    const refused = await upload(big);
    expectFailure(refused, 413, 'payload_too_large');
    expect(refused.json<ErrorEnvelope>().error.details).toEqual([{ path: '', message: `limit: ${MB} bytes` }]);
    ok(await patch({ upload_limit_bytes: DEFAULT_SETTINGS.upload_limit_bytes }));
    expect((await upload(big)).statusCode).toBe(201);
  });
});

describe('the display size (specs/05-assets-and-images.md §7, G-015)', () => {
  it('regenerates every display version in the background, the answer not waiting for it', async () => {
    const wide = (await upload(await picture(1600, 1200))).json<Image>();
    const tall = (await upload(await picture(300, 900))).json<Image>();
    const thumbnail = readFileSync(imageFilePath(imagesDir, wide.id, 'thumbnail'));
    expect(displayOf(wide.id)).toEqual({ width: 1600, height: 1200 });

    ok(await patch({ display_variant_size: 800 }));
    await app.regenerator.idle();
    expect(displayOf(wide.id)).toEqual({ width: 800, height: 600 });
    expect(displayOf(tall.id)).toEqual({ width: 267, height: 800 });
    expect(await sharp(imageFilePath(imagesDir, wide.id, 'display')).metadata()).toMatchObject({
      format: 'webp',
      width: 800,
      height: 600,
    });
    expect(readFileSync(imageFilePath(imagesDir, wide.id, 'thumbnail')).equals(thumbnail)).toBe(true);

    // Raised above both originals: each back to its own size, never beyond.
    ok(await patch({ display_variant_size: 4096 }));
    await app.regenerator.idle();
    expect(displayOf(wide.id)).toEqual({ width: 1600, height: 1200 });
    expect(displayOf(tall.id)).toEqual({ width: 300, height: 900 });
    expect(readdirSync(path.join(imagesDir, '.incoming'))).toEqual([]);
  });

  it('regenerates an image whose upload started before the change and ended during the run', async () => {
    const early = (await upload(await picture(1600, 1200))).json<Image>();
    const bytes = await picture(2000, 1000);
    const body = new PassThrough();
    const pending = upload(body);
    body.write(bytes.subarray(0, 64));
    try {
      // The route has read the settings and is receiving into its staged folder.
      await vi.waitFor(() => expect(readdirSync(path.join(imagesDir, '.incoming')).length).toBe(1), {
        timeout: 10_000,
      });
      ok(await patch({ display_variant_size: 1000 }));
    } finally {
      body.end(bytes.subarray(64));
    }
    const late = (await pending).json<Image>();
    // Made at the size it read when it started…
    expect(late.variants.display).toEqual({ width: 2000, height: 1000 });
    await app.regenerator.idle();
    // …and brought to the new one.
    expect(displayOf(late.id)).toEqual({ width: 1000, height: 500 });
    expect(displayOf(early.id)).toEqual({ width: 1000, height: 750 });
  });
});

describe('the display size, saved again unchanged (D-124)', () => {
  it('finishes a regeneration a restart cut short', async () => {
    const image = (await upload(await picture(1600, 1200))).json<Image>();
    // The setting was saved and the server stopped before this image was regenerated.
    data.db.prepare('UPDATE settings SET display_variant_size = 800').run();
    expect(displayOf(image.id)).toEqual({ width: 1600, height: 1200 });
    ok(await patch({ display_variant_size: 800 }));
    await app.regenerator.idle();
    expect(displayOf(image.id)).toEqual({ width: 800, height: 600 });
  });
});

describe('closing the server while display versions are regenerated (review C-M2)', () => {
  it('stops the worker before the database closes, with no error and nothing left staged', async () => {
    const events: string[] = [];
    const record = (event: string) => void events.push(event);
    await app.close();
    app = await buildTestApp(data, { logger: { info: record, warn: record, error: record } });
    // As server.ts does: the database closes in an onClose hook registered after the app's own.
    const db = data.db;
    app.addHook('onClose', () => db.close());
    cookie = dmCookie(await app.inject({ method: 'POST', url: '/api/auth', payload: { pin: '4826' } }));
    for (let n = 0; n < 3; n++) expect((await upload(await picture(3000, 2000))).statusCode).toBe(201);
    ok(await patch({ display_variant_size: 1024 }));
    await app.close();
    expect(events.filter((event) => event.startsWith('images.regenerate'))).toEqual([]);
    expect(readdirSync(path.join(imagesDir, '.incoming'))).toEqual([]);
    // afterEach closes the app again; give it a database to find.
    data.db = data.reopen();
    app = await buildTestApp(data);
  });
});

function ok(response: LightMyRequestResponse): Settings {
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Settings>();
}
