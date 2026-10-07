import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import yauzl from 'yauzl';
import {
  ARCHIVE_FORMAT_VERSION,
  ErrorEnvelopeSchema,
  ImportSummarySchema,
  MAX_ARCHIVE_ENTRIES,
  type ErrorEnvelope,
  type ImportProgress,
  type ImportSummary,
  type LibraryAsset,
} from '@emberglass/shared';
import { readCampaignExport, type CampaignExport } from '../db/archive.js';
import { readAsset } from '../db/assets.js';
import { DATABASE_FILE } from '../db/database.js';
import { readImage } from '../db/images.js';
import { readSettings, setLiveScene } from '../db/settings.js';
import { imageFilePath, imagesDirOf } from '../images/store.js';
import { rawZip, type RawEntry } from '../archive/testing/zip.js';
import { compileSchema } from '../validation.js';
import { buildTestApp, createTestData, setUpPin, type TestData } from './testing/app.js';

// DMT-05: export and import against real SQLite files and real images folders (specs/09-operations.md §9,
// specs/07-security-and-access.md §9, specs/05-assets-and-images.md §6, specs/10-testing-acceptance.md §3, Q-115,
// Q-119, D-181). A campaign and library assets are exported from one data directory and imported on an empty one and
// on one already holding them; every refusal is checked to leave the database file and the images folder byte for
// byte as they were.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const isEnvelope = compileSchema<ErrorEnvelope>(ErrorEnvelopeSchema);
const isSummary = compileSchema<ImportSummary>(ImportSummarySchema);
const MB = 1024 * 1024;

interface Server {
  data: TestData;
  app: FastifyInstance;
  cookie: string;
}
const servers: Server[] = [];

async function server(): Promise<Server> {
  const data = createTestData('emberglass-archive-');
  const app = await buildTestApp(data);
  const cookie = await setUpPin(app, '4826');
  const made = { data, app, cookie };
  servers.push(made);
  return made;
}

afterEach(async () => {
  for (const { app, data } of servers.splice(0)) {
    await app.close();
    data.remove();
  }
});

const call = (s: Server, method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown) =>
  s.app.inject({
    method,
    url,
    headers: { cookie: s.cookie },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

async function json<T>(
  s: Server,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  url: string,
  payload?: unknown,
): Promise<T> {
  const response = await call(s, method, url, payload);
  expect(response.statusCode, `${method} ${url}: ${response.body}`).toBeLessThan(300);
  return response.json<T>();
}

let seed = 0;
function picture(width = 64, height = 48): Promise<Buffer> {
  const [r, g, b] = createHash('sha256').update(`archive ${seed++}`).digest();
  return sharp({ create: { width, height, channels: 3, background: { r: r!, g: g!, b: b! } } })
    .png()
    .toBuffer();
}

async function upload(s: Server, bytes: Buffer): Promise<string> {
  const response = await s.app.inject({
    method: 'POST',
    url: '/api/images',
    payload: bytes,
    headers: { cookie: s.cookie, 'content-type': 'application/octet-stream' },
  });
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.json<{ id: string }>().id;
}

interface Seeded {
  campaignId: string;
  goblin: LibraryAsset;
  hero: LibraryAsset;
  sceneId: string;
  maplessId: string;
}

/**
 * A campaign with every field the toolkit added: two sessions, a calibrated scene with a map and painted fog, hidden
 * and visible tokens with hit points, armour class, markers and notes, the scene's notes, a map-less scene, and an
 * encounter with a player character's entry and two monsters'.
 */
async function seedCampaign(s: Server, name = 'Curse of the Fallen'): Promise<Seeded> {
  const map = await upload(s, await picture(400, 300));
  const goblin = await json<LibraryAsset>(s, 'POST', '/api/assets', {
    name: 'Goblin',
    image_id: await upload(s, await picture()),
    category: 'monster',
    size: 'small',
    tags: ['Cave', 'goblinoid'],
    notes: 'Nimble Escape.',
    hp_max: 7,
    ac: 15,
  });
  const hero = await json<LibraryAsset>(s, 'POST', '/api/assets', {
    name: 'Aria',
    image_id: await upload(s, await picture()),
    category: 'pc',
    size: 'medium',
  });
  const campaign = await json<{ id: string }>(s, 'POST', '/api/campaigns', { name, description: 'Act one.' });
  const first = await json<{ id: string }>(s, 'POST', `/api/campaigns/${campaign.id}/sessions`, {
    title: 'The crypt',
    date: '2026-10-09',
  });
  await json(s, 'POST', `/api/campaigns/${campaign.id}/sessions`, { title: 'The road' });
  const scene = await json<{ id: string }>(s, 'POST', `/api/sessions/${first.id}/scenes`, {
    name: 'Crypt',
    map_image_id: map,
  });
  await json(s, 'PATCH', `/api/scenes/${scene.id}`, {
    grid: { size: 40, offset_x: 2.5, offset_y: 0, columns: 10, rows: 7, feet_per_square: 5 },
  });
  const mapless = await json<{ id: string }>(s, 'POST', `/api/sessions/${first.id}/scenes`, { name: 'Interlude' });
  const place = (asset: string, x: number, y: number) =>
    json<{ token: { id: string } }>(s, 'POST', `/api/scenes/${scene.id}/tokens`, { asset_id: asset, x, y });
  const g1 = (await place(goblin.id, 2.5, 3.5)).token.id;
  const g2 = (await place(goblin.id, 6.5, 1.5)).token.id;
  const pc = (await place(hero.id, 1.5, 1.5)).token.id;
  await json(s, 'PATCH', `/api/tokens/${g1}`, { hidden: false, hp_current: 3, markers: [{ id: 'poisoned' }] });
  await json(s, 'PATCH', `/api/tokens/${pc}`, { hp_max: 24, hp_current: 24, hp_temp: 5, ac: 16 });
  await json(s, 'PUT', `/api/tokens/${g1}/notes`, { notes: 'Carries the key.\nFlees at 2 HP.' });
  await json(s, 'PUT', `/api/scenes/${scene.id}/notes`, { notes: 'Trap at the door: DC 13.' });
  // Map notes (UXR-08), the second empty.
  await json(s, 'POST', `/api/scenes/${scene.id}/map-notes`, { x: 4.5, y: 2.5, notes: 'Loose flagstone: pit trap.' });
  await json(s, 'POST', `/api/scenes/${scene.id}/map-notes`, { x: 0.25, y: 6.75 });
  await json(s, 'POST', `/api/scenes/${scene.id}/fog`, {
    stroke: {
      mode: 'paint',
      radius: 1,
      points: [
        { x: 6.5, y: 1.5 },
        { x: 8, y: 2 },
      ],
    },
  });
  await json(s, 'POST', `/api/scenes/${mapless.id}/tokens`, { asset_id: hero.id, x: 0.5, y: 0.5 });
  // The encounter is made by live commands only; here it is written as they store it (db/encounters.ts).
  s.data.db
    .prepare(
      `INSERT INTO encounter (id, scene_id, active, round, current_index, enemies_seen, entries) VALUES (?, ?, 1, 2, 1, 1, ?)`,
    )
    .run(
      '4b3f8d2e-6c1a-4e5f-9a7b-1c2d3e4f5a6b',
      scene.id,
      JSON.stringify([
        { id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', kind: 'pc', token_id: pc, initiative: 18 },
        { id: '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e', kind: 'monster', token_id: g1, initiative: 12 },
        { id: '2c3d4e5f-6a7b-4c8d-ae9f-1a2b3c4d5e6f', kind: 'monster', token_id: g2, initiative: null },
      ]),
    );
  return { campaignId: campaign.id, goblin, hero, sceneId: scene.id, maplessId: mapless.id };
}

async function exportCampaign(s: Server, id: string): Promise<Buffer> {
  const response = await call(s, 'GET', `/api/export/campaigns/${id}`);
  expect(response.statusCode, response.body).toBe(200);
  expect(response.headers['content-type']).toBe('application/zip');
  return response.rawPayload;
}

const importZip = (s: Server, archive: Buffer | Readable, headers: Record<string, string> = {}) =>
  s.app.inject({
    method: 'POST',
    url: '/api/import',
    payload: archive,
    headers: { cookie: s.cookie, 'content-type': 'application/zip', ...headers },
  });

async function imported(s: Server, archive: Buffer): Promise<ImportSummary> {
  const response = await importZip(s, archive);
  expect(response.statusCode, response.body).toBe(200);
  const summary = response.json<unknown>();
  expect(isSummary(summary), JSON.stringify(isSummary.errors)).toBe(true);
  return summary as ImportSummary;
}

/** The archive's entries, by name. */
async function unzip(archive: Buffer): Promise<Map<string, Buffer>> {
  const zip = await yauzl.fromBufferPromise(archive, { lazyEntries: true });
  const entries = new Map<string, Buffer>();
  for await (const entry of zip.eachEntry()) {
    const chunks: Buffer[] = [];
    for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk as Buffer);
    entries.set(entry.fileName, Buffer.concat(chunks));
  }
  return entries;
}

/** A zip of `entries`, changed by `change` first. */
async function rezip(archive: Buffer, change: (entries: Map<string, Buffer>) => void): Promise<Buffer> {
  const entries = await unzip(archive);
  change(entries);
  return rawZip([...entries].map(([name, data]) => ({ name, data })));
}

const parsed = <T>(entries: Map<string, Buffer>, name: string): T => JSON.parse(entries.get(name)!.toString()) as T;
const put = (entries: Map<string, Buffer>, name: string, value: unknown) =>
  entries.set(name, Buffer.from(JSON.stringify(value)));

/** The database file and every file of the images folder, each by its sha256: what a refusal must leave as it was. */
function fingerprint({ data }: Server): Record<string, string> {
  const sum = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files[`${path.relative(data.dataDir, full)}/`] = 'folder';
        walk(full);
      } else files[path.relative(data.dataDir, full)] = sum(full);
    }
  };
  walk(imagesDirOf(data.dataDir));
  for (const name of readdirSync(data.dataDir)) {
    if (name.startsWith(DATABASE_FILE)) files[name] = sum(path.join(data.dataDir, name));
  }
  return files;
}

/**
 * A campaign export with every identifier the import renews replaced by its place, so a copy compares equal to its
 * original; asset and image identifiers, which an import keeps, are kept.
 */
function canonical(exported: CampaignExport): unknown {
  const names = new Map<string, string>([[exported.campaign.id, 'campaign']]);
  const sessions = [...exported.sessions].sort((a, b) => a.order - b.order);
  sessions.forEach((session, index) => names.set(session.id, `session ${index}`));
  const scenes = [...exported.scenes].sort((a, b) =>
    a.session_id === b.session_id
      ? a.order - b.order
      : names.get(a.session_id)!.localeCompare(names.get(b.session_id)!),
  );
  scenes.forEach((scene, index) => names.set(scene.id, `scene ${index}`));
  const place = (token: CampaignExport['tokens'][number]) =>
    `${names.get(token.scene_id)} ${String(token.z_order).padStart(6, '0')} ${token.label}`;
  const tokens = [...exported.tokens].sort((a, b) => place(a).localeCompare(place(b)));
  tokens.forEach((token, index) => names.set(token.id, `token ${index}`));
  // Map notes take their new ids in the order of their scene and place, which the copy keeps.
  const at = (note: CampaignExport['mapnotes'][number]) => `${names.get(note.scene_id)} ${note.x} ${note.y}`;
  const mapnotes = [...exported.mapnotes].sort((a, b) => at(a).localeCompare(at(b)));
  mapnotes.forEach((note, index) => names.set(note.id, `map note ${index}`));
  exported.encounters.forEach((encounter) => {
    names.set(encounter.id, `encounter of ${names.get(encounter.scene_id)}`);
    encounter.entries.forEach((entry, index) =>
      names.set(entry.id, `entry ${index} of ${names.get(encounter.scene_id)}`),
    );
  });
  const renamed = { ...exported, campaign: { ...exported.campaign, name: 'any' }, sessions, scenes, tokens, mapnotes };
  return JSON.parse(JSON.stringify(renamed), (_key, value: unknown) =>
    typeof value === 'string' && names.has(value) ? names.get(value) : value,
  );
}

function expectRefused(
  response: LightMyRequestResponse,
  status: number,
  code: ErrorEnvelope['error']['code'],
): ErrorEnvelope {
  expect(response.statusCode, response.body).toBe(status);
  const body: unknown = response.json();
  expect(isEnvelope(body), JSON.stringify(isEnvelope.errors)).toBe(true);
  expect((body as ErrorEnvelope).error.code, response.body).toBe(code);
  return body as ErrorEnvelope;
}

describe('a campaign export and import (specs/10-testing-acceptance.md §3)', () => {
  it('exports one zip with a versioned manifest, the data as JSON and images named by sha256', async () => {
    const a = await server();
    const seeded = await seedCampaign(a);
    const response = await call(a, 'GET', `/api/export/campaigns/${seeded.campaignId}`);
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="Curse of the Fallen-\d{4}-\d{2}-\d{2}\.zip"; filename\*=UTF-8''Curse%20of%20the%20Fallen-/,
    );
    const entries = await unzip(response.rawPayload);
    const manifest = parsed<Record<string, unknown>>(entries, 'manifest.json');
    expect(manifest).toMatchObject({
      format_version: ARCHIVE_FORMAT_VERSION,
      kind: 'campaign',
      counts: { campaigns: 1, sessions: 2, scenes: 2, tokens: 4, encounters: 1, map_notes: 2, assets: 2, images: 3 },
    });
    expect(ARCHIVE_FORMAT_VERSION).toBe(2);
    const images = manifest.images as string[];
    expect([...entries.keys()].sort()).toEqual(
      [
        'manifest.json',
        ...['assets', 'campaign', 'encounters', 'images', 'mapnotes', 'scenes', 'sessions', 'tokens'].map(
          (n) => `data/${n}.json`,
        ),
        ...images.map((id) => `images/${id}.png`),
      ].sort(),
    );
    for (const id of images) {
      expect(
        createHash('sha256')
          .update(entries.get(`images/${id}.png`)!)
          .digest('hex'),
      ).toBe(id);
    }
    // Every field of DMT-01 to DMT-04, and the stored fields no client receives.
    const tokens = parsed<Record<string, unknown>[]>(entries, 'data/tokens.json');
    expect(tokens.find((token) => token.notes === 'Carries the key.\nFlees at 2 HP.')).toMatchObject({
      hp_current: 3,
      hp_max: 7,
      ac: 15,
      markers: [{ id: 'poisoned' }],
      shown: true,
    });
    const scene = parsed<Record<string, unknown>[]>(entries, 'data/scenes.json').find((each) => each.name === 'Crypt')!;
    expect(scene).toMatchObject({ notes: 'Trap at the door: DC 13.', token_numbers: { [seeded.goblin.id]: 1 } });
    expect((scene.fog as unknown[]).length).toBeGreaterThan(0);
    const mapnotes = parsed<Record<string, unknown>[]>(entries, 'data/mapnotes.json');
    expect(mapnotes.map((note) => [note.scene_id, note.x, note.y, note.notes]).sort()).toEqual(
      [
        [scene.id, 0.25, 6.75, ''],
        [scene.id, 4.5, 2.5, 'Loose flagstone: pit trap.'],
      ].sort(),
    );
    for (const note of mapnotes) expect(Object.keys(note).sort()).toEqual(['id', 'notes', 'scene_id', 'x', 'y']);
    expect(
      parsed<Record<string, unknown>[]>(entries, 'data/assets.json').find((x) => x.id === seeded.goblin.id),
    ).toEqual({ ...seeded.goblin, tags: ['cave', 'goblinoid'] });
    const [image] = parsed<Record<string, unknown>[]>(entries, 'data/images.json');
    expect(Object.keys(image!).sort()).toEqual(['grid_preset', 'height', 'id', 'mime', 'width']);
    // Never live state or settings.
    const text = [...entries.values()].map((bytes) => bytes.toString('latin1')).join('');
    for (const word of ['live_scene_id', 'upload_limit', 'pin_hash', 'camera', 'undo'])
      expect(text).not.toContain(word);
  });

  it('imports on an empty data directory as a copy with new identifiers that reads back unchanged', async () => {
    const a = await server();
    const seeded = await seedCampaign(a);
    const archive = await exportCampaign(a, seeded.campaignId);
    const b = await server();

    const summary = await imported(b, archive);

    expect(summary).toEqual({
      kind: 'campaign',
      campaign: { id: summary.campaign!.id, name: 'Curse of the Fallen' },
      sessions: 2,
      scenes: 2,
      tokens: 4,
      assets: { added: 2, reused: 0 },
      images: { added: 3, reused: 0 },
    });
    const original = readCampaignExport(a.data.db, seeded.campaignId)!;
    const copy = readCampaignExport(b.data.db, summary.campaign!.id)!;
    expect(canonical(copy)).toEqual(canonical(original));
    // Every identifier of the campaign is new; the assets and images keep theirs (D-181).
    const ids = (exported: CampaignExport) => [
      exported.campaign.id,
      ...exported.sessions.map((x) => x.id),
      ...exported.scenes.map((x) => x.id),
      ...exported.tokens.map((x) => x.id),
      ...exported.encounters.flatMap((x) => [x.id, ...x.entries.map((entry) => entry.id)]),
      ...exported.mapnotes.map((x) => x.id),
    ];
    expect(copy.mapnotes).toHaveLength(2);
    for (const id of ids(copy)) expect(ids(original)).not.toContain(id);
    expect(copy.assets).toEqual(original.assets);
    // Every image with its three versions, produced here from the original.
    for (const image of copy.images) {
      const stored = readImage(b.data.db, image.id)!;
      expect(stored.variants.display).toBeDefined();
      expect(stored.variants.thumbnail).toEqual(readImage(a.data.db, image.id)!.variants.thumbnail);
      for (const variant of ['original', 'display', 'thumbnail'] as const) {
        expect(existsSync(imageFilePath(imagesDirOf(b.data.dataDir), image.id, variant)), variant).toBe(true);
      }
    }
    expect(readdirSync(path.join(imagesDirOf(b.data.dataDir), '.incoming'))).toEqual([]);
    // The tree and the tokens read back over REST as the DM view reads them.
    const labels = async (s: Server, sceneId: string) =>
      (await json<{ label: string; hp_temp: number | null }[]>(s, 'GET', `/api/scenes/${sceneId}/tokens`)).map(
        (token) => `${token.label} ${token.hp_temp}`,
      );
    expect(await labels(b, copy.scenes[0]!.id)).toEqual(await labels(a, original.scenes[0]!.id));
  });

  it('puts each map note on the new scene its own scene became (UXR-08)', async () => {
    const a = await server();
    const seeded = await seedCampaign(a);
    await json(a, 'POST', `/api/scenes/${seeded.maplessId}/map-notes`, { x: 1.5, y: 1.5, notes: 'Interlude note.' });
    const b = await server();

    const summary = await imported(b, await exportCampaign(a, seeded.campaignId));

    const copy = readCampaignExport(b.data.db, summary.campaign!.id)!;
    const sceneName = new Map(copy.scenes.map((scene) => [scene.id, scene.name]));
    expect(copy.mapnotes.map((note) => `${sceneName.get(note.scene_id)}: ${note.notes}`).sort()).toEqual([
      'Crypt: ',
      'Crypt: Loose flagstone: pit trap.',
      'Interlude: Interlude note.',
    ]);
    for (const scene of copy.scenes) {
      const listed = await json<{ notes: string }[]>(b, 'GET', `/api/scenes/${scene.id}/map-notes`);
      expect(listed).toHaveLength(scene.name === 'Crypt' ? 2 : 1);
    }
  });

  it('reuses every image by hash and every asset by identifier on a data directory that holds them, the copy renamed', async () => {
    const a = await server();
    const seeded = await seedCampaign(a);
    const archive = await exportCampaign(a, seeded.campaignId);

    const summary = await imported(a, archive);

    expect(summary).toMatchObject({
      campaign: { name: 'Curse of the Fallen (2)' },
      assets: { added: 0, reused: 2 },
      images: { added: 0, reused: 3 },
    });
    expect(canonical(readCampaignExport(a.data.db, summary.campaign!.id)!)).toEqual(
      canonical(readCampaignExport(a.data.db, seeded.campaignId)!),
    );
    expect((await imported(a, archive)).campaign!.name).toBe('Curse of the Fallen (3)');
  });

  it('makes two independent copies when the same campaign is imported twice', async () => {
    const a = await server();
    const seeded = await seedCampaign(a);
    const archive = await exportCampaign(a, seeded.campaignId);
    const b = await server();
    const first = await imported(b, archive);
    const second = await imported(b, archive);
    expect(second).toMatchObject({ assets: { added: 0, reused: 2 }, images: { added: 0, reused: 3 } });
    const one = readCampaignExport(b.data.db, first.campaign!.id)!;
    const two = readCampaignExport(b.data.db, second.campaign!.id)!;
    expect(two.tokens.map((t) => t.id).filter((id) => one.tokens.some((t) => t.id === id))).toEqual([]);
    // A change to one copy is not a change to the other.
    const token = one.tokens.find((t) => t.hp_current === 3)!;
    await json(b, 'PATCH', `/api/tokens/${token.id}`, { hp_current: 1 });
    await json(b, 'PUT', `/api/scenes/${one.scenes[0]!.id}/notes`, { notes: 'Only the first copy.' });
    const after = readCampaignExport(b.data.db, second.campaign!.id)!;
    expect(canonical(after)).toEqual(canonical(two));
    const summary = await json<Record<string, unknown>>(b, 'GET', `/api/campaigns/${first.campaign!.id}/deletion`);
    const removed = await b.app.inject({
      method: 'DELETE',
      url: `/api/campaigns/${first.campaign!.id}`,
      headers: { cookie: b.cookie },
      payload: { confirm: summary },
    });
    expect(removed.statusCode, removed.body).toBeLessThan(300);
    expect(canonical(readCampaignExport(b.data.db, second.campaign!.id)!)).toEqual(canonical(two));
  });

  it('reuses an existing asset as it is, never overwriting it with the archive version', async () => {
    const a = await server();
    const seeded = await seedCampaign(a);
    const archive = await exportCampaign(a, seeded.campaignId);
    const b = await server();
    await imported(b, archive);
    const renamed = await json<LibraryAsset>(b, 'PATCH', `/api/assets/${seeded.goblin.id}`, {
      name: 'Cave goblin',
      hp_max: 9,
      tags: ['local'],
    });

    const summary = await imported(b, archive);

    expect(summary.assets).toEqual({ added: 0, reused: 2 });
    expect(readAsset(b.data.db, seeded.goblin.id)).toEqual(renamed);
  });

  it('is allowed while a scene is live, and touches no live state', async () => {
    const a = await server();
    const seeded = await seedCampaign(a);
    const archive = await exportCampaign(a, seeded.campaignId);
    setLiveScene(a.data.db, seeded.sceneId);
    const before = readSettings(a.data.db);
    await imported(a, archive);
    expect(readSettings(a.data.db)).toEqual(before);
  });
});

describe('a library export and import', () => {
  it('exports the assets selected, or all, with their tags and images, and imports them keeping their identifiers', async () => {
    const a = await server();
    const seeded = await seedCampaign(a);
    const selected = await call(a, 'GET', `/api/export/assets?id=${seeded.goblin.id}`);
    expect(selected.statusCode, selected.body).toBe(200);
    expect(selected.headers['content-disposition']).toMatch(/^attachment; filename="library-\d{4}-\d{2}-\d{2}\.zip"/);
    const one = await unzip(selected.rawPayload);
    expect(parsed<{ kind: string }>(one, 'manifest.json').kind).toBe('assets');
    expect([...one.keys()].filter((name) => name.startsWith('data/')).sort()).toEqual([
      'data/assets.json',
      'data/images.json',
    ]);
    expect(parsed<LibraryAsset[]>(one, 'data/assets.json')).toEqual([readAsset(a.data.db, seeded.goblin.id)]);
    const all = await call(a, 'GET', '/api/export/assets');
    expect(
      parsed<LibraryAsset[]>(await unzip(all.rawPayload), 'data/assets.json')
        .map((x) => x.id)
        .sort(),
    ).toEqual([seeded.goblin.id, seeded.hero.id].sort());
    const both = await call(a, 'GET', `/api/export/assets?id=${seeded.goblin.id}&id=${seeded.hero.id}`);
    expect(parsed<LibraryAsset[]>(await unzip(both.rawPayload), 'data/assets.json')).toHaveLength(2);
    expect((await call(a, 'GET', '/api/export/assets?id=00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);

    const b = await server();
    expect(await imported(b, all.rawPayload)).toEqual({
      kind: 'assets',
      campaign: null,
      sessions: 0,
      scenes: 0,
      tokens: 0,
      assets: { added: 2, reused: 0 },
      images: { added: 2, reused: 0 },
    });
    expect(readAsset(b.data.db, seeded.goblin.id)).toEqual(readAsset(a.data.db, seeded.goblin.id));
    expect(await imported(a, all.rawPayload)).toMatchObject({
      assets: { added: 0, reused: 2 },
      images: { added: 0, reused: 2 },
    });
  });
});

describe('an import refused stores nothing (specs/07-security-and-access.md §9)', () => {
  /** A server holding a campaign, and that campaign's archive to tamper with. */
  async function holding(): Promise<{ s: Server; archive: Buffer; seeded: Seeded }> {
    const s = await server();
    const seeded = await seedCampaign(s);
    return { s, archive: await exportCampaign(s, seeded.campaignId), seeded };
  }

  async function refused(s: Server, archive: Buffer | Readable, status: number, code: ErrorEnvelope['error']['code']) {
    const before = fingerprint(s);
    const body = expectRefused(await importZip(s, archive), status, code);
    expect(fingerprint(s)).toEqual(before);
    return body;
  }

  it('imports a format-1 archive, written before map notes, with none (UXR-08, specs/09-operations.md §9)', async () => {
    const a = await server();
    const seeded = await seedCampaign(a);
    const archive = await exportCampaign(a, seeded.campaignId);
    const formatOne = await rezip(archive, (e) => {
      e.delete('data/mapnotes.json');
      const manifest = parsed<{ counts: Record<string, number> }>(e, 'manifest.json');
      const counts = { ...manifest.counts };
      delete counts.map_notes;
      put(e, 'manifest.json', { ...manifest, format_version: 1, counts });
    });
    const b = await server();

    const summary = await imported(b, formatOne);

    const copy = readCampaignExport(b.data.db, summary.campaign!.id)!;
    expect(copy.mapnotes).toEqual([]);
    expect(copy.tokens).toHaveLength(4);
  });

  it('refuses a format-1 archive carrying data/mapnotes.json, a file format 1 never had', async () => {
    const { s, archive } = await holding();
    const stray = await rezip(archive, (e) => {
      const manifest = parsed<{ counts: Record<string, number> }>(e, 'manifest.json');
      const counts = { ...manifest.counts };
      delete counts.map_notes;
      put(e, 'manifest.json', { ...manifest, format_version: 1, counts });
    });
    const body = await refused(s, stray, 422, 'import_unsafe_entry');
    expect(body.error.details?.[0]?.path).toBe('data/mapnotes.json');
  });

  it('refuses a newer format version, naming it', async () => {
    const { s, archive } = await holding();
    const newer = await rezip(archive, (entries) => {
      put(entries, 'manifest.json', { ...parsed<object>(entries, 'manifest.json'), format_version: 3, novelty: true });
    });
    const body = await refused(s, newer, 422, 'import_newer_format');
    expect(body.error.format_version).toBe(3);
  });

  it('refuses an archive over the import limit, and one whose entries unpack beyond it', async () => {
    const { s, archive } = await holding();
    await json(s, 'PATCH', '/api/settings', { import_limit_bytes: MB });
    // Over the limit as sent: incompressible bytes, so the zip itself is larger.
    const noise = createHash('sha256');
    const padding = Buffer.concat(Array.from({ length: 40_000 }, (_, i) => noise.copy().update(String(i)).digest()));
    const oversized = await rezip(archive, (entries) => {
      entries.set('data/assets.json', Buffer.concat([entries.get('data/assets.json')!, padding]));
    });
    expect(oversized.length).toBeGreaterThan(MB);
    await refused(s, oversized, 413, 'import_too_large');
    // Sent as a stream without a length, so it is cut off as it arrives.
    await refused(s, Readable.from([oversized]), 413, 'import_too_large');
    // Small as sent, beyond the limit once unpacked: zeros compress to nearly nothing.
    const unpacksBig = await rezip(archive, (entries) => entries.set('data/tokens.json', Buffer.alloc(2 * MB, 0x20)));
    expect(unpacksBig.length).toBeLessThan(MB);
    await refused(s, unpacksBig, 413, 'import_too_large');
  });

  it('cuts off a zip bomb whose headers lie about its size', async () => {
    const { s, archive } = await holding();
    const entries = await unzip(archive);
    const bomb = rawZip(
      [
        ...[...entries].map(([name, data]) => ({ name, data })),
        // 64 MB of spaces declared as 100 bytes, in place of the scenes.
      ].map((entry) =>
        entry.name === 'data/scenes.json' ? { ...entry, data: Buffer.alloc(64 * MB, 0x20), declaredSize: 100 } : entry,
      ),
    );
    expect(bomb.length).toBeLessThan(MB);
    const body = await refused(s, bomb, 422, 'import_invalid');
    expect(body.error.details?.[0]?.message).toMatch(/more than its headers declare/);
  });

  it.each([
    ['a parent folder', '../manifest.json'],
    ['a parent folder inside', 'data/../../escape.json'],
    ['an absolute path', '/etc/emberglass.json'],
    ['a drive letter', 'C:/escape.json'],
    ['a backslash', 'data\\..\\..\\escape.json'],
    ['a current folder', 'data/./tokens.json'],
    ['a name outside the layout', 'notes.txt'],
    ['an image of another type', `images/${'a'.repeat(64)}.gif`],
  ])('refuses an entry with %s (zip slip and the layout)', async (_name, entry) => {
    const { s, archive } = await holding();
    await refused(
      s,
      await rezip(archive, (entries) => entries.set(entry, Buffer.from('{}'))),
      422,
      'import_unsafe_entry',
    );
  });

  it('refuses a name with a byte no path may hold', async () => {
    const { s, archive } = await holding();
    const entries = [...(await unzip(archive))].map(([name, data]): RawEntry => ({ name, data }));
    for (const name of [
      Buffer.from('data/tokens.json\0.png'),
      Buffer.from([0x64, 0x61, 0x74, 0x61, 0x2f, 0xc0, 0xae]),
    ]) {
      await refused(s, rawZip([...entries, { name, data: Buffer.from('x') }]), 422, 'import_unsafe_entry');
    }
  });

  it('refuses a link, a duplicate entry, an encrypted entry and too many entries', async () => {
    const { s, archive } = await holding();
    const entries = [...(await unzip(archive))].map(([name, data]): RawEntry => ({ name, data }));
    const manifest = entries.find((entry) => entry.name === 'manifest.json')!;
    const others = entries.filter((entry) => entry !== manifest);
    // manifest.json as a symbolic link to a file elsewhere.
    await refused(
      s,
      rawZip([
        ...others,
        { name: 'manifest.json', data: Buffer.from('/etc/passwd'), method: 0, externalAttributes: 0o120777 * 0x10000 },
      ]),
      422,
      'import_unsafe_entry',
    );
    await refused(s, rawZip([...entries, manifest]), 422, 'import_unsafe_entry');
    await refused(s, rawZip([...others, { ...manifest, flags: 0x1 }]), 422, 'import_unsafe_entry');
    const many = Array.from({ length: MAX_ARCHIVE_ENTRIES + 1 }, (): RawEntry => ({ name: 'data/' }));
    const body = await refused(s, rawZip(many), 422, 'import_unsafe_entry');
    expect(body.error.details?.[0]?.message).toMatch(/more than the 100000/);
  });

  it('refuses what is not a zip, malformed JSON, a schema violation and a missing data file', async () => {
    const { s, archive } = await holding();
    await refused(s, Buffer.from('PK not really a zip'), 422, 'import_invalid');
    await refused(s, Buffer.alloc(0), 422, 'import_invalid');
    await refused(
      s,
      await rezip(archive, (e) => e.set('data/tokens.json', Buffer.from('[{"id": '))),
      422,
      'import_invalid',
    );
    const tokens = parsed<Record<string, unknown>[]>(await unzip(archive), 'data/tokens.json');
    for (const change of [
      { ...tokens[0], favourite: true },
      { ...tokens[0], hp_max: 'seven' },
      { ...tokens[0], hp_current: -4 },
      { ...tokens[0], character_id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' },
      { ...tokens[0], notes: 'x'.repeat(20_001) },
      // A position bounded as REST and the live commands bound it.
      { ...tokens[0], x: 1e7 },
    ]) {
      const body = await refused(
        s,
        await rezip(archive, (e) => put(e, 'data/tokens.json', [change, ...tokens.slice(1)])),
        422,
        'import_invalid',
      );
      expect(body.error.details?.[0]?.path).toBe('data/tokens.json');
    }
    await refused(s, await rezip(archive, (e) => e.delete('data/encounters.json')), 422, 'import_invalid');
    // Format 2 must carry its map notes (UXR-08); one too long, or on a scene not of the campaign, is refused.
    await refused(s, await rezip(archive, (e) => e.delete('data/mapnotes.json')), 422, 'import_invalid');
    const mapnotes = parsed<Record<string, unknown>[]>(await unzip(archive), 'data/mapnotes.json');
    for (const change of [
      { ...mapnotes[0], notes: 'x'.repeat(20_001) },
      { ...mapnotes[0], x: 'east' },
      // Bounded as REST bounds it.
      { ...mapnotes[0], x: 1e7 },
      { ...mapnotes[0], scene_id: '00000000-0000-4000-8000-000000000000' },
    ]) {
      const body = await refused(
        s,
        await rezip(archive, (e) => put(e, 'data/mapnotes.json', [change, ...mapnotes.slice(1)])),
        422,
        'import_invalid',
      );
      expect(body.error.details?.[0]?.path).toBe('data/mapnotes.json');
    }
    // The same map note twice, under one id.
    const twin = await refused(
      s,
      await rezip(archive, (e) => {
        put(e, 'data/mapnotes.json', [...mapnotes, { ...mapnotes[1], id: mapnotes[0]!.id }]);
        const manifest = parsed<{ counts: Record<string, number> }>(e, 'manifest.json');
        put(e, 'manifest.json', { ...manifest, counts: { ...manifest.counts, map_notes: mapnotes.length + 1 } });
      }),
      422,
      'import_invalid',
    );
    expect(twin.error.details?.[0]?.path).toBe('data/mapnotes.json');
    expect(twin.error.details?.[0]?.message).toMatch(/holds map note .* twice/);
    await refused(s, await rezip(archive, (e) => e.delete('manifest.json')), 422, 'import_invalid');
    await refused(
      s,
      await rezip(archive, (e) => {
        const manifest = parsed<{ counts: Record<string, number> }>(e, 'manifest.json');
        put(e, 'manifest.json', { ...manifest, counts: { ...manifest.counts, tokens: 99 } });
      }),
      422,
      'import_invalid',
    );
  });

  it('refuses a token whose asset, a scene whose map or an asset whose image is neither in the archive nor held', async () => {
    const { s, archive } = await holding();
    const empty = await server();
    const entries = await unzip(archive);
    const assets = parsed<LibraryAsset[]>(entries, 'data/assets.json');
    const images = parsed<{ id: string }[]>(entries, 'data/images.json');
    const dropAsset = await rezip(archive, (e) => {
      put(e, 'data/assets.json', assets.slice(1));
      const manifest = parsed<{ counts: Record<string, number> }>(e, 'manifest.json');
      put(e, 'manifest.json', { ...manifest, counts: { ...manifest.counts, assets: assets.length - 1 } });
    });
    await refused(empty, dropAsset, 422, 'import_invalid');
    const scenes = parsed<{ map_image_id: string | null }[]>(entries, 'data/scenes.json');
    const map = scenes.find((scene) => scene.map_image_id !== null)!.map_image_id!;
    const dropImage = (id: string) =>
      rezip(archive, (e) => {
        put(
          e,
          'data/images.json',
          images.filter((image) => image.id !== id),
        );
        e.delete(`images/${id}.png`);
        const manifest = parsed<{ counts: Record<string, number>; images: string[] }>(e, 'manifest.json');
        put(e, 'manifest.json', {
          ...manifest,
          counts: { ...manifest.counts, images: images.length - 1 },
          images: manifest.images.filter((each) => each !== id),
        });
      });
    const body = await refused(empty, await dropImage(map), 422, 'import_invalid');
    expect(body.error.details?.[0]?.message).toMatch(/map is neither in the archive nor on this server/);
    await refused(empty, await dropImage(assets[0]!.image_id), 422, 'import_invalid');
    // An encounter entry naming a token of another scene, or none.
    const encounters = parsed<{ entries: { token_id: string }[] }[]>(entries, 'data/encounters.json');
    const stray = structuredClone(encounters);
    stray[0]!.entries[0]!.token_id = '00000000-0000-4000-8000-000000000000';
    await refused(empty, await rezip(archive, (e) => put(e, 'data/encounters.json', stray)), 422, 'import_invalid');
    // The same archive still imports where the references are held.
    expect((await importZip(s, dropAsset)).statusCode).toBe(200);
  });

  it('refuses an image whose bytes are not its sha256, one failing the upload checks, and one over the upload limit', async () => {
    const { s, archive } = await holding();
    const entries = await unzip(archive);
    const [id] = parsed<{ images: string[] }>(entries, 'manifest.json').images;
    // The image's bytes replaced, and every mention of its hash in the manifest and the data with the new name's.
    const swap = (bytes: Buffer, as = id!) =>
      rezip(archive, (e) => {
        e.delete(`images/${id}.png`);
        for (const [name, data] of e) e.set(name, Buffer.from(data.toString('utf8').replaceAll(id!, as)));
        e.set(`images/${as}.png`, bytes);
      });
    const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    const other = await picture();
    let body = await refused(s, await swap(other), 422, 'import_image_refused');
    expect(body.error.details?.[0]?.message).toMatch(/not the sha256 it is named by/);
    // A GIF under its own hash, and a PNG cut short, as an upload would refuse them; neither held by the server.
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(64, 1)]);
    const empty = await server();
    body = await refused(empty, await swap(gif, sha(gif)), 422, 'import_image_refused');
    expect(body.error.details?.[0]?.message).toMatch(/image\/gif/);
    const truncated = (await picture(300, 300)).subarray(0, 200);
    body = await refused(empty, await swap(truncated, sha(truncated)), 422, 'import_image_refused');
    expect(body.error.details?.[0]?.message).toMatch(/incomplete or corrupt/);
    await json(empty, 'PATCH', '/api/settings', { upload_limit_bytes: MB });
    const large = await sharp({
      create: {
        width: 1200,
        height: 1200,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
        noise: { type: 'gaussian', mean: 128, sigma: 60 },
      },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    expect(large.length).toBeGreaterThan(MB);
    body = await refused(empty, await swap(large, sha(large)), 422, 'import_image_refused');
    expect(body.error.details?.[0]?.message).toMatch(/upload limit/);
  });

  it('rolls everything back when storing fails midway', async () => {
    const { archive } = await holding();
    const empty = await server();
    // A rule the database alone enforces, broken by the last token stored, after the images and most rows.
    empty.data.db.exec(`CREATE TRIGGER refuse_token BEFORE INSERT ON token WHEN NEW.label = 'Aria'
      BEGIN SELECT RAISE(ABORT, 'refused by the test'); END`);
    const body = await refused(empty, archive, 422, 'import_invalid');
    expect(body.error.details?.[0]?.message).toMatch(/refused by the test/);
    expect(empty.data.db.prepare('SELECT count(*) FROM image').pluck().get()).toBe(0);
  });

  it('refuses a second import while one runs, saying how far the first got', async () => {
    const { s, archive } = await holding();
    const body = new PassThrough();
    const first = importZip(s, body, { 'content-length': String(archive.length) });
    body.write(archive.subarray(0, 1000));
    await vi.waitFor(async () => {
      const progress = await json<ImportProgress>(s, 'GET', '/api/import/progress');
      expect(progress).toEqual({ running: true, stage: 'receiving', done: 1000, total: archive.length });
    });
    const before = fingerprint(s);
    expectRefused(await importZip(s, archive), 409, 'import_busy');
    expect(fingerprint(s)).toEqual(before);
    body.end(archive.subarray(1000));
    expect((await first).statusCode).toBe(200);
    expect(await json<ImportProgress>(s, 'GET', '/api/import/progress')).toEqual({
      running: false,
      stage: null,
      done: 0,
      total: 0,
    });
    expect((await importZip(s, archive)).statusCode).toBe(200);
  });

  it('is unreachable without a DM session, and an import from another origin is refused', async () => {
    const { s, archive, seeded } = await holding();
    const before = fingerprint(s);
    for (const url of [`/api/export/campaigns/${seeded.campaignId}`, '/api/export/assets', '/api/import/progress']) {
      const response = await s.app.inject({ method: 'GET', url });
      expectRefused(response, 401, 'unauthorized');
      expect(response.headers['content-disposition']).toBeUndefined();
    }
    expectRefused(
      await s.app.inject({
        method: 'POST',
        url: '/api/import',
        payload: archive,
        headers: { 'content-type': 'application/zip' },
      }),
      401,
      'unauthorized',
    );
    expectRefused(await importZip(s, archive, { origin: 'http://evil.example' }), 403, 'forbidden');
    expect(fingerprint(s)).toEqual(before);
    expect(statSync(path.join(s.data.dataDir, DATABASE_FILE)).size).toBeGreaterThan(0);
  });
});
