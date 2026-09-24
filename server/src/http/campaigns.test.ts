import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CampaignSchema,
  DeletionSummarySchema,
  ErrorEnvelopeSchema,
  PUBLIC_API_ROUTES,
  SceneSchema,
  SessionSchema,
  type Campaign,
  type DeletionSummary,
  type ErrorEnvelope,
  type Scene,
  type Session,
} from '@emberglass/shared';
import { countRows } from '../db/testing/fixture.js';
import { compileSchema } from '../validation.js';
import { buildTestApp, createTestData, setUpPin, type TestData } from './testing/app.js';

// SRV-03: campaigns, sessions and scenes over REST, against a real SQLite file
// (specs/02-architecture.md §5, specs/03-domain-model.md §2, §3, §5, §6, §7,
// D-075, D-078). Images and assets arrive with SRV-04 and SRV-05, so the rows a
// scene with a map or with tokens needs are inserted here directly.

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
// Version 4, lowercase, as randomUUID makes them (D-038).
const SERVER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const isEnvelope = compileSchema<ErrorEnvelope>(ErrorEnvelopeSchema);
const isCampaign = compileSchema<Campaign>(CampaignSchema);
const isSession = compileSchema<Session>(SessionSchema);
const isScene = compileSchema<Scene>(SceneSchema);
const isSummary = compileSchema<DeletionSummary>(DeletionSummarySchema);

// Every write commits to a real SQLite file, and each test signs in with a real
// (cheap) PIN hash; on the Windows runner a test that builds a campaign tree
// takes several seconds (run of 2026-09-24: 5.7 s, over Vitest's 5 s default).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let data: TestData;
let app: FastifyInstance;
let cookie: string;

beforeEach(async () => {
  data = createTestData('emberglass-campaigns-');
  app = await buildTestApp(data);
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
const put = (url: string, payload: unknown) => inject({ method: 'PUT', url, payload: payload as object });
const del = (url: string, payload?: unknown) =>
  inject({ method: 'DELETE', url, ...(payload === undefined ? {} : { payload: payload as object }) });

function ok<T>(response: LightMyRequestResponse, status = 200): T {
  expect(response.statusCode, response.body).toBe(status);
  return response.json<T>();
}

function expectFailure(response: LightMyRequestResponse, status: number, code: ErrorEnvelope['error']['code']): void {
  expect(response.statusCode, response.body).toBe(status);
  const body: unknown = response.json();
  expect(isEnvelope(body), JSON.stringify(isEnvelope.errors)).toBe(true);
  expect((body as ErrorEnvelope).error.code).toBe(code);
}

const newCampaign = async (name = 'Lost Mine'): Promise<Campaign> =>
  ok<Campaign>(await post('/api/campaigns', { name }), 201);
const newSession = async (campaignId: string, title = 'Session'): Promise<Session> =>
  ok<Session>(await post(`/api/campaigns/${campaignId}/sessions`, { title }), 201);
const newScene = async (sessionId: string, name = 'Scene', mapImageId?: string | null): Promise<Scene> =>
  ok<Scene>(
    await post(
      `/api/sessions/${sessionId}/scenes`,
      mapImageId === undefined ? { name } : { name, map_image_id: mapImageId },
    ),
    201,
  );
const summaryOf = async (url: string): Promise<DeletionSummary> => {
  const body = ok<DeletionSummary>(await get(`${url}/deletion`));
  expect(isSummary(body), JSON.stringify(isSummary.errors)).toBe(true);
  return body;
};

// Rows that SRV-04 and SRV-05 will create through their own routes.
let imageCount = 0;
function insertImage(preset: boolean): string {
  const id = createHash('sha256').update(`srv-03 image ${imageCount++}`).digest('hex');
  if (preset) {
    data.db
      .prepare(
        `INSERT INTO image (id, mime, width, height, grid_preset_type, grid_preset_size, grid_preset_offset_x,
           grid_preset_offset_y, grid_preset_visible, grid_preset_feet_per_square, grid_preset_columns, grid_preset_rows)
         VALUES (?, 'image/png', 7000, 5000, 'square', 70.5, 12.25, -3.5, 0, 10, 99, 71)`,
      )
      .run(id);
  } else {
    data.db.prepare(`INSERT INTO image (id, mime, width, height) VALUES (?, 'image/webp', 512, 512)`).run(id);
  }
  return id;
}

function insertAsset(): string {
  const id = randomUUID();
  data.db
    .prepare(
      `INSERT INTO asset (id, name, category, image_id, size, default_hidden) VALUES (?, 'Goblin', 'monster', ?, 'small', 1)`,
    )
    .run(id, insertImage(false));
  return id;
}

function insertTokens(sceneId: string, assetId: string, count: number): string[] {
  const insert = data.db.prepare(
    'INSERT INTO token (id, scene_id, asset_id, label, x, y, hidden, z_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  return Array.from({ length: count }, (_, n) => {
    const id = randomUUID();
    insert.run(id, sceneId, assetId, `Goblin ${n + 1}`, 2.5 + n, 7.125, n % 2, n);
    return id;
  });
}

const liveSceneId = (): string | null =>
  data.db.prepare('SELECT live_scene_id FROM settings').pluck().get() as string | null;
const setLive = (sceneId: string | null): void => {
  data.db.prepare('UPDATE settings SET live_scene_id = ?').run(sceneId);
};
const tokensOf = (sceneId: string) =>
  data.db
    .prepare(
      'SELECT id, asset_id, label, x, y, hidden, z_order, character_id FROM token WHERE scene_id = ? ORDER BY z_order',
    )
    .all(sceneId) as { id: string; asset_id: string; label: string; x: number; y: number; hidden: number }[];
const orders = (items: { order: number }[]): number[] => items.map((item) => item.order);

describe('create, read, rename and list (specs/02-architecture.md §5, specs/03-domain-model.md §3)', () => {
  it('creates, reads, renames and lists campaigns, with ids the server generates as lowercase UUIDs', async () => {
    const created = ok<Campaign>(await post('/api/campaigns', { name: 'Lost Mine', description: 'Phandelver' }), 201);
    expect(isCampaign(created), JSON.stringify(isCampaign.errors)).toBe(true);
    expect(created).toMatchObject({ name: 'Lost Mine', description: 'Phandelver', rules_version: '5e-2014' });
    expect(created.id).toMatch(SERVER_UUID);
    const plain = await newCampaign('curse of the pale');
    expect(plain.description).toBe('');

    expect(ok<Campaign>(await get(`/api/campaigns/${created.id}`))).toEqual(created);
    const renamed = ok<Campaign>(await patch(`/api/campaigns/${created.id}`, { name: 'Lost Mines' }));
    expect(renamed).toEqual({ ...created, name: 'Lost Mines' });
    expect(ok<Campaign>(await patch(`/api/campaigns/${created.id}`, { description: '' }))).toEqual({
      ...renamed,
      description: '',
    });
    // No order is stored for campaigns: by name, ignoring case (Q-090).
    const listed = ok<Campaign[]>(await get('/api/campaigns'));
    expect(listed.map((campaign) => campaign.name)).toEqual(['curse of the pale', 'Lost Mines']);
    for (const campaign of listed) expect(isCampaign(campaign)).toBe(true);
  });

  it('creates, reads, renames and lists sessions of a campaign, each appended last', async () => {
    const campaign = await newCampaign();
    const first = ok<Session>(
      await post(`/api/campaigns/${campaign.id}/sessions`, { title: 'One', date: '2026-10-03' }),
      201,
    );
    expect(isSession(first), JSON.stringify(isSession.errors)).toBe(true);
    expect(first).toMatchObject({ campaign_id: campaign.id, title: 'One', order: 0, date: '2026-10-03' });
    expect(first.id).toMatch(SERVER_UUID);
    const second = await newSession(campaign.id, 'Two');
    expect(second).toMatchObject({ order: 1, date: null });

    expect(ok<Session>(await get(`/api/sessions/${first.id}`))).toEqual(first);
    expect(ok<Session>(await patch(`/api/sessions/${first.id}`, { title: 'Uno' }))).toEqual({ ...first, title: 'Uno' });
    expect(ok<Session>(await patch(`/api/sessions/${first.id}`, { date: null }))).toMatchObject({
      title: 'Uno',
      date: null,
    });
    expect(ok<Session[]>(await get(`/api/campaigns/${campaign.id}/sessions`)).map((s) => s.title)).toEqual([
      'Uno',
      'Two',
    ]);
  });

  it('creates, reads, renames and lists scenes of a session, each appended last', async () => {
    const session = await newSession((await newCampaign()).id);
    const first = await newScene(session.id, 'Cave mouth');
    expect(isScene(first), JSON.stringify(isScene.errors)).toBe(true);
    expect(first.id).toMatch(SERVER_UUID);
    expect(first).toMatchObject({ session_id: session.id, name: 'Cave mouth', order: 0, map_image_id: null });
    const second = await newScene(session.id, 'Deep hall');
    expect(second.order).toBe(1);

    expect(ok<Scene>(await get(`/api/scenes/${first.id}`))).toEqual(first);
    expect(ok<Scene>(await patch(`/api/scenes/${first.id}`, { name: 'Cave' }))).toEqual({ ...first, name: 'Cave' });
    expect(ok<Scene[]>(await get(`/api/sessions/${session.id}/scenes`)).map((s) => s.name)).toEqual([
      'Cave',
      'Deep hall',
    ]);
  });

  it('refuses a body naming its own id, or with an unknown field, and stores nothing', async () => {
    const campaign = await newCampaign();
    const session = await newSession(campaign.id);
    const scene = await newScene(session.id);
    const before = countRows(data.db);
    const id = randomUUID();
    const refused: [string, string, unknown][] = [
      ['POST', '/api/campaigns', { id, name: 'Mine' }],
      ['POST', '/api/campaigns', { name: 'Mine', rules_version: '5e-2014' }],
      ['POST', `/api/campaigns/${campaign.id}/sessions`, { id, title: 'Mine' }],
      ['POST', `/api/campaigns/${campaign.id}/sessions`, { title: 'Mine', order: 4 }],
      ['POST', `/api/sessions/${session.id}/scenes`, { id, name: 'Mine' }],
      ['POST', `/api/sessions/${session.id}/scenes`, { name: 'Mine', grid: { columns: 5 } }],
      ['POST', `/api/scenes/${scene.id}/duplicate`, { id, name: 'Copy' }],
      ['PATCH', `/api/campaigns/${campaign.id}`, { id, name: 'Mine' }],
      ['PATCH', `/api/sessions/${session.id}`, { title: 'Mine', campaign_id: randomUUID() }],
      ['PATCH', `/api/scenes/${scene.id}`, { name: 'Mine', session_id: randomUUID() }],
      ['PATCH', `/api/scenes/${scene.id}`, { name: 'Mine', map_image_id: null }],
      ['PATCH', `/api/campaigns/${campaign.id}`, {}],
      ['POST', '/api/campaigns', { name: '' }],
      ['POST', `/api/campaigns/${campaign.id}/sessions`, { title: 'Mine', date: '2026-02-30' }],
      ['POST', `/api/campaigns/${campaign.id}/sessions`, { title: 'Mine', date: '3 October' }],
      ['PATCH', `/api/sessions/${session.id}`, { date: '2026-13-01' }],
    ];
    for (const [method, url, payload] of refused) {
      const response = await inject({ method: method as 'POST', url, payload: payload as object });
      expectFailure(response, 400, 'validation_failed');
    }
    expect(countRows(data.db)).toEqual(before);
    expect(ok<Campaign>(await get(`/api/campaigns/${campaign.id}`))).toEqual(campaign);
    expect(ok<Session>(await get(`/api/sessions/${session.id}`))).toEqual(session);
    expect(ok<Scene>(await get(`/api/scenes/${scene.id}`))).toEqual(scene);
  });

  it('answers 404 for an unknown entity or parent and 400 for an id that is not a lowercase UUID, storing nothing', async () => {
    const before = countRows(data.db);
    const missing = randomUUID();
    for (const response of [
      await get(`/api/campaigns/${missing}`),
      await get(`/api/campaigns/${missing}/sessions`),
      await post(`/api/campaigns/${missing}/sessions`, { title: 'Orphan' }),
      await get(`/api/sessions/${missing}`),
      await post(`/api/sessions/${missing}/scenes`, { name: 'Orphan' }),
      await get(`/api/scenes/${missing}`),
      await patch(`/api/scenes/${missing}`, { name: 'Orphan' }),
      await post(`/api/scenes/${missing}/duplicate`, { name: 'Orphan' }),
      await get(`/api/scenes/${missing}/deletion`),
    ]) {
      expectFailure(response, 404, 'not_found');
    }
    expectFailure(await get(`/api/campaigns/${missing.toUpperCase()}`), 400, 'validation_failed');
    expectFailure(await get('/api/scenes/not-a-uuid'), 400, 'validation_failed');
    expect(countRows(data.db)).toEqual(before);
  });
});

describe('order within the parent (specs/03-domain-model.md §2, D-050, D-075)', () => {
  it('reorders the scenes of a session in two steps and leaves the order unique and gap-free', async () => {
    const session = await newSession((await newCampaign()).id);
    const scenes = [];
    for (const name of ['A', 'B', 'C', 'D']) scenes.push(await newScene(session.id, name));
    const [a, b, c, d] = scenes.map((scene) => scene.id) as [string, string, string, string];
    // A plain one-step rewrite trips the unique constraint (D-075), which is why the reorder takes two.
    expect(() =>
      data.db.prepare(`UPDATE scene SET "order" = CASE id WHEN ? THEN 1 WHEN ? THEN 0 ELSE "order" END`).run(a, b),
    ).toThrow(/UNIQUE/);

    const reordered = ok<Scene[]>(await put(`/api/sessions/${session.id}/scenes/order`, { ids: [d, b, a, c] }));
    expect(reordered.map((scene) => scene.id)).toEqual([d, b, a, c]);
    expect(orders(reordered)).toEqual([0, 1, 2, 3]);
    expect(ok<Scene[]>(await get(`/api/sessions/${session.id}/scenes`))).toEqual(reordered);
  });

  it('reorders the sessions of a campaign in two steps and leaves the order unique and gap-free', async () => {
    const campaign = await newCampaign();
    const ids = [];
    for (const title of ['One', 'Two', 'Three']) ids.push((await newSession(campaign.id, title)).id);
    const wanted = [ids[2]!, ids[0]!, ids[1]!];
    const reordered = ok<Session[]>(await put(`/api/campaigns/${campaign.id}/sessions/order`, { ids: wanted }));
    expect(reordered.map((session) => session.id)).toEqual(wanted);
    expect(orders(reordered)).toEqual([0, 1, 2]);
  });

  it('refuses a reorder naming a foreign, missing or repeated id, or leaving one out, and changes nothing', async () => {
    const campaign = await newCampaign();
    const session = await newSession(campaign.id);
    const other = await newSession(campaign.id, 'Other');
    const ids = [];
    for (const name of ['A', 'B', 'C']) ids.push((await newScene(session.id, name)).id);
    const foreign = (await newScene(other.id, 'Elsewhere')).id;
    const before = ok<Scene[]>(await get(`/api/sessions/${session.id}/scenes`));
    const url = `/api/sessions/${session.id}/scenes/order`;
    for (const wrong of [
      [ids[2]!, ids[1]!, foreign],
      [ids[2]!, ids[1]!, ids[0]!, foreign],
      [ids[2]!, ids[1]!, randomUUID()],
      [ids[2]!, ids[1]!],
      [],
    ]) {
      expectFailure(await put(url, { ids: wrong }), 409, 'order_mismatch');
    }
    expectFailure(await put(url, { ids: [ids[0]!, ids[0]!, ids[1]!] }), 400, 'validation_failed');
    expectFailure(
      await put(`/api/campaigns/${campaign.id}/sessions/order`, { ids: [other.id] }),
      409,
      'order_mismatch',
    );
    expectFailure(
      await put(`/api/campaigns/${campaign.id}/sessions/order`, { ids: [other.id, foreign] }),
      409,
      'order_mismatch',
    );
    expect(ok<Scene[]>(await get(`/api/sessions/${session.id}/scenes`))).toEqual(before);
    expect(ok<Scene>(await get(`/api/scenes/${foreign}`)).order).toBe(0);
    expect(orders(ok<Session[]>(await get(`/api/campaigns/${campaign.id}/sessions`)))).toEqual([0, 1]);
  });
});

describe('robustness of the order and idempotency (SRV-03 review)', () => {
  it('appends after a gap left outside these routes instead of colliding, and a later rewrite closes it', async () => {
    const campaign = await newCampaign();
    const session = await newSession(campaign.id);
    const gap = randomUUID();
    // As a restored or hand-edited database might hold it: one scene at order 2, none at 0 or 1.
    data.db
      .prepare('INSERT INTO scene (id, session_id, name, "order") VALUES (?, ?, ?, 2)')
      .run(gap, session.id, 'Gap');
    const created = await newScene(session.id, 'New');
    expect(created.order).toBe(3);
    const copy = ok<Scene>(await post(`/api/scenes/${gap}/duplicate`, { name: 'Gap copy' }), 201);
    expect(
      ok<Scene[]>(await get(`/api/sessions/${session.id}/scenes`)).map((scene) => [scene.id, scene.order]),
    ).toEqual([
      [gap, 0],
      [copy.id, 1],
      [created.id, 2],
    ]);
    data.db
      .prepare('INSERT INTO session (id, campaign_id, title, "order") VALUES (?, ?, ?, 5)')
      .run(randomUUID(), campaign.id, 'Far');
    expect((await newSession(campaign.id, 'After')).order).toBe(6);
  });

  it('answers a repeated deletion with 404 and changes nothing more', async () => {
    const session = await newSession((await newCampaign()).id);
    const scene = await newScene(session.id, 'Once');
    await newScene(session.id, 'Stays');
    const url = `/api/scenes/${scene.id}`;
    const summary = await summaryOf(url);
    expect((await del(url, { confirm: summary })).statusCode).toBe(204);
    const after = countRows(data.db);
    expectFailure(await del(url, { confirm: summary }), 404, 'not_found');
    expect(countRows(data.db)).toEqual(after);
  });

  it('gives the same result when the same reorder is sent twice', async () => {
    const session = await newSession((await newCampaign()).id);
    const ids = [];
    for (const name of ['A', 'B', 'C']) ids.push((await newScene(session.id, name)).id);
    const url = `/api/sessions/${session.id}/scenes/order`;
    const wanted = [ids[1]!, ids[2]!, ids[0]!];
    const first = ok<Scene[]>(await put(url, { ids: wanted }));
    expect(ok<Scene[]>(await put(url, { ids: wanted }))).toEqual(first);
    expect(orders(first)).toEqual([0, 1, 2]);
  });

  it('leaves the live scene live when it is duplicated, and the copy is not live', async () => {
    const session = await newSession((await newCampaign()).id);
    const live = await newScene(session.id, 'Live');
    setLive(live.id);
    const copy = ok<Scene>(await post(`/api/scenes/${live.id}/duplicate`, { name: 'Live copy' }), 201);
    expect(liveSceneId()).toBe(live.id);
    expect((await summaryOf(`/api/scenes/${copy.id}`)).live).toBe(false);
  });
});

describe('the grid of a new scene (specs/03-domain-model.md §5, §6)', () => {
  it('copies the grid preset of its map image', async () => {
    const session = await newSession((await newCampaign()).id);
    const image = insertImage(true);
    const scene = await newScene(session.id, 'Battlemap', image);
    expect(scene.map_image_id).toBe(image);
    expect(scene.grid).toEqual({
      type: 'square',
      size: 70.5,
      offset_x: 12.25,
      offset_y: -3.5,
      visible: false,
      feet_per_square: 10,
      columns: 99,
      rows: 71,
    });
  });

  it('stores 30 × 20 for a scene without a map, and the same defaults for a map whose image has no preset yet', async () => {
    const session = await newSession((await newCampaign()).id);
    const defaults = {
      type: 'square',
      size: null,
      offset_x: 0,
      offset_y: 0,
      visible: true,
      feet_per_square: 5,
      columns: 30,
      rows: 20,
    };
    expect((await newScene(session.id, 'Void')).grid).toEqual(defaults);
    expect((await newScene(session.id, 'Void too', null)).grid).toEqual(defaults);
    const uncalibrated = insertImage(false);
    expect(await newScene(session.id, 'Sketch', uncalibrated)).toMatchObject({
      map_image_id: uncalibrated,
      grid: defaults,
    });
  });

  it('refuses a map image that does not exist and stores nothing', async () => {
    const session = await newSession((await newCampaign()).id);
    const before = countRows(data.db);
    const response = await post(`/api/sessions/${session.id}/scenes`, {
      name: 'Nowhere',
      map_image_id: 'f'.repeat(64),
    });
    expectFailure(response, 400, 'reference_not_found');
    expect(countRows(data.db)).toEqual(before);
  });
});

describe('duplicating a scene (specs/03-domain-model.md §7)', () => {
  it('creates a new scene right after the original with its own copy of every token under new ids', async () => {
    const session = await newSession((await newCampaign()).id);
    const image = insertImage(true);
    const first = await newScene(session.id, 'Cave', image);
    const last = await newScene(session.id, 'Hall');
    const asset = insertAsset();
    const originalTokens = insertTokens(first.id, asset, 4);
    // The scene's own grid is copied, not its image's preset.
    data.db.prepare('UPDATE scene SET grid_size = 64, grid_columns = 12 WHERE id = ?').run(first.id);
    const original = ok<Scene>(await get(`/api/scenes/${first.id}`));

    const copy = ok<Scene>(await post(`/api/scenes/${first.id}/duplicate`, { name: 'Cave (copy)' }), 201);
    expect(isScene(copy), JSON.stringify(isScene.errors)).toBe(true);
    expect(copy.id).toMatch(SERVER_UUID);
    expect(copy.id).not.toBe(first.id);
    expect(copy).toEqual({ ...original, id: copy.id, name: 'Cave (copy)', order: 1 });
    expect(
      ok<Scene[]>(await get(`/api/sessions/${session.id}/scenes`)).map((scene) => [scene.id, scene.order]),
    ).toEqual([
      [first.id, 0],
      [copy.id, 1],
      [last.id, 2],
    ]);

    const copied = tokensOf(copy.id);
    const kept = tokensOf(first.id);
    expect(kept.map((token) => token.id)).toEqual(originalTokens);
    expect(copied).toHaveLength(4);
    for (const token of copied) {
      expect(token.id).toMatch(SERVER_UUID);
      expect(originalTokens).not.toContain(token.id);
    }
    const withoutId = (token: { id: string }) => ({ ...token, id: undefined });
    expect(copied.map(withoutId)).toEqual(kept.map(withoutId));

    // Deleting the copy leaves the original's tokens alone.
    const summary = await summaryOf(`/api/scenes/${copy.id}`);
    expect(summary).toEqual({ sessions: 0, scenes: 1, tokens: 4, live: false });
    expect((await del(`/api/scenes/${copy.id}`, { confirm: summary })).statusCode).toBe(204);
    expect(tokensOf(first.id)).toEqual(kept);
  });
});

describe('deletion and its confirmation (specs/03-domain-model.md §7)', () => {
  // A campaign of two sessions: three scenes with 2, 3 and 0 tokens, and one scene with 1.
  async function tree() {
    const campaign = await newCampaign();
    const one = await newSession(campaign.id, 'One');
    const two = await newSession(campaign.id, 'Two');
    const three = await newSession(campaign.id, 'Three');
    const asset = insertAsset();
    const scenes = [
      await newScene(one.id, 'A'),
      await newScene(one.id, 'B'),
      await newScene(one.id, 'C'),
      await newScene(two.id, 'D'),
    ];
    insertTokens(scenes[0]!.id, asset, 2);
    insertTokens(scenes[1]!.id, asset, 3);
    insertTokens(scenes[3]!.id, asset, 1);
    const other = await newCampaign('Other');
    const otherScene = await newScene((await newSession(other.id)).id, 'Elsewhere');
    insertTokens(otherScene.id, asset, 2);
    return { campaign, sessions: [one, two, three], scenes, asset, otherScene };
  }

  it('states how many sessions, scenes and tokens a deletion removes', async () => {
    const { campaign, sessions, scenes } = await tree();
    expect(await summaryOf(`/api/campaigns/${campaign.id}`)).toEqual({
      sessions: 3,
      scenes: 4,
      tokens: 6,
      live: false,
    });
    expect(await summaryOf(`/api/sessions/${sessions[0]!.id}`)).toEqual({
      sessions: 1,
      scenes: 3,
      tokens: 5,
      live: false,
    });
    expect(await summaryOf(`/api/sessions/${sessions[2]!.id}`)).toEqual({
      sessions: 1,
      scenes: 0,
      tokens: 0,
      live: false,
    });
    expect(await summaryOf(`/api/scenes/${scenes[1]!.id}`)).toEqual({ sessions: 0, scenes: 1, tokens: 3, live: false });
  });

  it('deletes nothing without the confirmation, or with one that no longer matches', async () => {
    const { campaign, sessions, scenes, asset } = await tree();
    const before = countRows(data.db);
    const url = `/api/campaigns/${campaign.id}`;
    const summary = await summaryOf(url);
    expectFailure(await del(url), 400, 'validation_failed');
    expectFailure(await del(url, {}), 400, 'validation_failed');
    expectFailure(await del(url, { confirm: { ...summary, extra: 1 } }), 400, 'validation_failed');
    for (const stale of [
      { ...summary, sessions: 2 },
      { ...summary, scenes: 5 },
      { ...summary, tokens: 0 },
      { ...summary, live: true },
    ]) {
      expectFailure(await del(url, { confirm: stale }), 409, 'confirmation_mismatch');
    }
    // Something was added after the DM saw the summary.
    insertTokens(scenes[2]!.id, asset, 1);
    expectFailure(await del(url, { confirm: summary }), 409, 'confirmation_mismatch');
    expectFailure(
      await del(`/api/sessions/${sessions[0]!.id}`, { confirm: { sessions: 1, scenes: 3, tokens: 5, live: false } }),
      409,
      'confirmation_mismatch',
    );
    expect(countRows(data.db)).toEqual({ ...before, token: before.token + 1 });
    expectFailure(await del(`/api/campaigns/${randomUUID()}`, { confirm: summary }), 404, 'not_found');
  });

  it('deletes a scene and its tokens and closes the gap in its session', async () => {
    const { sessions, scenes } = await tree();
    const before = countRows(data.db);
    const url = `/api/scenes/${scenes[1]!.id}`;
    expect((await del(url, { confirm: await summaryOf(url) })).statusCode).toBe(204);
    expectFailure(await get(url), 404, 'not_found');
    expect(tokensOf(scenes[1]!.id)).toEqual([]);
    const left = ok<Scene[]>(await get(`/api/sessions/${sessions[0]!.id}/scenes`));
    expect(left.map((scene) => [scene.name, scene.order])).toEqual([
      ['A', 0],
      ['C', 1],
    ]);
    expect(countRows(data.db)).toEqual({ ...before, scene: before.scene - 1, token: before.token - 3 });
  });

  it('deletes a session with its scenes and tokens and closes the gap in its campaign', async () => {
    const { campaign, sessions, scenes } = await tree();
    const before = countRows(data.db);
    const url = `/api/sessions/${sessions[0]!.id}`;
    expect((await del(url, { confirm: await summaryOf(url) })).statusCode).toBe(204);
    for (const scene of scenes.slice(0, 3)) {
      expectFailure(await get(`/api/scenes/${scene.id}`), 404, 'not_found');
      expect(tokensOf(scene.id)).toEqual([]);
    }
    const left = ok<Session[]>(await get(`/api/campaigns/${campaign.id}/sessions`));
    expect(left.map((session) => [session.title, session.order])).toEqual([
      ['Two', 0],
      ['Three', 1],
    ]);
    expect(countRows(data.db)).toEqual({
      ...before,
      session: before.session - 1,
      scene: before.scene - 3,
      token: before.token - 5,
    });
  });

  it('deletes a campaign with its sessions, scenes and tokens, and leaves the library and other campaigns alone', async () => {
    const { campaign, otherScene } = await tree();
    const before = countRows(data.db);
    const url = `/api/campaigns/${campaign.id}`;
    expect((await del(url, { confirm: { sessions: 3, scenes: 4, tokens: 6, live: false } })).statusCode).toBe(204);
    expectFailure(await get(url), 404, 'not_found');
    expect(countRows(data.db)).toEqual({
      ...before,
      campaign: before.campaign - 1,
      session: before.session - 3,
      scene: before.scene - 4,
      token: before.token - 6,
    });
    expect(tokensOf(otherScene.id)).toHaveLength(2);
    expect(ok<Campaign[]>(await get('/api/campaigns')).map((c) => c.name)).toEqual(['Other']);
  });

  it.each(['scene', 'session', 'campaign'] as const)(
    'warns that the live scene is among what goes, and clears the live scene when its %s is deleted',
    async (target) => {
      const { campaign, sessions, scenes } = await tree();
      const live = scenes[0]!;
      setLive(live.id);
      const url = {
        scene: `/api/scenes/${live.id}`,
        session: `/api/sessions/${sessions[0]!.id}`,
        campaign: `/api/campaigns/${campaign.id}`,
      }[target];
      // A deletion that does not contain it says so and keeps it live.
      expect((await summaryOf(`/api/scenes/${scenes[3]!.id}`)).live).toBe(false);
      expect((await summaryOf(`/api/sessions/${sessions[1]!.id}`)).live).toBe(false);
      const summary = await summaryOf(url);
      expect(summary.live, target).toBe(true);
      expectFailure(await del(url, { confirm: { ...summary, live: false } }), 409, 'confirmation_mismatch');
      expect(liveSceneId()).toBe(live.id);
      expect((await del(url, { confirm: summary })).statusCode).toBe(204);
      expect(liveSceneId(), target).toBeNull();
    },
  );

  it('keeps the live scene when a scene outside it is deleted', async () => {
    const { scenes } = await tree();
    setLive(scenes[0]!.id);
    const url = `/api/scenes/${scenes[3]!.id}`;
    expect((await del(url, { confirm: await summaryOf(url) })).statusCode).toBe(204);
    expect(liveSceneId()).toBe(scenes[0]!.id);
  });
});

describe('access and queries (specs/02-architecture.md §5, specs/07-security-and-access.md §7)', () => {
  const SRV_03_ROUTES = [
    'GET /api/campaigns',
    'POST /api/campaigns',
    'GET /api/campaigns/:id',
    'PATCH /api/campaigns/:id',
    'DELETE /api/campaigns/:id',
    'GET /api/campaigns/:id/deletion',
    'GET /api/campaigns/:id/sessions',
    'POST /api/campaigns/:id/sessions',
    'PUT /api/campaigns/:id/sessions/order',
    'GET /api/sessions/:id',
    'PATCH /api/sessions/:id',
    'DELETE /api/sessions/:id',
    'GET /api/sessions/:id/deletion',
    'GET /api/sessions/:id/scenes',
    'POST /api/sessions/:id/scenes',
    'PUT /api/sessions/:id/scenes/order',
    'GET /api/scenes/:id',
    'PATCH /api/scenes/:id',
    'DELETE /api/scenes/:id',
    'GET /api/scenes/:id/deletion',
    'POST /api/scenes/:id/duplicate',
  ];

  it('declares every SRV-03 route and makes none of them public, so the identical-answer test of auth.test.ts covers them', () => {
    const declared = app.declaredRoutes.map(({ method, url }) => `${method} ${url}`);
    expect(declared).toEqual(expect.arrayContaining(SRV_03_ROUTES));
    for (const route of SRV_03_ROUTES) {
      const [method, url] = route.split(' ');
      expect(
        PUBLIC_API_ROUTES.some((open) => open.method === method && open.url === url),
        route,
      ).toBe(false);
    }
  });

  it('answers every SRV-03 route with 401 and no stored data to a browser without a DM session, such as the player view', async () => {
    const campaign = await newCampaign('Secret campaign');
    const session = await newSession(campaign.id, 'Secret session');
    const scene = await newScene(session.id, 'Secret scene');
    insertTokens(scene.id, insertAsset(), 1);
    const before = countRows(data.db);
    const ids: Record<string, string> = { campaigns: campaign.id, sessions: session.id, scenes: scene.id };
    for (const route of SRV_03_ROUTES) {
      const [method, pattern] = route.split(' ') as [string, string];
      const url = pattern.replace(/^\/api\/(\w+)\/:id/, (_match, kind: string) => `/api/${kind}/${ids[kind]}`);
      const response = await app.inject({
        method: method as 'GET',
        url,
        ...(method === 'GET'
          ? {}
          : {
              payload: { name: 'x', title: 'x', ids: [], confirm: { sessions: 1, scenes: 1, tokens: 1, live: false } },
            }),
      });
      expectFailure(response, 401, 'unauthorized');
      for (const secret of [campaign.id, session.id, scene.id, 'Secret', '"order"']) {
        expect(response.body, route).not.toContain(secret);
      }
    }
    expect(countRows(data.db)).toEqual(before);
  });

  it('names its columns in every read and write: no server source selects every column or inserts without a column list', () => {
    const sources = readdirSync(path.join(REPO_ROOT, 'server', 'src'), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
      .map((entry) => path.join(entry.parentPath, entry.name))
      // Test helpers, excluded from the build, read whole rows to compare them with the contract.
      .filter((file) => !file.includes(`${path.sep}testing${path.sep}`));
    expect(sources.map((file) => path.basename(file))).toEqual(expect.arrayContaining(['campaigns.ts']));
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/SELECT\s+(\w+\.)?\*/i);
      expect(text, file).not.toMatch(/INSERT\s+(OR\s+\w+\s+)?INTO\s+\w+\s+(VALUES|SELECT|DEFAULT)/i);
      expect(text, file).not.toMatch(/INSERT\s+OR\s+REPLACE/i);
    }
  });
});
