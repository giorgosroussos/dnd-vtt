import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ErrorEnvelopeSchema,
  SceneSchema,
  imageFileUrl,
  type ErrorEnvelope,
  type Grid,
  type GridPreset,
  type Image,
  type Scene,
  type Session,
} from '@emberglass/shared';
import { countRows } from '../db/testing/fixture.js';
import { imagesDirOf } from '../images/store.js';
import { compileSchema } from '../validation.js';
import { buildTestApp, createTestData, setUpPin, type TestData } from './testing/app.js';

// PRP-02 and PRP-03: a scene's map, whether players see its grid and its calibration, set through
// PATCH /api/scenes/:id,
// against a real SQLite file and a real images folder (specs/02-architecture.md §5,
// specs/03-domain-model.md §4, §5, §6, §7, specs/06-grid-and-measurement.md §1, §2, D-078, D-080,
// D-090, D-094). Every image is generated here (Q-088).

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const isEnvelope = compileSchema<ErrorEnvelope>(ErrorEnvelopeSchema);
const isScene = compileSchema<Scene>(SceneSchema);

let data: TestData;
let app: FastifyInstance;
let cookie: string;
let imagesDir: string;

beforeEach(async () => {
  data = createTestData('emberglass-scene-setup-');
  app = await buildTestApp(data);
  cookie = await setUpPin(app, '4826');
  imagesDir = imagesDirOf(data.dataDir);
});

afterEach(async () => {
  await app.close();
  data.remove();
});

let seed = 0;
function picture(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: seed++ % 256, g: 90, b: 40 } } })
    .png()
    .toBuffer();
}

const inject = (options: InjectOptions) =>
  app.inject({ ...options, headers: { cookie, ...(options.headers as Record<string, string> | undefined) } });
const get = (url: string) => inject({ method: 'GET', url });
const post = (url: string, payload: unknown) => inject({ method: 'POST', url, payload: payload as object });
const patch = (url: string, payload: unknown) => inject({ method: 'PATCH', url, payload: payload as object });

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

async function uploaded(width = 400, height = 300): Promise<Image> {
  return ok<Image>(
    await inject({
      method: 'POST',
      url: '/api/images',
      payload: await picture(width, height),
      headers: { 'content-type': 'application/octet-stream' },
    }),
    201,
  );
}

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
const DEFAULTS: Grid = {
  type: 'square',
  size: null,
  offset_x: 0,
  offset_y: 0,
  visible: true,
  feet_per_square: 5,
  columns: 30,
  rows: 20,
};

async function withPreset(preset: GridPreset = PRESET): Promise<Image> {
  const image = await uploaded();
  return ok<Image>(await inject({ method: 'PUT', url: `/api/images/${image.id}/preset`, payload: preset }));
}

async function newSession(): Promise<Session> {
  const campaign = ok<{ id: string }>(await post('/api/campaigns', { name: 'Setup' }), 201);
  return ok<Session>(await post(`/api/campaigns/${campaign.id}/sessions`, { title: 'One' }), 201);
}

async function newScene(sessionId: string, mapImageId?: string): Promise<Scene> {
  return ok<Scene>(
    await post(`/api/sessions/${sessionId}/scenes`, {
      name: 'Cave',
      ...(mapImageId ? { map_image_id: mapImageId } : {}),
    }),
    201,
  );
}

async function update(sceneId: string, body: unknown): Promise<Scene> {
  const scene = ok<Scene>(await patch(`/api/scenes/${sceneId}`, body));
  expect(isScene(scene), JSON.stringify(isScene.errors)).toBe(true);
  // What was answered is what is stored.
  expect(ok<Scene>(await get(`/api/scenes/${sceneId}`))).toEqual(scene);
  return scene;
}

const countImage = (id: string): number =>
  data.db.prepare('SELECT count(*) FROM image WHERE id = ?').pluck().get(id) as number;
const stored = (id: string): boolean => existsSync(path.join(imagesDir, id)) || countImage(id) > 0;

describe('attaching a map (specs/03-domain-model.md §5, §6, Q-001, Q-034)', () => {
  it('attaches an uploaded map to a map-less scene, starting from the image preset', async () => {
    const session = await newSession();
    const scene = await newScene(session.id);
    expect(scene).toMatchObject({ map_image_id: null, grid: DEFAULTS });
    const map = await withPreset();
    expect(await update(scene.id, { map_image_id: map.id })).toEqual({ ...scene, map_image_id: map.id, grid: PRESET });
  });

  it('starts from the stored defaults for a map without a preset, dropping the grid of the old map', async () => {
    const session = await newSession();
    const first = await withPreset();
    const scene = await newScene(session.id, first.id);
    expect(scene.grid).toEqual(PRESET);
    const second = await uploaded(500, 200);
    expect((await update(scene.id, { map_image_id: second.id })).grid).toEqual(DEFAULTS);
  });

  it('keeps the grid when the map the scene already has is sent again', async () => {
    const session = await newSession();
    const map = await withPreset();
    const scene = await newScene(session.id, map.id);
    await update(scene.id, { grid: { visible: true } });
    // The preset says hidden, the scene says visible: the scene's own grid stays.
    expect((await update(scene.id, { map_image_id: map.id })).grid).toEqual({ ...PRESET, visible: true });
  });

  it('refuses a map image that does not exist and changes nothing', async () => {
    const session = await newSession();
    const scene = await newScene(session.id);
    const before = countRows(data.db);
    expectFailure(
      await patch(`/api/scenes/${scene.id}`, { map_image_id: 'f'.repeat(64), name: 'Renamed' }),
      400,
      'reference_not_found',
    );
    expect(countRows(data.db)).toEqual(before);
    expect(ok<Scene>(await get(`/api/scenes/${scene.id}`))).toEqual(scene);
  });

  it('never moves a token when the map changes (specs/03-domain-model.md §4)', async () => {
    const session = await newSession();
    const scene = await newScene(session.id, (await withPreset()).id);
    const asset = randomUUID();
    const token = (await uploaded(64, 64)).id;
    data.db
      .prepare(
        `INSERT INTO asset (id, name, category, image_id, size, default_hidden) VALUES (?, 'Orc', 'monster', ?, 'medium', 1)`,
      )
      .run(asset, token);
    data.db
      .prepare(
        'INSERT INTO token (id, scene_id, asset_id, label, x, y, hidden, z_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(randomUUID(), scene.id, asset, 'Orc', 3.25, 7.5, 1, 0);
    const positions = () => data.db.prepare('SELECT x, y FROM token WHERE scene_id = ?').all(scene.id);
    await update(scene.id, { map_image_id: (await uploaded(900, 300)).id });
    expect(positions()).toEqual([{ x: 3.25, y: 7.5 }]);
  });
});

describe('the previous map (specs/03-domain-model.md §7, Q-002)', () => {
  it('keeps the current map and its grid when a replacement is refused (review L-6)', async () => {
    const session = await newSession();
    const current = await withPreset();
    const scene = await newScene(session.id, current.id);
    expectFailure(await patch(`/api/scenes/${scene.id}`, { map_image_id: 'f'.repeat(64) }), 400, 'reference_not_found');
    expect(ok<Scene>(await get(`/api/scenes/${scene.id}`))).toEqual(scene);
    expect(stored(current.id)).toBe(true);
  });

  it('settles two map changes sent at once on one of them, removing only the map both replaced (review L-6)', async () => {
    const session = await newSession();
    const old = await withPreset();
    const scene = await newScene(session.id, old.id);
    const [a, b] = [await uploaded(300, 200), await uploaded(200, 300)];
    const answers = await Promise.all([
      patch(`/api/scenes/${scene.id}`, { map_image_id: a.id }),
      patch(`/api/scenes/${scene.id}`, { map_image_id: b.id }),
    ]);
    for (const answer of answers) expect(answer.statusCode, answer.body).toBe(200);
    const final = ok<Scene>(await get(`/api/scenes/${scene.id}`));
    expect([a.id, b.id]).toContain(final.map_image_id);
    expect(stored(old.id)).toBe(false);
    // The loser was attached, then replaced by the winner, and nothing else uses it.
    const loser = final.map_image_id === a.id ? b.id : a.id;
    expect(stored(loser)).toBe(false);
    expect(stored(final.map_image_id!)).toBe(true);
  });

  it('removes the previous map with its files and preset once nothing references it', async () => {
    const session = await newSession();
    const old = await withPreset();
    const scene = await newScene(session.id, old.id);
    expect(stored(old.id)).toBe(true);
    await update(scene.id, { map_image_id: (await uploaded()).id });
    expect(stored(old.id)).toBe(false);
  });

  it('keeps the previous map while another scene or an asset still uses it', async () => {
    const session = await newSession();
    const shared = await withPreset();
    const scene = await newScene(session.id, shared.id);
    await newScene(session.id, shared.id);
    await update(scene.id, { map_image_id: (await uploaded()).id });
    expect(stored(shared.id)).toBe(true);

    const pictured = await uploaded(128, 128);
    data.db
      .prepare(
        `INSERT INTO asset (id, name, category, image_id, size, default_hidden) VALUES (?, 'Map', 'object', ?, 'huge', 0)`,
      )
      .run(randomUUID(), pictured.id);
    const other = await newScene(session.id, pictured.id);
    await update(other.id, { map_image_id: (await uploaded()).id });
    expect(stored(pictured.id)).toBe(true);
  });
});

describe('grid visibility for players (specs/06-grid-and-measurement.md §2, D-026)', () => {
  it('sets grid.visible alone, with a rename, and after a new map in the same body', async () => {
    const session = await newSession();
    const map = await withPreset({ ...PRESET, visible: true });
    const scene = await newScene(session.id);
    expect((await update(scene.id, { grid: { visible: false } })).grid).toEqual({ ...DEFAULTS, visible: false });
    expect(await update(scene.id, { name: 'Lair', grid: { visible: true } })).toMatchObject({
      name: 'Lair',
      grid: DEFAULTS,
    });
    expect((await update(scene.id, { map_image_id: map.id, grid: { visible: false } })).grid).toEqual({
      ...PRESET,
      visible: false,
    });
    // A rename alone leaves the grid exactly as it was (review L-5).
    const before = ok<Scene>(await get(`/api/scenes/${scene.id}`));
    expect(await update(scene.id, { name: 'Den' })).toEqual({ ...before, name: 'Den' });
  });

  it('changes neither the image preset nor another scene of the same map (specs/03-domain-model.md §5)', async () => {
    const session = await newSession();
    const map = await withPreset();
    const [one, two] = [await newScene(session.id, map.id), await newScene(session.id, map.id)];
    await update(one.id, { grid: { visible: true } });
    expect(ok<Scene>(await get(`/api/scenes/${two.id}`))).toEqual(two);
    expect(ok<Image>(await get(`/api/images/${map.id}`)).grid_preset).toEqual(PRESET);
  });

  it('refuses feet per square, the type, a null map, an unknown field and an empty body, changing nothing', async () => {
    const session = await newSession();
    const scene = await newScene(session.id, (await withPreset()).id);
    const before = countRows(data.db);
    const bodies = [
      {},
      { grid: {} },
      { grid: { visible: 'yes' } },
      { grid: { visible: true, feet_per_square: 10 } },
      { grid: { size: 0 } },
      { grid: { size: null } },
      { grid: { columns: 2.5 } },
      { grid: { rows: 0 } },
      { grid: { offset_x: '3' } },
      { grid: { visible: true, type: 'square' } },
      { map_image_id: null },
      { map_image_id: 'A'.repeat(64) },
      { name: 'x', session_id: session.id },
      { name: 'x', order: 3 },
    ];
    for (const body of bodies) {
      expectFailure(await patch(`/api/scenes/${scene.id}`, body), 400, 'validation_failed');
    }
    expect(countRows(data.db)).toEqual(before);
    expect(ok<Scene>(await get(`/api/scenes/${scene.id}`))).toEqual(scene);
  });

  it('answers 404 for an unknown scene and 400 for an id that is not a lowercase UUID', async () => {
    expectFailure(await patch(`/api/scenes/${randomUUID()}`, { grid: { visible: false } }), 404, 'not_found');
    expectFailure(await patch('/api/scenes/NOT-A-UUID', { grid: { visible: false } }), 400, 'validation_failed');
  });
});

describe('calibration (PRP-03, specs/06-grid-and-measurement.md §1, §2, specs/03-domain-model.md §5, D-094)', () => {
  const CALIBRATED = { size: 70.4, offset_x: 12.25, offset_y: 3.5, columns: 14, rows: 9 };
  const preset = async (imageId: string) => ok<Image>(await get(`/api/images/${imageId}`)).grid_preset;

  it('stores a decimal size and the offsets and extent exactly, in original pixels, and writes the same grid as the image preset', async () => {
    const session = await newSession();
    const map = await uploaded(1000, 640);
    const scene = await newScene(session.id, map.id);
    expect(scene.grid).toEqual(DEFAULTS);
    const calibrated = await update(scene.id, { grid: CALIBRATED });
    expect(calibrated.grid).toEqual({ ...DEFAULTS, ...CALIBRATED });
    expect(await preset(map.id)).toEqual(calibrated.grid);
    // A size with more digits than a display would show survives the round trip unchanged.
    const fine = await update(scene.id, { grid: { size: 70.123456789 } });
    expect(fine.grid.size).toBe(70.123456789);
    expect(data.db.prepare('SELECT grid_size FROM scene WHERE id = ?').pluck().get(scene.id)).toBe(70.123456789);
    expect((await preset(map.id))!.size).toBe(70.123456789);
  });

  it('reads a missing size as original width ÷ columns, as the overlay does, so an offset alone calibrates', async () => {
    const session = await newSession();
    const map = await uploaded(1000, 640);
    const scene = await newScene(session.id, map.id);
    expect((await update(scene.id, { grid: { offset_x: 5 } })).grid).toMatchObject({ size: 1000 / 30, offset_x: 5 });
    const other = await newScene(session.id, (await uploaded(900, 600)).id);
    // Known dimensions: the columns alone give the size (specs/06-grid-and-measurement.md §1).
    expect((await update(other.id, { grid: { columns: 18, rows: 12 } })).grid).toMatchObject({
      size: 50,
      columns: 18,
      rows: 12,
    });
  });

  it('starts a new scene of the map from the preset and changes no other existing scene (Q-001)', async () => {
    const session = await newSession();
    const map = await uploaded(1000, 640);
    const [one, two] = [await newScene(session.id, map.id), await newScene(session.id, map.id)];
    const first = await update(one.id, { grid: CALIBRATED });
    expect(ok<Scene>(await get(`/api/scenes/${two.id}`))).toEqual(two);
    const later = await newScene(session.id, map.id);
    expect(later.grid).toEqual(first.grid);
    // Recalibrating the first scene moves the preset again, and only for scenes created after.
    const second = await update(one.id, { grid: { size: 64, offset_x: 0, offset_y: 0 } });
    expect(await preset(map.id)).toEqual(second.grid);
    expect(ok<Scene>(await get(`/api/scenes/${later.id}`))).toEqual(later);
    expect(ok<Scene>(await get(`/api/scenes/${two.id}`))).toEqual(two);
    expect((await newScene(session.id, map.id)).grid).toEqual(second.grid);
  });

  it("keeps the players' grid setting in the preset, and a visibility change alone writes no preset (specs/03-domain-model.md §5)", async () => {
    const session = await newSession();
    const map = await uploaded(1000, 640);
    const scene = await newScene(session.id, map.id);
    await update(scene.id, { grid: { ...CALIBRATED, visible: false } });
    expect(await preset(map.id)).toMatchObject({ ...CALIBRATED, visible: false });
    await update(scene.id, { grid: { visible: true } });
    expect((await preset(map.id))!.visible).toBe(false);
  });

  it("calibrates the new map when a body attaches it and calibrates at once, leaving the old map's preset alone", async () => {
    const session = await newSession();
    const old = await withPreset();
    const scene = await newScene(session.id, old.id);
    await newScene(session.id, old.id);
    const fresh = await uploaded(800, 800);
    const result = await update(scene.id, { map_image_id: fresh.id, grid: CALIBRATED });
    expect(result.grid).toEqual({ ...DEFAULTS, ...CALIBRATED });
    expect(await preset(fresh.id)).toEqual(result.grid);
    expect(await preset(old.id)).toEqual(PRESET);
  });

  it('never moves a token when the calibration changes (specs/03-domain-model.md §4)', async () => {
    const session = await newSession();
    const scene = await newScene(session.id, (await uploaded(1000, 640)).id);
    const asset = randomUUID();
    data.db
      .prepare(
        `INSERT INTO asset (id, name, category, image_id, size, default_hidden) VALUES (?, 'Orc', 'monster', ?, 'medium', 1)`,
      )
      .run(asset, (await uploaded(64, 64)).id);
    data.db
      .prepare(
        'INSERT INTO token (id, scene_id, asset_id, label, x, y, hidden, z_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(randomUUID(), scene.id, asset, 'Orc', 3.25, 7.5, 1, 0);
    await update(scene.id, { grid: CALIBRATED });
    await update(scene.id, { grid: { size: 33.3, offset_x: -4 } });
    expect(data.db.prepare('SELECT x, y FROM token WHERE scene_id = ?').all(scene.id)).toEqual([{ x: 3.25, y: 7.5 }]);
  });

  it('refuses every calibration field on a scene without a map, storing nothing of the body (specs/03-domain-model.md §6)', async () => {
    const session = await newSession();
    const scene = await newScene(session.id);
    const before = countRows(data.db);
    for (const grid of [{ size: 50 }, { offset_x: 1 }, { offset_y: 1 }, { columns: 10 }, { rows: 10 }]) {
      const response = await patch(`/api/scenes/${scene.id}`, { name: 'Renamed', grid: { ...grid, visible: false } });
      expectFailure(response, 409, 'calibration_needs_map');
    }
    expect(countRows(data.db)).toEqual(before);
    expect(ok<Scene>(await get(`/api/scenes/${scene.id}`))).toEqual(scene);
    // Whether players see the grid is not calibration, and stays allowed.
    expect((await update(scene.id, { grid: { visible: false } })).grid).toEqual({ ...DEFAULTS, visible: false });
  });

  it('writes the preset and the scene in one transaction: a failed scene write leaves the preset as it was', async () => {
    const session = await newSession();
    const map = await withPreset();
    const scene = await newScene(session.id, map.id);
    data.db.exec(`CREATE TRIGGER refuse_scene_grid BEFORE UPDATE OF grid_size ON scene
      BEGIN SELECT RAISE(ABORT, 'test: scene write refused'); END`);
    const response = await patch(`/api/scenes/${scene.id}`, { grid: CALIBRATED });
    expect(response.statusCode).toBe(500);
    data.db.exec('DROP TRIGGER refuse_scene_grid');
    expect(await preset(map.id)).toEqual(PRESET);
    expect(ok<Scene>(await get(`/api/scenes/${scene.id}`))).toEqual(scene);
  });

  it('answers a browser without a DM session with 401 and neither the scene nor the preset changes', async () => {
    const session = await newSession();
    const map = await withPreset();
    const scene = await newScene(session.id, map.id);
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/scenes/${scene.id}`,
      payload: { grid: CALIBRATED },
    });
    expectFailure(response, 401, 'unauthorized');
    expect(response.body).not.toContain(scene.id);
    expect(response.body).not.toContain(map.id);
    expect(ok<Scene>(await get(`/api/scenes/${scene.id}`))).toEqual(scene);
    expect(await preset(map.id)).toEqual(PRESET);
  });
});

describe('hidden information (specs/07-security-and-access.md §5, §7)', () => {
  it('answers a browser without a DM session, such as the player view, with 401 and changes nothing', async () => {
    const session = await newSession();
    const scene = await newScene(session.id);
    const map = await uploaded();
    const before = countRows(data.db);
    for (const body of [{ map_image_id: map.id }, { grid: { visible: false } }]) {
      const response = await app.inject({ method: 'PATCH', url: `/api/scenes/${scene.id}`, payload: body });
      expectFailure(response, 401, 'unauthorized');
      expect(response.body).not.toContain(scene.id);
      expect(response.body).not.toContain(map.id);
    }
    expect(countRows(data.db)).toEqual(before);
    expect(ok<Scene>(await get(`/api/scenes/${scene.id}`))).toEqual(scene);
  });

  it('serves a scene map to the DM session only, in every version, the scene not being live', async () => {
    const session = await newSession();
    const scene = await newScene(session.id);
    const map = await uploaded();
    await update(scene.id, { map_image_id: map.id });
    for (const variant of ['original', 'display', 'thumbnail'] as const) {
      expect((await get(imageFileUrl(map.id, variant))).statusCode).toBe(200);
      const anonymous = await app.inject({ method: 'GET', url: imageFileUrl(map.id, variant) });
      expectFailure(anonymous, 404, 'not_found');
    }
  });

  // Until LIV-02 adds the players' entitlement (specs/07-security-and-access.md §5), even the live
  // scene's map is refused without a DM session; LIV-02 turns the display version of this case
  // to 200 and keeps the other two at 404 (review L-7).
  it('refuses the live scene map without a DM session too, until LIV-02 entitles players to its display version', async () => {
    const session = await newSession();
    const scene = await newScene(session.id);
    const map = await uploaded();
    await update(scene.id, { map_image_id: map.id });
    data.db.prepare('UPDATE settings SET live_scene_id = ?').run(scene.id);
    for (const variant of ['original', 'display', 'thumbnail'] as const) {
      expectFailure(await app.inject({ method: 'GET', url: imageFileUrl(map.id, variant) }), 404, 'not_found');
    }
  });
});
