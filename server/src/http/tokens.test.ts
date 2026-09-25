import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ErrorEnvelopeSchema,
  SceneTokenSchema,
  TokenChangeSchema,
  type ErrorEnvelope,
  type Image,
  type LibraryAsset,
  type Scene,
  type SceneToken,
  type Session,
  type TokenChange,
} from '@emberglass/shared';
import { compileSchema } from '../validation.js';
import { buildTestApp, createTestData, dmCookie, setUpPin, type TestData } from './testing/app.js';

// PRP-04: tokens of a scene that is not live, over REST, against a real SQLite file
// (specs/02-architecture.md §5, specs/03-domain-model.md §4, §7, specs/05-assets-and-images.md
// §2–§5, specs/04-live-sync.md §2, D-019, Q-063, Q-091). Every image is generated here (Q-088).

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const isEnvelope = compileSchema<ErrorEnvelope>(ErrorEnvelopeSchema);
const isToken = compileSchema<SceneToken>(SceneTokenSchema);
const isChange = compileSchema<TokenChange>(TokenChangeSchema);

let data: TestData;
let app: FastifyInstance;
let cookie: string;

beforeEach(async () => {
  data = createTestData('emberglass-tokens-');
  app = await buildTestApp(data);
  cookie = await setUpPin(app, '4826');
});

afterEach(async () => {
  await app.close();
  data.remove();
});

let seed = 0;
const inject = (options: InjectOptions) =>
  app.inject({ ...options, headers: { cookie, ...(options.headers as Record<string, string> | undefined) } });
const get = (url: string) => inject({ method: 'GET', url });
const post = (url: string, payload: unknown) => inject({ method: 'POST', url, payload: payload as object });
const patch = (url: string, payload: unknown) => inject({ method: 'PATCH', url, payload: payload as object });
const remove = (url: string) => inject({ method: 'DELETE', url });

function ok<T>(response: LightMyRequestResponse, status = 200): T {
  expect(response.statusCode, response.body).toBe(status);
  return (status === 204 ? undefined : response.json<T>()) as T;
}

function expectFailure(response: LightMyRequestResponse, status: number, code: ErrorEnvelope['error']['code']): void {
  expect(response.statusCode, response.body).toBe(status);
  const body: unknown = response.json();
  expect(isEnvelope(body), JSON.stringify(isEnvelope.errors)).toBe(true);
  expect((body as ErrorEnvelope).error.code).toBe(code);
}

async function image(): Promise<Image> {
  const png = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: seed++ % 256, g: 1, b: 2 } },
  })
    .png()
    .toBuffer();
  return ok<Image>(
    await inject({
      method: 'POST',
      url: '/api/images',
      payload: png,
      headers: { 'content-type': 'application/octet-stream' },
    }),
    201,
  );
}

async function asset(name: string, fields: Partial<LibraryAsset> = {}): Promise<LibraryAsset> {
  const { id: image_id } = await image();
  return ok<LibraryAsset>(
    // An npc starts visible (specs/05-assets-and-images.md §4), so it is numbered as it is placed.
    await post('/api/assets', { name, image_id, category: 'npc', size: 'medium', ...fields }),
    201,
  );
}

let session: Session;
async function scene(name = 'Cave'): Promise<Scene> {
  if (!(session as Session | undefined)) {
    const campaign = ok<{ id: string }>(await post('/api/campaigns', { name: 'Tokens' }), 201);
    session = ok<Session>(await post(`/api/campaigns/${campaign.id}/sessions`, { title: 'One' }), 201);
  }
  return ok<Scene>(await post(`/api/sessions/${session.id}/scenes`, { name }), 201);
}
beforeEach(() => {
  session = undefined as unknown as Session;
});

const tokensUrl = (sceneId: string) => `/api/scenes/${sceneId}/tokens`;
const tokenUrl = (id: string) => `/api/tokens/${id}`;

async function place(sceneId: string, assetId: string, x = 1, y = 2): Promise<TokenChange> {
  const created = ok<TokenChange>(await post(tokensUrl(sceneId), { asset_id: assetId, x, y }), 201);
  expect(isChange(created), JSON.stringify(isChange.errors)).toBe(true);
  return created;
}

/** Changes a token, answering it as stored. */
async function changed(id: string, body: object): Promise<SceneToken> {
  const answer = ok<TokenChange>(await patch(tokenUrl(id), body));
  expect(isChange(answer), JSON.stringify(isChange.errors)).toBe(true);
  return answer.token;
}

const list = async (sceneId: string): Promise<SceneToken[]> => ok<SceneToken[]>(await get(tokensUrl(sceneId)));
const labels = async (sceneId: string): Promise<string[]> =>
  (await list(sceneId)).map((token) => token.label).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
const tokenRows = (): number => data.db.prepare('SELECT count(*) FROM token').pluck().get() as number;
const numbersOf = (sceneId: string): unknown =>
  JSON.parse(data.db.prepare('SELECT token_numbers FROM scene WHERE id = ?').pluck().get(sceneId) as string);
const goLive = (sceneId: string | null) => data.db.prepare('UPDATE settings SET live_scene_id = ?').run(sceneId);

describe('placing a token', () => {
  it('places a token at a decimal position, on top, hidden or visible from its asset', async () => {
    const cave = await scene();
    const goblin = await asset('Goblin', { category: 'monster' });
    const hero = await asset('Hero', { category: 'pc', size: 'large' });
    const first = await place(cave.id, goblin.id, 3.125, 4.0625);
    expect(first).toEqual({
      token: {
        id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/) as string,
        scene_id: cave.id,
        asset_id: goblin.id,
        label: 'Goblin',
        x: 3.125,
        y: 4.0625,
        hidden: true,
        z_order: 0,
        character_id: null,
        asset: { name: 'Goblin', image_id: goblin.image_id, size: 'medium' },
      },
      relabelled: [],
    });
    const second = await place(cave.id, hero.id, 0.1 + 0.2, -1.5);
    expect(second.token).toMatchObject({ label: 'Hero', hidden: false, z_order: 1, x: 0.1 + 0.2, y: -1.5 });
    expect(second.token.asset.size).toBe('large');
    // Stored exactly as answered, in grid units, never pixels (specs/03-domain-model.md §4).
    expect(await list(cave.id)).toEqual([first.token, second.token]);
    expect(data.db.prepare('SELECT x FROM token WHERE id = ?').pluck().get(second.token.id)).toBe(0.1 + 0.2);
  });

  it('starts from the asset as it is now: an asset set visible places a visible monster', async () => {
    const cave = await scene();
    const shown = await asset('Statue', { category: 'monster', default_hidden: false });
    const secret = await asset('Spy', { category: 'npc', default_hidden: true });
    expect((await place(cave.id, shown.id)).token.hidden).toBe(false);
    expect((await place(cave.id, secret.id)).token.hidden).toBe(true);
  });

  it('refuses a body naming its own label, visibility, id or order, or a position out of bounds, storing nothing', async () => {
    const cave = await scene();
    const goblin = await asset('Goblin');
    for (const body of [
      { asset_id: goblin.id, x: 1, y: 1, label: 'Mine' },
      { asset_id: goblin.id, x: 1, y: 1, hidden: false },
      { asset_id: goblin.id, x: 1, y: 1, id: goblin.id },
      { asset_id: goblin.id, x: 1, y: 1, z_order: 9 },
      { asset_id: goblin.id, x: 1, y: 1, scene_id: cave.id },
      { asset_id: goblin.id, x: 1 },
      { asset_id: goblin.id, x: 2e6, y: 1 },
      { asset_id: goblin.id, x: '1', y: 1 },
      { asset_id: 'goblin', x: 1, y: 1 },
    ]) {
      expectFailure(await post(tokensUrl(cave.id), body), 400, 'validation_failed');
    }
    expect(tokenRows()).toBe(0);
    expect(numbersOf(cave.id)).toEqual({});
  });

  it('answers an unknown scene with 404 and an unknown asset with 400, storing nothing', async () => {
    const cave = await scene();
    const goblin = await asset('Goblin');
    expectFailure(await post(tokensUrl(crypto.randomUUID()), { asset_id: goblin.id, x: 0, y: 0 }), 404, 'not_found');
    expectFailure(await get(tokensUrl(crypto.randomUUID())), 404, 'not_found');
    expectFailure(
      await post(tokensUrl(cave.id), { asset_id: crypto.randomUUID(), x: 0, y: 0 }),
      400,
      'reference_not_found',
    );
    expect(tokenRows()).toBe(0);
    expect(numbersOf(cave.id)).toEqual({});
  });
});

describe('numbering (specs/05-assets-and-images.md §3, D-019, Q-063, Q-091)', () => {
  it('numbers four goblins Goblin 1 to Goblin 4, the first renamed when the second arrives', async () => {
    const cave = await scene();
    const goblin = await asset('Goblin');
    const first = await place(cave.id, goblin.id);
    expect(first.token.label).toBe('Goblin');
    const second = await place(cave.id, goblin.id);
    expect(second.token.label).toBe('Goblin 2');
    expect(second.relabelled).toEqual([{ ...first.token, label: 'Goblin 1' }]);
    await place(cave.id, goblin.id);
    await place(cave.id, goblin.id);
    expect(await labels(cave.id)).toEqual(['Goblin 1', 'Goblin 2', 'Goblin 3', 'Goblin 4']);
    expect(numbersOf(cave.id)).toEqual({ [goblin.id]: 4 });
  });

  it('never issues a freed number again, the highest included, and a restart keeps what was issued', async () => {
    const cave = await scene();
    const goblin = await asset('Goblin');
    const placed = [];
    for (let each = 0; each < 4; each++) placed.push(await place(cave.id, goblin.id));
    ok(await remove(tokenUrl(placed[3]!.token.id)), 204);
    ok(await remove(tokenUrl(placed[1]!.token.id)), 204);
    expect((await place(cave.id, goblin.id)).token.label).toBe('Goblin 5');

    // What was issued is stored, so a restarted server numbers on.
    await app.close();
    data.db.close();
    data.db = data.reopen();
    app = await buildTestApp(data);
    cookie = dmCookie(await app.inject({ method: 'POST', url: '/api/auth', payload: { pin: '4826' } }));
    for (const token of await list(cave.id)) ok(await remove(tokenUrl(token.id)), 204);
    const next = await place(cave.id, goblin.id);
    expect(next).toMatchObject({ token: { label: 'Goblin 6' }, relabelled: [] });
  });

  it('numbers a new token after a lone one that was deleted, never giving the bare name twice', async () => {
    const cave = await scene();
    const goblin = await asset('Goblin');
    ok(await remove(tokenUrl((await place(cave.id, goblin.id)).token.id)), 204);
    expect(await place(cave.id, goblin.id)).toMatchObject({ token: { label: 'Goblin 2' }, relabelled: [] });
  });

  it('never gives a freed 1 again when the DM renames a later token to the bare name (review)', async () => {
    const cave = await scene();
    const goblin = await asset('Goblin');
    ok(await remove(tokenUrl((await place(cave.id, goblin.id)).token.id)), 204);
    const second = await place(cave.id, goblin.id);
    ok(await patch(tokenUrl(second.token.id), { label: 'Goblin' }));
    expect(await place(cave.id, goblin.id)).toMatchObject({ token: { label: 'Goblin 3' }, relabelled: [] });
    expect(await labels(cave.id)).toEqual(['Goblin', 'Goblin 3']);
  });

  it('numbers placements sent at once one after another, never giving two the same number (review)', async () => {
    const cave = await scene();
    const goblin = await asset('Goblin');
    await Promise.all(Array.from({ length: 4 }, () => post(tokensUrl(cave.id), { asset_id: goblin.id, x: 0, y: 0 })));
    expect(await labels(cave.id)).toEqual(['Goblin 1', 'Goblin 2', 'Goblin 3', 'Goblin 4']);
  });

  it('places a token, its relabel and its number in one transaction: a failed number write leaves all as it was (review)', async () => {
    const cave = await scene();
    const goblin = await asset('Goblin');
    const first = await place(cave.id, goblin.id);
    data.db.exec(
      "CREATE TRIGGER fail_numbers BEFORE UPDATE OF token_numbers ON scene BEGIN SELECT RAISE(ABORT, 'test'); END",
    );
    try {
      expectFailure(await post(tokensUrl(cave.id), { asset_id: goblin.id, x: 0, y: 0 }), 500, 'internal_error');
    } finally {
      data.db.exec('DROP TRIGGER fail_numbers');
    }
    expect(await list(cave.id)).toEqual([first.token]);
    expect(numbersOf(cave.id)).toEqual({ [goblin.id]: 1 });
  });

  it('numbers per scene and per asset', async () => {
    const [cave, crypt] = [await scene('Cave'), await scene('Crypt')];
    const [goblin, orc] = [await asset('Goblin'), await asset('Orc')];
    await place(cave.id, goblin.id);
    await place(cave.id, goblin.id);
    await place(cave.id, orc.id);
    await place(crypt.id, goblin.id);
    expect(await labels(cave.id)).toEqual(['Goblin 1', 'Goblin 2', 'Orc']);
    expect(await labels(crypt.id)).toEqual(['Goblin']);
  });

  it('leaves a relabelled token alone and numbers after a number the DM typed', async () => {
    const cave = await scene();
    const goblin = await asset('Goblin');
    const boss = await place(cave.id, goblin.id);
    ok(await patch(tokenUrl(boss.token.id), { label: 'Boss' }));
    const second = await place(cave.id, goblin.id);
    expect(second).toMatchObject({ token: { label: 'Goblin 2' }, relabelled: [] });
    ok(await patch(tokenUrl(second.token.id), { label: 'Goblin 9' }));
    expect((await place(cave.id, goblin.id)).token.label).toBe('Goblin 10');
    expect(await labels(cave.id)).toEqual(['Boss', 'Goblin 9', 'Goblin 10']);
  });

  it('continues after the labels of a scene numbered before migration 0002 recorded anything', async () => {
    const cave = await scene();
    const goblin = await asset('Goblin');
    const insert = data.db.prepare(
      'INSERT INTO token (id, scene_id, asset_id, label, x, y, hidden, z_order) VALUES (?, ?, ?, ?, 0, 0, 1, ?)',
    );
    insert.run(crypto.randomUUID(), cave.id, goblin.id, 'Goblin 1', 0);
    insert.run(crypto.randomUUID(), cave.id, goblin.id, 'Goblin 3', 1);
    expect(numbersOf(cave.id)).toEqual({});
    expect((await place(cave.id, goblin.id)).token).toMatchObject({ label: 'Goblin 4', z_order: 2 });
  });

  it('a duplicated scene numbers on from the original, and each keeps its own numbers afterwards', async () => {
    const cave = await scene();
    const goblin = await asset('Goblin');
    await place(cave.id, goblin.id);
    const doomed = await place(cave.id, goblin.id);
    ok(await remove(tokenUrl(doomed.token.id)), 204);
    const copy = ok<Scene>(await post(`/api/scenes/${cave.id}/duplicate`, { name: 'Cave again' }), 201);
    expect(await labels(copy.id)).toEqual(['Goblin 1']);
    expect((await place(copy.id, goblin.id)).token.label).toBe('Goblin 3');
    expect((await place(copy.id, goblin.id)).token.label).toBe('Goblin 4');
    expect((await place(cave.id, goblin.id)).token.label).toBe('Goblin 3');
  });

  it('forgets the numbers of a deleted asset, which no token used any more', async () => {
    const cave = await scene();
    const [goblin, orc] = [await asset('Goblin'), await asset('Orc')];
    const placed = await place(cave.id, goblin.id);
    await place(cave.id, orc.id);
    expectFailure(await remove(`/api/assets/${goblin.id}`), 409, 'asset_in_use');
    expect(numbersOf(cave.id)).toEqual({ [goblin.id]: 1, [orc.id]: 1 });
    ok(await remove(tokenUrl(placed.token.id)), 204);
    ok(await remove(`/api/assets/${goblin.id}`), 204);
    expect(numbersOf(cave.id)).toEqual({ [orc.id]: 1 });
  });
});

describe('hidden tokens are numbered only when first shown (specs/05-assets-and-images.md §3, Q-092)', () => {
  it('places a hidden token with the bare name, numbering nothing and renaming no visible token', async () => {
    const cave = await scene();
    const goblin = await asset('Goblin', { category: 'monster' });
    ok(await patch(`/api/assets/${goblin.id}`, { default_hidden: false }));
    const shown = await place(cave.id, goblin.id);
    expect(shown.token).toMatchObject({ label: 'Goblin', hidden: false });
    ok(await patch(`/api/assets/${goblin.id}`, { default_hidden: true }));
    // A hidden second goblin: the visible one keeps its label, which is what the TV shows.
    const secret = await place(cave.id, goblin.id);
    expect(secret).toMatchObject({ token: { label: 'Goblin', hidden: true }, relabelled: [] });
    expect(await labels(cave.id)).toEqual(['Goblin', 'Goblin']);
    expect(numbersOf(cave.id)).toEqual({ [goblin.id]: 1 });
  });

  it('numbers a revealed token, renaming the lone visible one in the same answer', async () => {
    const cave = await scene();
    const goblin = await asset('Goblin', { category: 'monster' });
    const [a, b, c] = [
      await place(cave.id, goblin.id),
      await place(cave.id, goblin.id),
      await place(cave.id, goblin.id),
    ];
    expect(await labels(cave.id)).toEqual(['Goblin', 'Goblin', 'Goblin']);
    expect(numbersOf(cave.id)).toEqual({});
    // The first shown keeps the bare name.
    expect(ok<TokenChange>(await patch(tokenUrl(a.token.id), { hidden: false }))).toMatchObject({
      token: { label: 'Goblin', hidden: false },
      relabelled: [],
    });
    // The second shown is 2, and the first becomes 1 with it.
    const second = ok<TokenChange>(await patch(tokenUrl(b.token.id), { hidden: false }));
    expect(second.token.label).toBe('Goblin 2');
    expect(second.relabelled).toEqual([{ ...a.token, hidden: false, label: 'Goblin 1' }]);
    // A deleted number is not given again when the third is shown.
    ok(await remove(tokenUrl(b.token.id)), 204);
    expect((await changed(c.token.id, { hidden: false })).label).toBe('Goblin 3');
  });

  it('keeps a label given with the reveal or typed by the DM, and a numbered token hidden again keeps its number', async () => {
    const cave = await scene();
    const goblin = await asset('Goblin', { category: 'monster' });
    const [a, b, c] = [
      await place(cave.id, goblin.id),
      await place(cave.id, goblin.id),
      await place(cave.id, goblin.id),
    ];
    expect((await changed(a.token.id, { hidden: false, label: 'Chief' })).label).toBe('Chief');
    ok(await patch(tokenUrl(b.token.id), { label: 'Scout' }));
    expect((await changed(b.token.id, { hidden: false })).label).toBe('Scout');
    const shown = await changed(c.token.id, { hidden: false });
    expect(shown.label).toBe('Goblin 2');
    expect((await changed(c.token.id, { hidden: true })).label).toBe('Goblin 2');
    expect((await changed(c.token.id, { hidden: false })).label).toBe('Goblin 2');
  });

  it('numbers a visible placement after the shown tokens only, never after a hidden one', async () => {
    const cave = await scene();
    const goblin = await asset('Goblin', { category: 'monster' });
    await place(cave.id, goblin.id);
    await place(cave.id, goblin.id);
    ok(await patch(`/api/assets/${goblin.id}`, { default_hidden: false }));
    expect(await place(cave.id, goblin.id)).toMatchObject({ token: { label: 'Goblin' }, relabelled: [] });
  });
});

describe('changing a token', () => {
  it('moves it to decimal grid units, hides and reveals it, and relabels it, trimmed', async () => {
    const cave = await scene();
    const goblin = await asset('Goblin');
    const { token } = await place(cave.id, goblin.id);
    const moved = await changed(token.id, { x: 7.5, y: 2.25 });
    expect(isToken(moved), JSON.stringify(isToken.errors)).toBe(true);
    expect(moved).toEqual({ ...token, x: 7.5, y: 2.25 });
    expect((await changed(token.id, { hidden: false })).hidden).toBe(false);
    expect((await changed(token.id, { hidden: true })).hidden).toBe(true);
    expect((await changed(token.id, { label: '  Chief  ' })).label).toBe('Chief');
    expect(await list(cave.id)).toEqual([{ ...token, x: 7.5, y: 2.25, hidden: true, label: 'Chief' }]);
  });

  it('brings a token to the front or sends it to the back of its scene only', async () => {
    const [cave, crypt] = [await scene('Cave'), await scene('Crypt')];
    const goblin = await asset('Goblin');
    const [a, b, c] = [
      await place(cave.id, goblin.id),
      await place(cave.id, goblin.id),
      await place(cave.id, goblin.id),
    ];
    const elsewhere = await place(crypt.id, goblin.id);
    ok(await patch(tokenUrl(elsewhere.token.id), { stack: 'front' }));
    const order = async () => (await list(cave.id)).map((token) => token.id);
    expect(await order()).toEqual([a.token.id, b.token.id, c.token.id]);
    ok(await patch(tokenUrl(a.token.id), { stack: 'front' }));
    expect(await order()).toEqual([b.token.id, c.token.id, a.token.id]);
    ok(await patch(tokenUrl(c.token.id), { stack: 'back' }));
    expect(await order()).toEqual([c.token.id, b.token.id, a.token.id]);
    // Already there: nothing moves.
    const z = (await changed(a.token.id, { stack: 'front' })).z_order;
    expect((await changed(a.token.id, { stack: 'front' })).z_order).toBe(z);
    // A new token still goes on top.
    expect((await place(cave.id, goblin.id)).token.z_order).toBeGreaterThan(z);
  });

  it('leaves a lone token where it is in the stack', async () => {
    const cave = await scene();
    const goblin = await asset('Goblin');
    const { token } = await place(cave.id, goblin.id);
    expect((await changed(token.id, { stack: 'front' })).z_order).toBe(token.z_order);
    expect((await changed(token.id, { stack: 'back' })).z_order).toBe(token.z_order);
  });

  it('changes a token in one transaction: a failed write leaves it as it was (review)', async () => {
    const cave = await scene();
    const goblin = await asset('Goblin');
    const { token } = await place(cave.id, goblin.id);
    data.db.exec("CREATE TRIGGER fail_token BEFORE UPDATE ON token BEGIN SELECT RAISE(ABORT, 'test'); END");
    try {
      expectFailure(await patch(tokenUrl(token.id), { x: 9, label: 'Chief' }), 500, 'internal_error');
    } finally {
      data.db.exec('DROP TRIGGER fail_token');
    }
    expect(await list(cave.id)).toEqual([token]);
  });

  it('refuses an empty body, an empty or blank label, another field and a bad value, changing nothing', async () => {
    const cave = await scene();
    const goblin = await asset('Goblin');
    const { token } = await place(cave.id, goblin.id);
    for (const body of [
      {},
      { label: '' },
      { label: '   ' },
      { label: 'x'.repeat(201) },
      { label: 'Gob\u0000lin' },
      { label: 'Goblin\n2' },
      { label: '\u0085Goblin' },
      { z_order: 5 },
      { asset_id: goblin.id },
      { scene_id: cave.id },
      { character_id: null },
      { id: token.id },
      { stack: 'top' },
      { hidden: 'yes' },
      { x: Number.MAX_VALUE },
    ]) {
      expectFailure(await patch(tokenUrl(token.id), body), 400, 'validation_failed');
    }
    expect(await list(cave.id)).toEqual([token]);
  });

  it('answers an unknown token with 404 and a malformed id with 400', async () => {
    expectFailure(await patch(tokenUrl(crypto.randomUUID()), { x: 1 }), 404, 'not_found');
    expectFailure(await remove(tokenUrl(crypto.randomUUID())), 404, 'not_found');
    expectFailure(await patch(tokenUrl('nope'), { x: 1 }), 400, 'validation_failed');
  });

  it('deletes a token for good; its image follows its asset while it exists', async () => {
    const cave = await scene();
    const goblin = await asset('Goblin');
    const { token } = await place(cave.id, goblin.id);
    const { id: newImage } = await image();
    ok(await patch(`/api/assets/${goblin.id}`, { image_id: newImage, size: 'huge' }));
    expect((await list(cave.id))[0]!.asset).toEqual({ name: 'Goblin', image_id: newImage, size: 'huge' });
    ok(await remove(tokenUrl(token.id)), 204);
    expect(await list(cave.id)).toEqual([]);
    expectFailure(await remove(tokenUrl(token.id)), 404, 'not_found');
  });
});

describe('the live scene (specs/04-live-sync.md §2)', () => {
  it("refuses every write to the live scene's tokens, changing nothing, and lists them for the DM", async () => {
    const cave = await scene();
    const goblin = await asset('Goblin');
    const { token } = await place(cave.id, goblin.id);
    goLive(cave.id);
    expectFailure(await post(tokensUrl(cave.id), { asset_id: goblin.id, x: 0, y: 0 }), 409, 'scene_live');
    for (const body of [{ x: 4 }, { hidden: false }, { label: 'Renamed' }, { stack: 'back' }]) {
      expectFailure(await patch(tokenUrl(token.id), body), 409, 'scene_live');
    }
    expectFailure(await remove(tokenUrl(token.id)), 409, 'scene_live');
    expect(await list(cave.id)).toEqual([token]);
    expect(numbersOf(cave.id)).toEqual({ [goblin.id]: 1 });

    // Once it is no longer live, the same requests go through.
    goLive(null);
    ok(await patch(tokenUrl(token.id), { x: 4 }));
    await place(cave.id, goblin.id);
  });

  it('leaves the other scenes of a live one open to preparation', async () => {
    const [cave, crypt] = [await scene('Cave'), await scene('Crypt')];
    const goblin = await asset('Goblin');
    goLive(cave.id);
    const { token } = await place(crypt.id, goblin.id);
    ok(await patch(tokenUrl(token.id), { hidden: false }));
    ok(await remove(tokenUrl(token.id)), 204);
  });
});

describe('without a DM session', () => {
  it('answers every token route with the 401 of an unknown path, naming no scene, token or asset', async () => {
    const cave = await scene();
    const goblin = await asset('Goblin');
    const { token } = await place(cave.id, goblin.id);
    const reference = await app.inject({ method: 'GET', url: '/api/definitely-not-a-route' });
    expect(reference.statusCode).toBe(401);
    const requests: (InjectOptions & { url: string })[] = [
      { method: 'GET', url: tokensUrl(cave.id) },
      { method: 'POST', url: tokensUrl(cave.id), payload: { asset_id: goblin.id, x: 0, y: 0 } },
      { method: 'PATCH', url: tokenUrl(token.id), payload: { hidden: false } },
      { method: 'DELETE', url: tokenUrl(token.id) },
      { method: 'GET', url: tokensUrl(crypto.randomUUID()) },
      { method: 'PATCH', url: tokenUrl(crypto.randomUUID()), payload: { x: 1 } },
    ];
    for (const request of requests) {
      const response = await app.inject(request);
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(401);
      expect(response.body).toBe(reference.body);
      for (const id of [cave.id, token.id, goblin.id, goblin.image_id]) expect(response.body).not.toContain(id);
    }
    // Nothing changed.
    expect(await list(cave.id)).toEqual([token]);
  });
});
