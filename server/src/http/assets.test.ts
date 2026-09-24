import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AssetUsagesSchema,
  ErrorEnvelopeSchema,
  ImageSchema,
  LibraryAssetSchema,
  PUBLIC_API_ROUTES,
  imageFileUrl,
  type AssetUsage,
  type Campaign,
  type ErrorEnvelope,
  type Image,
  type LibraryAsset,
  type Scene,
  type Session,
} from '@emberglass/shared';
import { countRows } from '../db/testing/fixture.js';
import { imageFilePath, imagesDirOf } from '../images/store.js';
import type { Logger } from '../log/logger.js';
import { compileSchema } from '../validation.js';
import { buildTestApp, createTestData, setUpPin, type TestData } from './testing/app.js';

// SRV-05: the shared asset library over REST, against a real SQLite file and a real images
// folder (specs/02-architecture.md §5, specs/03-domain-model.md §7, specs/05-assets-and-images.md
// §1, §2, §4, §5, D-020, D-022, D-083, D-084). Every image is generated here (Q-088). Tokens
// arrive with PRP-04 and LIV-01, so the tokens an asset in use needs are inserted directly.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// Version 4, lowercase, as randomUUID makes them (D-038).
const SERVER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const isEnvelope = compileSchema<ErrorEnvelope>(ErrorEnvelopeSchema);
const isAsset = compileSchema<LibraryAsset>(LibraryAssetSchema);
const isUsages = compileSchema<AssetUsage[]>(AssetUsagesSchema);
const isImage = compileSchema<Image>(ImageSchema);

interface Line {
  level: string;
  event: string;
  message: string;
  fields: unknown;
}

let data: TestData;
let app: FastifyInstance;
let cookie: string;
let lines: Line[];

const recording = (): Logger => ({
  info: (event, message, fields) => lines.push({ level: 'info', event, message, fields }),
  warn: (event, message, fields) => lines.push({ level: 'warn', event, message, fields }),
  error: (event, message, fields) => lines.push({ level: 'error', event, message, fields }),
});

beforeEach(async () => {
  lines = [];
  data = createTestData('emberglass-assets-');
  app = await buildTestApp(data, { logger: recording() });
  cookie = await setUpPin(app, '4826');
});

afterEach(async () => {
  await app.close();
  data.remove();
});

const inject = (options: InjectOptions) =>
  app.inject({ ...options, headers: { cookie, ...(options.headers as Record<string, string> | undefined) } });
const get = (url: string) => inject({ method: 'GET', url });
const post = (url: string, payload: unknown) => inject({ method: 'POST', url, payload: payload as object });
const patch = (url: string, payload: unknown) => inject({ method: 'PATCH', url, payload: payload as object });
const del = (url: string) => inject({ method: 'DELETE', url });

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

// Generated images, each with its own sha256.
let seed = 0;
async function uploadImage(): Promise<Image> {
  const bytes = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 10, g: 80, b: 160 } } })
    .composite([
      {
        input: { create: { width: 1, height: 1, channels: 3, background: { r: 255, g: seed % 256, b: seed >> 8 } } },
        left: seed++ % 40,
        top: 0,
      },
    ])
    .png()
    .toBuffer();
  const image = ok<Image>(
    await inject({
      method: 'POST',
      url: '/api/images',
      payload: bytes,
      headers: { 'content-type': 'application/octet-stream' },
    }),
    201,
  );
  expect(isImage(image), JSON.stringify(isImage.errors)).toBe(true);
  return image;
}

interface AssetInput {
  name?: string;
  category?: 'pc' | 'npc' | 'monster' | 'object';
  size?: string;
  tags?: string[];
  notes?: string;
  default_hidden?: boolean;
  image_id?: string;
}

async function newAsset(input: AssetInput = {}): Promise<LibraryAsset> {
  const body = {
    name: 'Goblin',
    category: 'monster',
    size: 'small',
    ...input,
    image_id: input.image_id ?? (await uploadImage()).id,
  };
  const asset = ok<LibraryAsset>(await post('/api/assets', body), 201);
  expect(isAsset(asset), JSON.stringify(isAsset.errors)).toBe(true);
  return asset;
}

const list = async (query = ''): Promise<LibraryAsset[]> => {
  const assets = ok<LibraryAsset[]>(await get(`/api/assets${query}`));
  for (const asset of assets) expect(isAsset(asset), JSON.stringify(isAsset.errors)).toBe(true);
  return assets;
};
const names = async (query = ''): Promise<string[]> => (await list(query)).map((asset) => asset.name);

const newCampaign = async (name: string): Promise<Campaign> =>
  ok<Campaign>(await post('/api/campaigns', { name }), 201);
const newSession = async (campaignId: string, title: string): Promise<Session> =>
  ok<Session>(await post(`/api/campaigns/${campaignId}/sessions`, { title }), 201);
const newScene = async (sessionId: string, name: string, mapImageId?: string): Promise<Scene> =>
  ok<Scene>(
    await post(
      `/api/sessions/${sessionId}/scenes`,
      mapImageId === undefined ? { name } : { name, map_image_id: mapImageId },
    ),
    201,
  );

function insertTokens(sceneId: string, assetId: string, count: number): void {
  const insert = data.db.prepare(
    'INSERT INTO token (id, scene_id, asset_id, label, x, y, hidden, z_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (let n = 0; n < count; n++) insert.run(randomUUID(), sceneId, assetId, `Token ${n + 1}`, n, 0.5, n % 2, n);
}

// The image each token of the asset shows: a token holds none of its own (specs/05-assets-and-images.md §3).
const tokenImages = (assetId: string): string[] =>
  data.db
    .prepare('SELECT asset.image_id FROM token JOIN asset ON asset.id = token.asset_id WHERE token.asset_id = ?')
    .pluck()
    .all(assetId) as string[];
const imageRows = (id: string): number =>
  data.db.prepare('SELECT count(*) FROM image WHERE id = ?').pluck().get(id) as number;
const imageFolderExists = (id: string): boolean => existsSync(imageFilePath(imagesDirOf(data.dataDir), id, 'original'));
const tagRows = (assetId: string): string[] =>
  data.db.prepare('SELECT tag FROM asset_tag WHERE asset_id = ? ORDER BY tag').pluck().all(assetId) as string[];

describe('create, read, update and list (specs/02-architecture.md §5, specs/05-assets-and-images.md §1, §2)', () => {
  it('creates, reads, updates and lists assets, with ids the server generates as lowercase UUIDs', async () => {
    const image = await uploadImage();
    const created = await newAsset({
      name: 'Goblin boss',
      image_id: image.id,
      size: 'medium',
      tags: ['goblinoid', 'boss'],
      notes: 'Leads the cave ambush.',
    });
    expect(created.id).toMatch(SERVER_UUID);
    expect(created).toEqual({
      id: created.id,
      name: 'Goblin boss',
      category: 'monster',
      image_id: image.id,
      size: 'medium',
      default_hidden: true,
      notes: 'Leads the cave ambush.',
      tags: ['boss', 'goblinoid'],
    });
    const plain = await newAsset({ name: 'Chest', category: 'object', size: 'tiny' });
    expect(plain).toMatchObject({ notes: '', tags: [], default_hidden: false });

    expect(ok<LibraryAsset>(await get(`/api/assets/${created.id}`))).toEqual(created);
    const updated = ok<LibraryAsset>(
      await patch(`/api/assets/${created.id}`, { name: 'Goblin chief', size: 'large', notes: '', tags: ['chief'] }),
    );
    expect(updated).toEqual({ ...created, name: 'Goblin chief', size: 'large', notes: '', tags: ['chief'] });
    expect(ok<LibraryAsset>(await get(`/api/assets/${created.id}`))).toEqual(updated);
    expect(await list()).toEqual([plain, updated]);
  });

  it('stores every size of the size table and every category', async () => {
    const image = await uploadImage();
    for (const size of ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']) {
      for (const category of ['pc', 'npc', 'monster', 'object'] as const) {
        expect(await newAsset({ name: `${category} ${size}`, category, size, image_id: image.id })).toMatchObject({
          category,
          size,
        });
      }
    }
    expect((await list()).length).toBe(24);
  });

  it('refuses a body naming its own id, with an unknown field or an invalid value, and stores nothing', async () => {
    const image = await uploadImage();
    const asset = await newAsset({ image_id: image.id });
    const before = countRows(data.db);
    const valid = { name: 'Orc', image_id: image.id, category: 'monster', size: 'medium' };
    const refused: [string, string, unknown][] = [
      ['POST', '/api/assets', { ...valid, id: randomUUID() }],
      ['POST', '/api/assets', { ...valid, token_count: 3 }],
      ['POST', '/api/assets', { ...valid, category: 'dragon' }],
      ['POST', '/api/assets', { ...valid, size: 'Medium' }],
      ['POST', '/api/assets', { ...valid, name: '' }],
      ['POST', '/api/assets', { ...valid, image_id: image.id.toUpperCase() }],
      ['POST', '/api/assets', { ...valid, tags: 'cave' }],
      ['POST', '/api/assets', { ...valid, tags: [''] }],
      ['POST', '/api/assets', { ...valid, tags: ['cave', '   '] }],
      ['POST', '/api/assets', { name: 'Orc', category: 'monster', size: 'medium' }],
      ['PATCH', `/api/assets/${asset.id}`, { id: randomUUID() }],
      ['PATCH', `/api/assets/${asset.id}`, { name: 'Orc', tokens: [] }],
      ['PATCH', `/api/assets/${asset.id}`, { tags: [' \t '] }],
      ['PATCH', `/api/assets/${asset.id}`, { default_hidden: 'yes' }],
      ['PATCH', `/api/assets/${asset.id}`, {}],
    ];
    for (const [method, url, payload] of refused) {
      const response = await inject({ method: method as 'POST', url, payload: payload as object });
      expectFailure(response, 400, 'validation_failed');
    }
    const blank = expectFailure(
      await patch(`/api/assets/${asset.id}`, { tags: ['ok', ' '] }),
      400,
      'validation_failed',
    );
    expect(blank.error.details).toEqual([
      { path: '/tags/1', message: 'must not be empty once white space is removed' },
    ]);
    expect(countRows(data.db)).toEqual(before);
    expect(ok<LibraryAsset>(await get(`/api/assets/${asset.id}`))).toEqual(asset);
  });

  it('refuses an image that does not exist, on create and on update, and stores nothing', async () => {
    const asset = await newAsset();
    const before = countRows(data.db);
    const missing = 'e'.repeat(64);
    expectFailure(
      await post('/api/assets', { name: 'Orc', image_id: missing, category: 'monster', size: 'medium', tags: ['x'] }),
      400,
      'reference_not_found',
    );
    expectFailure(
      await patch(`/api/assets/${asset.id}`, { image_id: missing, name: 'Renamed' }),
      400,
      'reference_not_found',
    );
    expect(countRows(data.db)).toEqual(before);
    expect(ok<LibraryAsset>(await get(`/api/assets/${asset.id}`))).toEqual(asset);
  });

  it('answers 404 for an unknown asset and 400 for an id that is not a lowercase UUID, changing nothing', async () => {
    const asset = await newAsset();
    const before = countRows(data.db);
    const missing = randomUUID();
    for (const response of [
      await get(`/api/assets/${missing}`),
      await patch(`/api/assets/${missing}`, { name: 'Orc' }),
      await get(`/api/assets/${missing}/usages`),
      await del(`/api/assets/${missing}`),
    ]) {
      expectFailure(response, 404, 'not_found');
    }
    expectFailure(await get(`/api/assets/${asset.id.toUpperCase()}`), 400, 'validation_failed');
    expectFailure(await del('/api/assets/not-a-uuid'), 400, 'validation_failed');
    expect(countRows(data.db)).toEqual(before);
  });
});

describe('default visibility (specs/05-assets-and-images.md §4, D-020, Q-045)', () => {
  it('makes a new monster hidden and a new pc, npc or object visible', async () => {
    const image = await uploadImage();
    const hidden = async (category: 'pc' | 'npc' | 'monster' | 'object') =>
      (await newAsset({ name: category, category, image_id: image.id })).default_hidden;
    expect(await hidden('monster')).toBe(true);
    expect(await hidden('pc')).toBe(false);
    expect(await hidden('npc')).toBe(false);
    expect(await hidden('object')).toBe(false);
  });

  it('takes a default_hidden given at creation over the category, and changes it per asset', async () => {
    const image = await uploadImage();
    const spy = await newAsset({ name: 'Spy', category: 'npc', default_hidden: true, image_id: image.id });
    expect(spy.default_hidden).toBe(true);
    const mimic = await newAsset({ name: 'Mimic', category: 'monster', default_hidden: false, image_id: image.id });
    expect(mimic.default_hidden).toBe(false);
    const goblin = await newAsset({ image_id: image.id });
    expect(ok<LibraryAsset>(await patch(`/api/assets/${goblin.id}`, { default_hidden: false })).default_hidden).toBe(
      false,
    );
    expect(ok<LibraryAsset>(await patch(`/api/assets/${spy.id}`, { default_hidden: false })).default_hidden).toBe(
      false,
    );
  });

  it('leaves default_hidden alone when the category changes, and every token keeps its own visibility', async () => {
    const goblin = await newAsset();
    const scene = await newScene((await newSession((await newCampaign('C')).id, 'S')).id, 'Cave');
    insertTokens(scene.id, goblin.id, 2);
    const hiddenBefore = data.db.prepare('SELECT hidden FROM token ORDER BY z_order').pluck().all();
    const changed = ok<LibraryAsset>(await patch(`/api/assets/${goblin.id}`, { category: 'npc' }));
    expect(changed).toMatchObject({ category: 'npc', default_hidden: true });
    ok(await patch(`/api/assets/${goblin.id}`, { default_hidden: false }));
    expect(data.db.prepare('SELECT hidden FROM token ORDER BY z_order').pluck().all()).toEqual(hiddenBefore);
  });
});

describe('search and filters (specs/05-assets-and-images.md §1, D-022, Q-064)', () => {
  beforeEach(async () => {
    const image = await uploadImage();
    const add = (name: string, category: NonNullable<AssetInput['category']>, tags: string[]) =>
      newAsset({ name, category, tags, image_id: image.id });
    await add('Goblin', 'monster', ['goblinoid', 'cave']);
    await add('goblin archer', 'monster', ['goblinoid', 'ranged', 'cave']);
    await add('Hobgoblin', 'monster', ['goblinoid']);
    await add('Innkeeper', 'npc', ['town']);
    await add('Bat', 'monster', ['cave', 'flying']);
    await add('Ärger', 'npc', ['Dämon']);
    await add('Treasure chest', 'object', ['loot', 'cave']);
  });

  it('sorts by name, ignoring case', async () => {
    expect(await names()).toEqual([
      'Bat',
      'Goblin',
      'goblin archer',
      'Hobgoblin',
      'Innkeeper',
      'Treasure chest',
      // Outside ASCII, after it, as SQLite's NOCASE collation orders it.
      'Ärger',
    ]);
  });

  it('searches a case-insensitive substring of the name', async () => {
    expect(await names('?q=GOBLIN')).toEqual(['Goblin', 'goblin archer', 'Hobgoblin']);
    expect(await names('?q=chest')).toEqual(['Treasure chest']);
    expect(await names('?q=%C3%A4rg')).toEqual(['Ärger']);
    expect(await names('?q=%20keep%20')).toEqual(['Innkeeper']);
    expect(await names('?q=dragon')).toEqual([]);
    expect((await names('?q=')).length).toBe(7);
  });

  it('searches a substring of the tags too', async () => {
    expect(await names('?q=RANG')).toEqual(['goblin archer']);
    expect(await names('?q=fly')).toEqual(['Bat']);
    expect(await names('?q=d%C3%A4m')).toEqual(['Ärger']);
    // `cave` is a tag of four assets and the name of none.
    expect(await names('?q=cave')).toEqual(['Bat', 'Goblin', 'goblin archer', 'Treasure chest']);
  });

  it('narrows by category', async () => {
    expect(await names('?category=npc')).toEqual(['Innkeeper', 'Ärger']);
    expect(await names('?category=object')).toEqual(['Treasure chest']);
    expect(await names('?category=pc')).toEqual([]);
    expect(await names('?category=monster&q=hob')).toEqual(['Hobgoblin']);
  });

  it('narrows by tags, every selected tag matching, whatever their case', async () => {
    expect(await names('?tag=cave')).toEqual(['Bat', 'Goblin', 'goblin archer', 'Treasure chest']);
    expect(await names('?tag=cave&tag=goblinoid')).toEqual(['Goblin', 'goblin archer']);
    expect(await names('?tag=CAVE&tag=Goblinoid&tag=ranged')).toEqual(['goblin archer']);
    expect(await names('?tag=cave&tag=town')).toEqual([]);
    // A tag filter matches whole tags, not substrings.
    expect(await names('?tag=goblin')).toEqual([]);
    expect(await names('?tag=cave&category=object&q=treasure')).toEqual(['Treasure chest']);
  });

  it('refuses an unknown query parameter, an unknown category and a blank tag', async () => {
    expectFailure(await get('/api/assets?sort=recent'), 400, 'validation_failed');
    expectFailure(await get('/api/assets?category=dragon'), 400, 'validation_failed');
    expectFailure(await get('/api/assets?tag='), 400, 'validation_failed');
    const blank = expectFailure(await get('/api/assets?tag=cave&tag=%20'), 400, 'validation_failed');
    expect(blank.error.details).toEqual([{ path: '/tag', message: 'must not be empty once white space is removed' }]);
  });
});

describe('tag case (G-009, D-083)', () => {
  it('stores one lower-case spelling of a tag, so tags that look the same are one tag', async () => {
    const asset = await newAsset({ tags: ['Cave', ' cave ', 'CAVE', 'Dark   Forest', 'dark forest'] });
    expect(asset.tags).toEqual(['cave', 'dark forest']);
    expect(tagRows(asset.id)).toEqual(['cave', 'dark forest']);
    const other = await newAsset({ name: 'Bat', tags: ['cAvE'] });
    expect(other.tags).toEqual(['cave']);
    const distinct = data.db.prepare('SELECT DISTINCT tag FROM asset_tag ORDER BY tag').pluck().all();
    expect(distinct).toEqual(['cave', 'dark forest']);
  });

  it('replaces the whole set of tags on update, keeping the rows of tags that stay', async () => {
    const asset = await newAsset({ tags: ['cave', 'boss'] });
    const kept = data.db.prepare("SELECT id FROM asset_tag WHERE asset_id = ? AND tag = 'cave'").pluck().get(asset.id);
    expect(ok<LibraryAsset>(await patch(`/api/assets/${asset.id}`, { tags: ['Cave', 'Minion'] })).tags).toEqual([
      'cave',
      'minion',
    ]);
    expect(data.db.prepare("SELECT id FROM asset_tag WHERE asset_id = ? AND tag = 'cave'").pluck().get(asset.id)).toBe(
      kept,
    );
    expect(ok<LibraryAsset>(await patch(`/api/assets/${asset.id}`, { tags: [] })).tags).toEqual([]);
    expect(tagRows(asset.id)).toEqual([]);
    expect(ok<LibraryAsset>(await patch(`/api/assets/${asset.id}`, { name: 'Renamed' })).tags).toEqual([]);
  });
});

describe('deleting an asset (specs/03-domain-model.md §7, specs/05-assets-and-images.md §5, Q-002)', () => {
  it('refuses to delete an asset in use, naming every scene that uses it, and changes nothing', async () => {
    const goblin = await newAsset();
    const zeta = await newCampaign('Zeta');
    const alpha = await newCampaign('alpha');
    const one = await newSession(alpha.id, 'One');
    const two = await newSession(alpha.id, 'Two');
    const lonely = await newSession(zeta.id, 'Lonely');
    const later = await newScene(one.id, 'Later');
    const cave = await newScene(one.id, 'Cave');
    const bridge = await newScene(two.id, 'Bridge');
    const unused = await newScene(two.id, 'Empty');
    const tower = await newScene(lonely.id, 'Tower');
    insertTokens(cave.id, goblin.id, 3);
    insertTokens(bridge.id, goblin.id, 1);
    insertTokens(tower.id, goblin.id, 2);
    insertTokens(later.id, goblin.id, 1);
    // Put `later` after `cave` in their session.
    ok(
      await inject({
        method: 'PUT',
        url: `/api/sessions/${one.id}/scenes/order`,
        payload: { ids: [cave.id, later.id] },
      }),
    );
    const before = countRows(data.db);

    const usage = (scene: Scene, session: Session, campaign: Campaign, tokens: number): AssetUsage => ({
      scene_id: scene.id,
      scene_name: scene.name,
      session_id: session.id,
      session_title: session.title,
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      tokens,
    });
    const expected = [
      usage(cave, one, alpha, 3),
      usage(later, one, alpha, 1),
      usage(bridge, two, alpha, 1),
      usage(tower, lonely, zeta, 2),
    ];
    const refusal = expectFailure(await del(`/api/assets/${goblin.id}`), 409, 'asset_in_use');
    expect(refusal.error.usages).toEqual(expected);
    expect(JSON.stringify(refusal)).not.toContain(unused.id);
    const usages = ok<AssetUsage[]>(await get(`/api/assets/${goblin.id}/usages`));
    expect(isUsages(usages), JSON.stringify(isUsages.errors)).toBe(true);
    expect(usages).toEqual(expected);
    expect(countRows(data.db)).toEqual(before);
    expect(ok<LibraryAsset>(await get(`/api/assets/${goblin.id}`))).toEqual(goblin);
    expect(imageFolderExists(goblin.image_id)).toBe(true);

    // The refusal is logged by its code only: no scene, session or campaign name reaches the log.
    const logged = JSON.stringify(lines);
    expect(logged).toContain('asset_in_use');
    for (const name of ['Cave', 'Later', 'Bridge', 'Tower', 'Lonely', 'Zeta', 'alpha', cave.id]) {
      expect(logged).not.toContain(name);
    }
  });

  it('lists no usage for an asset no token uses', async () => {
    const asset = await newAsset();
    expect(ok<AssetUsage[]>(await get(`/api/assets/${asset.id}/usages`))).toEqual([]);
  });

  it('deletes an unused asset with its tags, and its image with its files once nothing references it', async () => {
    const asset = await newAsset({ tags: ['cave', 'boss'] });
    expect(tagRows(asset.id)).toHaveLength(2);
    const response = await del(`/api/assets/${asset.id}`);
    expect(response.statusCode, response.body).toBe(204);
    expectFailure(await get(`/api/assets/${asset.id}`), 404, 'not_found');
    expect(tagRows(asset.id)).toEqual([]);
    expect(imageRows(asset.image_id)).toBe(0);
    expect(imageFolderExists(asset.image_id)).toBe(false);
    expect(countRows(data.db)).toMatchObject({ asset: 0, asset_tag: 0, image: 0 });
  });

  it('keeps the image of a deleted asset while another asset or a scene map still uses it', async () => {
    const shared = await uploadImage();
    const first = await newAsset({ image_id: shared.id });
    const second = await newAsset({ name: 'Goblin 2', image_id: shared.id });
    expect((await del(`/api/assets/${first.id}`)).statusCode).toBe(204);
    expect(imageRows(shared.id)).toBe(1);
    expect(imageFolderExists(shared.id)).toBe(true);

    const map = await uploadImage();
    const onMap = await newAsset({ name: 'Map token', image_id: map.id });
    await newScene((await newSession((await newCampaign('C')).id, 'S')).id, 'Mapped', map.id);
    expect((await del(`/api/assets/${onMap.id}`)).statusCode).toBe(204);
    expect(imageRows(map.id)).toBe(1);
    expect(imageFolderExists(map.id)).toBe(true);

    expect((await del(`/api/assets/${second.id}`)).statusCode).toBe(204);
    expect(imageRows(shared.id)).toBe(0);
    expect(imageFolderExists(shared.id)).toBe(false);
  });

  it('allows the deletion once the last token of the asset has gone with its scene', async () => {
    const asset = await newAsset();
    const scene = await newScene((await newSession((await newCampaign('C')).id, 'S')).id, 'Cave');
    insertTokens(scene.id, asset.id, 2);
    expectFailure(await del(`/api/assets/${asset.id}`), 409, 'asset_in_use');
    const response = await inject({
      method: 'DELETE',
      url: `/api/scenes/${scene.id}`,
      payload: { confirm: { sessions: 0, scenes: 1, tokens: 2, live: false } },
    });
    expect(response.statusCode, response.body).toBe(204);
    expect((await del(`/api/assets/${asset.id}`)).statusCode).toBe(204);
  });
});

describe("changing an asset's image (specs/03-domain-model.md §7, specs/05-assets-and-images.md §5)", () => {
  it('changes the image of every token of the asset, and removes the old image once nothing references it', async () => {
    const asset = await newAsset();
    const old = asset.image_id;
    const session = await newSession((await newCampaign('C')).id, 'S');
    insertTokens((await newScene(session.id, 'One')).id, asset.id, 2);
    insertTokens((await newScene(session.id, 'Two')).id, asset.id, 1);
    expect(tokenImages(asset.id)).toEqual([old, old, old]);

    const replacement = await uploadImage();
    const updated = ok<LibraryAsset>(await patch(`/api/assets/${asset.id}`, { image_id: replacement.id }));
    expect(updated).toEqual({ ...asset, image_id: replacement.id });
    expect(tokenImages(asset.id)).toEqual([replacement.id, replacement.id, replacement.id]);
    expect(imageRows(old)).toBe(0);
    expect(imageFolderExists(old)).toBe(false);
    expect(imageFolderExists(replacement.id)).toBe(true);
    expect(lines.some((line) => line.event === 'images.removed')).toBe(true);
  });

  it('keeps the old image while another asset or a scene map uses it, and keeps an unchanged image', async () => {
    const shared = await uploadImage();
    const first = await newAsset({ image_id: shared.id });
    await newAsset({ name: 'Twin', image_id: shared.id });
    ok(await patch(`/api/assets/${first.id}`, { image_id: (await uploadImage()).id }));
    expect(imageRows(shared.id)).toBe(1);

    const map = await uploadImage();
    const onMap = await newAsset({ name: 'Map token', image_id: map.id });
    await newScene((await newSession((await newCampaign('C')).id, 'S')).id, 'Mapped', map.id);
    ok(await patch(`/api/assets/${onMap.id}`, { image_id: (await uploadImage()).id }));
    expect(imageRows(map.id)).toBe(1);
    expect(imageFolderExists(map.id)).toBe(true);

    // The same image again, or an update without one, removes nothing.
    const same = await newAsset({ name: 'Same' });
    ok(await patch(`/api/assets/${same.id}`, { image_id: same.image_id, name: 'Still same' }));
    ok(await patch(`/api/assets/${same.id}`, { notes: 'x' }));
    expect(imageRows(same.image_id)).toBe(1);
    expect(imageFolderExists(same.image_id)).toBe(true);
  });
});

describe('uploads nothing references are removed at start-up (G-016, D-084)', () => {
  it('removes, when the server starts, an upload abandoned before its asset or scene was created, with its files', async () => {
    const abandoned = await uploadImage();
    const forAsset = await uploadImage();
    const asset = await newAsset({ image_id: forAsset.id });
    const forMap = await uploadImage();
    await newScene((await newSession((await newCampaign('C')).id, 'S')).id, 'Mapped', forMap.id);
    // Until the server starts again, a new upload is kept, as the DM may be about to use it.
    expect(imageRows(abandoned.id)).toBe(1);

    await app.close();
    lines = [];
    const db = data.reopen();
    app = await buildTestApp(data, { db, logger: recording() });
    expect(db.prepare('SELECT count(*) FROM image WHERE id = ?').pluck().get(abandoned.id)).toBe(0);
    expect(imageFolderExists(abandoned.id)).toBe(false);
    for (const kept of [forAsset.id, forMap.id]) {
      expect(db.prepare('SELECT count(*) FROM image WHERE id = ?').pluck().get(kept)).toBe(1);
      expect(imageFolderExists(kept)).toBe(true);
    }
    expect(lines).toContainEqual(
      expect.objectContaining({ event: 'images.unreferenced_removed', fields: { removed: 1 } }),
    );
    expect(lines.some((line) => line.event === 'images.orphans_removed')).toBe(false);
    expect(asset.image_id).toBe(forAsset.id);
  });
});

describe('access: nothing of the library reaches a browser without a DM session (specs/02-architecture.md §5, specs/07-security-and-access.md §5, §7)', () => {
  const SRV_05_ROUTES = [
    'GET /api/assets',
    'HEAD /api/assets',
    'POST /api/assets',
    'GET /api/assets/:id',
    'HEAD /api/assets/:id',
    'PATCH /api/assets/:id',
    'DELETE /api/assets/:id',
    'GET /api/assets/:id/usages',
    'HEAD /api/assets/:id/usages',
  ];

  it('declares every SRV-05 route and makes none of them public, so the identical-answer test of auth.test.ts covers them', async () => {
    await app.ready();
    const declared = app.declaredRoutes.map(({ method, url }) => `${method} ${url}`);
    expect(declared).toEqual(expect.arrayContaining(SRV_05_ROUTES));
    for (const route of SRV_05_ROUTES) {
      const [method, url] = route.split(' ');
      expect(
        PUBLIC_API_ROUTES.some((open) => open.method === method && open.url === url),
        route,
      ).toBe(false);
    }
  });

  it('answers every SRV-05 route with 401 and no library data to the player view, and serves none of its images', async () => {
    const asset = await newAsset({ name: 'Secret mimic', tags: ['secret-tag'], notes: 'Secret note' });
    const scene = await newScene((await newSession((await newCampaign('C')).id, 'S')).id, 'Secret scene');
    insertTokens(scene.id, asset.id, 1);
    const before = countRows(data.db);
    for (const route of SRV_05_ROUTES) {
      const [method, pattern] = route.split(' ') as [string, string];
      for (const query of ['', '?q=secret&tag=secret-tag']) {
        const response = await app.inject({
          method: method as 'GET',
          url: pattern.replace(':id', asset.id) + (pattern === '/api/assets' ? query : ''),
          ...(method === 'POST' || method === 'PATCH'
            ? { payload: { name: 'x', image_id: asset.image_id, category: 'pc', size: 'tiny' } }
            : {}),
        });
        if (method === 'HEAD') expect(response.statusCode, route).toBe(401);
        else expectFailure(response, 401, 'unauthorized');
        for (const secret of [asset.id, asset.image_id, 'Secret', 'secret-tag', scene.id]) {
          expect(response.body, route).not.toContain(secret);
        }
      }
    }
    for (const variant of ['original', 'display', 'thumbnail'] as const) {
      const response = await app.inject({ method: 'GET', url: imageFileUrl(asset.image_id, variant) });
      expectFailure(response, 404, 'not_found');
    }
    expect(countRows(data.db)).toEqual(before);
  });
});
