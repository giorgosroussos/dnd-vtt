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
import { buildTestApp, createTestData, setUpPin, type TestData } from './testing/app.js';

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
    // The route has read the settings and is receiving into its staged folder.
    await vi.waitFor(() => expect(readdirSync(path.join(imagesDir, '.incoming')).length).toBe(1));

    ok(await patch({ display_variant_size: 1000 }));
    body.end(bytes.subarray(64));
    const late = (await pending).json<Image>();
    // Made at the size it read when it started…
    expect(late.variants.display).toEqual({ width: 2000, height: 1000 });
    await app.regenerator.idle();
    // …and brought to the new one.
    expect(displayOf(late.id)).toEqual({ width: 1000, height: 500 });
    expect(displayOf(early.id)).toEqual({ width: 1000, height: 750 });
  });
});

function ok(response: LightMyRequestResponse): Settings {
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Settings>();
}
