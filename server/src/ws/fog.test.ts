import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DmSnapshot,
  ErrorEnvelope,
  EventEnvelope,
  PlayerSnapshot,
  PlayerToken,
  Region,
  RegionShape,
  Scene,
  SceneToken,
} from '@emberglass/shared';
import { ok, startLive, type Client, type LiveHarness } from './testing/harness.js';

// TBL-03 over a real port and real Socket.io clients, against a real SQLite file (specs/04-live-sync.md
// §2, §3, §4, §8, §13, specs/07-security-and-access.md §5, Q-099): a token under a fogged region is to
// players as a hidden one is. They receive the fogged shapes and never a region's name; fogging a region
// removes the tokens under it and revealing it adds them, each at its rank; a token moved across the edge
// comes and goes; its image file follows; numbering waits for players to see a token; each region command
// is undone and redone; a player view cannot send one.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let h: LiveHarness;

afterEach(async () => {
  await h.close();
});

// The back room: columns 4 to 8, rows 0 to 4, corners included.
const BACK_ROOM: RegionShape = { kind: 'rect', x: 4, y: 0, width: 4, height: 4 };

interface Live {
  scene: Scene;
  other: Scene;
  dm: Client;
  tv: Client;
  /** Visible, outside the back room. */
  guard: SceneToken;
  /** Visible, inside the back room. */
  cultist: SceneToken;
  /** Hidden, inside the back room. */
  lurker: SceneToken;
}

async function liveScene(): Promise<Live> {
  h = await startLive();
  const scene = await h.scene('The manor', (await h.image('fog map', 96)).id);
  const other = await h.scene('The garden', (await h.image('fog map B', 80)).id);
  const guard = await h.place(scene.id, (await h.asset('Guard', { default_hidden: false })).id, 1, 1);
  const cultist = await h.place(scene.id, (await h.asset('Cultist', { default_hidden: false })).id, 5, 1);
  const lurker = await h.place(scene.id, (await h.asset('Lurker', { default_hidden: true })).id, 6, 2);
  const dm = await h.connect({ cookie: h.cookie });
  const tv = await h.connect();
  expect(await h.command(dm, 'scene.activate', { scene_id: scene.id })).toEqual({ ok: true });
  await dm.settle();
  await tv.settle();
  return { scene, other, dm, tv, guard, cultist, lurker };
}

const code = (ack: unknown) => (ack as ErrorEnvelope).error.code;
const types = (events: { type: string }[]) => events.map((event) => event.type);
const payloads = (events: EventEnvelope[], type: string) =>
  events.filter((event) => event.type === type).map((event) => event.payload);
const regionOf = (events: EventEnvelope[]) => (payloads(events, 'region.added')[0]! as { region: Region }).region;
const playerSnapshot = async () => (await h.connect()).first.payload as PlayerSnapshot;
const drawn = async () => (await playerSnapshot()).scene!.tokens.map((token) => token.id);
const imageStatus = async (token: SceneToken) =>
  (await h.app.inject({ method: 'GET', url: `/images/${token.asset.image_id}/display` })).statusCode;

async function fogBackRoom(live: Live, hidden = true): Promise<Region> {
  expect(
    await h.command(live.dm, 'region.add', { scene_id: live.scene.id, name: 'Back room', shape: BACK_ROOM, hidden }),
  ).toEqual({ ok: true });
  const region = regionOf(await live.dm.settle());
  await live.tv.settle();
  return region;
}

describe('drawing, fogging and revealing a region (specs/04-live-sync.md §2, §3, §13)', () => {
  it('fogs a new region: the DM hears of it by name, players of its shape and of the token it covers only', async () => {
    const live = await liveScene();
    const { dm, tv, cultist, scene } = live;
    expect(await imageStatus(cultist)).toBe(200);
    expect(await h.command(dm, 'region.add', { scene_id: scene.id, name: 'Back room', shape: BACK_ROOM })).toEqual({
      ok: true,
    });
    const dmEvents = await dm.settle();
    expect(types(dmEvents)).toEqual(['region.added', 'history.changed']);
    const region = regionOf(dmEvents);
    expect(region).toMatchObject({ scene_id: scene.id, name: 'Back room', shape: BACK_ROOM, hidden: true, order: 1 });
    const tvEvents = await tv.settle();
    expect(types(tvEvents)).toEqual(['fog.updated', 'token.removed']);
    expect(tvEvents[0]!.payload).toEqual({ fog: [BACK_ROOM] });
    expect(tvEvents[1]!.payload).toEqual({ id: cultist.id });
    // Nothing of the name, the id or the hidden lurker reaches players.
    const text = JSON.stringify(tvEvents);
    for (const secret of ['Back room', region.id, live.lurker.id]) expect(text).not.toContain(secret);
    // The snapshot agrees, and the covered token's image is refused from now on.
    const snapshot = await playerSnapshot();
    expect(snapshot.scene!.fog).toEqual([BACK_ROOM]);
    expect(snapshot.scene!.tokens.map((token) => token.id)).toEqual([live.guard.id]);
    expect(JSON.stringify(snapshot)).not.toContain('Back room');
    expect(await imageStatus(cultist)).toBe(404);
    // The DM's snapshot carries the region, named.
    const laptop = await h.connect({ cookie: h.cookie });
    expect((laptop.first.payload as DmSnapshot).scene!.regions).toEqual([region]);
  });

  it('reveals it: players see the shape go and the visible token under it come back at its rank, never the hidden one', async () => {
    const live = await liveScene();
    const region = await fogBackRoom(live);
    expect(await h.command(live.dm, 'region.setHidden', { region_id: region.id, hidden: false })).toEqual({ ok: true });
    expect(types(await live.dm.settle())).toEqual(['region.updated']);
    const tvEvents = await live.tv.settle();
    expect(types(tvEvents)).toEqual(['fog.updated', 'token.added']);
    expect(tvEvents[0]!.payload).toEqual({ fog: [] });
    const added = (tvEvents[1]!.payload as { token: PlayerToken }).token;
    expect(added).toMatchObject({ id: live.cultist.id, z_order: 1 });
    expect(JSON.stringify(tvEvents)).not.toContain(live.lurker.id);
    expect(await drawn()).toEqual([live.guard.id, live.cultist.id]);
    expect(await imageStatus(live.cultist)).toBe(200);
    expect(await imageStatus(live.lurker)).toBe(404);
    // Revealing a revealed region, or fogging it twice, tells nobody.
    expect(await h.command(live.dm, 'region.setHidden', { region_id: region.id, hidden: false })).toEqual({ ok: true });
    expect(await live.dm.settle()).toEqual([]);
    expect(await live.tv.settle()).toEqual([]);
  });

  it('renames a region for the DM only; draws one revealed without telling players anything', async () => {
    const live = await liveScene();
    const region = await fogBackRoom(live);
    expect(await h.command(live.dm, 'region.rename', { region_id: region.id, name: '  Study  ' })).toEqual({
      ok: true,
    });
    const dmEvents = await live.dm.settle();
    expect((payloads(dmEvents, 'region.updated')[0] as { region: Region }).region.name).toBe('Study');
    expect(await live.tv.settle()).toEqual([]);
    expect(
      await h.command(live.dm, 'region.add', {
        scene_id: live.scene.id,
        name: 'Garden',
        shape: { kind: 'rect', x: 0, y: 6, width: 3, height: 3 },
        hidden: false,
      }),
    ).toEqual({ ok: true });
    expect(types(await live.dm.settle())).toEqual(['region.added']);
    expect(await live.tv.settle()).toEqual([]);
  });

  it('deletes a fogged region: players see the fog go and the tokens it covered come back', async () => {
    const live = await liveScene();
    const region = await fogBackRoom(live);
    expect(await h.command(live.dm, 'region.delete', { region_id: region.id })).toEqual({ ok: true });
    expect(types(await live.dm.settle())).toEqual(['region.removed']);
    expect(types(await live.tv.settle())).toEqual(['fog.updated', 'token.added']);
    expect((await playerSnapshot()).scene!.fog).toEqual([]);
  });

  it('refuses a region for a scene that is not live, an unknown region, a bad shape and a player view', async () => {
    const live = await liveScene();
    const region = await fogBackRoom(live);
    expect(code(await h.command(live.dm, 'region.add', { scene_id: live.other.id, name: 'X', shape: BACK_ROOM }))).toBe(
      'scene_not_live',
    );
    const unknown = '00000000-0000-4000-8000-00000000ffff';
    expect(code(await h.command(live.dm, 'region.setHidden', { region_id: unknown, hidden: false }))).toBe('not_found');
    expect(code(await h.command(live.dm, 'region.delete', { region_id: unknown }))).toBe('not_found');
    for (const shape of [
      { kind: 'rect', x: 0.5, y: 0, width: 2, height: 2 },
      { kind: 'polygon', points: [{ x: 0, y: 0 }] },
    ]) {
      expect(code(await h.command(live.dm, 'region.add', { scene_id: live.scene.id, name: 'X', shape }))).toBe(
        'validation_failed',
      );
    }
    expect(code(await h.command(live.tv, 'region.setHidden', { region_id: region.id, hidden: false }))).toBe(
      'forbidden',
    );
    expect(await live.dm.settle()).toEqual([]);
    expect(await live.tv.settle()).toEqual([]);
  });

  it('draws a polygon, and judges each token by its centre', async () => {
    const live = await liveScene();
    // A triangle whose slanted edge runs through the guard's square, missing its centre (1.5, 1.5).
    const shape: RegionShape = {
      kind: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 0, y: 2 },
      ],
    };
    expect(await h.command(live.dm, 'region.add', { scene_id: live.scene.id, name: 'Corner', shape })).toEqual({
      ok: true,
    });
    await live.dm.settle();
    expect(types(await live.tv.settle())).toEqual(['fog.updated']);
    expect(await drawn()).toEqual([live.guard.id, live.cultist.id]);
  });
});

describe('tokens and the fog', () => {
  it('sends a move into the fog as token.removed and out of it as token.added, the image following', async () => {
    const live = await liveScene();
    await fogBackRoom(live);
    const { dm, tv, guard } = live;
    expect(await h.command(dm, 'token.move', { token_id: guard.id, x: 5, y: 2 })).toEqual({ ok: true });
    expect(types(await tv.settle())).toEqual(['token.removed']);
    expect(await imageStatus(guard)).toBe(404);
    // Moving under the fog is nothing to players.
    expect(await h.command(dm, 'token.move', { token_id: guard.id, x: 6, y: 1 })).toEqual({ ok: true });
    expect(await tv.settle()).toEqual([]);
    expect(await h.command(dm, 'token.move', { token_id: guard.id, x: 1, y: 1 })).toEqual({ ok: true });
    const events = await tv.settle();
    expect(types(events)).toEqual(['token.added']);
    expect((events[0]!.payload as { token: PlayerToken }).token).toMatchObject({
      id: guard.id,
      x: 1,
      y: 1,
      z_order: 0,
    });
    expect(await imageStatus(guard)).toBe(200);
  });

  it('keeps a revealed token under the fog from players, and a token placed there, until the fog lifts', async () => {
    const live = await liveScene();
    const region = await fogBackRoom(live);
    const { dm, tv, lurker, scene } = live;
    expect(await h.command(dm, 'token.setVisibility', { token_id: lurker.id, hidden: false })).toEqual({ ok: true });
    expect(await tv.settle()).toEqual([]);
    const imp = await h.asset('Imp', { default_hidden: false });
    expect(await h.command(dm, 'token.add', { scene_id: scene.id, asset_id: imp.id, x: 7, y: 3 })).toEqual({
      ok: true,
    });
    expect(await tv.settle()).toEqual([]);
    expect(await drawn()).toEqual([live.guard.id]);
    expect(await h.command(dm, 'region.setHidden', { region_id: region.id, hidden: false })).toEqual({ ok: true });
    const events = await tv.settle();
    expect(types(events)).toEqual(['fog.updated', 'token.added', 'token.added', 'token.added']);
    // Each arrives at its rank, bottom of the stack first, so they insert as a snapshot would draw them.
    expect(events.slice(1).map((event) => (event.payload as { token: PlayerToken }).token.z_order)).toEqual([1, 2, 3]);
    expect((await drawn()).length).toBe(4);
  });

  it('numbers a token placed visible under the fog when players first see it, renaming its sibling only then', async () => {
    const live = await liveScene();
    const region = await fogBackRoom(live);
    const { dm, tv, scene, guard } = live;
    // A second guard, placed visible but under the fog: players' lone "Guard" keeps its name.
    expect(await h.command(dm, 'token.add', { scene_id: scene.id, asset_id: guard.asset_id, x: 6, y: 1 })).toEqual({
      ok: true,
    });
    const placed = payloads(await dm.settle(), 'token.added')[0] as { token: SceneToken; relabelled: SceneToken[] };
    expect(placed.token.label).toBe('Guard');
    expect(placed.relabelled).toEqual([]);
    expect(await tv.settle()).toEqual([]);
    expect((await playerSnapshot()).scene!.tokens.map((token) => token.label)).toEqual(['Guard']);
    // The fog lifts: the new one is "Guard 2" and the first becomes "Guard 1", both at once.
    expect(await h.command(dm, 'region.setHidden', { region_id: region.id, hidden: false })).toEqual({ ok: true });
    const dmEvents = await dm.settle();
    const renamed = payloads(dmEvents, 'token.updated') as { token: SceneToken; relabelled: SceneToken[] }[];
    expect(renamed.map((each) => [each.token.label, each.relabelled.map((token) => token.label)])).toContainEqual([
      'Guard 2',
      ['Guard 1'],
    ]);
    const tvEvents = await tv.settle();
    const added = payloads(tvEvents, 'token.added') as { token: PlayerToken; relabelled: PlayerToken[] }[];
    const second = added.find((each) => each.token.label === 'Guard 2')!;
    expect(second.relabelled).toEqual([expect.objectContaining({ id: guard.id, label: 'Guard 1' })]);
    expect((await playerSnapshot()).scene!.tokens.map((token) => token.label).sort()).toEqual([
      'Cultist',
      'Guard 1',
      'Guard 2',
    ]);
  });
});

describe('an asset resized over REST (review)', () => {
  it('numbers a token its new size brings out of the fog, as at any first showing', async () => {
    const live = await liveScene();
    await fogBackRoom(live);
    const troll = await h.asset('Troll', { default_hidden: false, size: 'huge' });
    // One outside the fog, and one whose centre (4.5, 2.5) is under it: players see only the first, bare-named.
    await h.command(live.dm, 'token.add', { scene_id: live.scene.id, asset_id: troll.id, x: 0, y: 6 });
    await h.command(live.dm, 'token.add', { scene_id: live.scene.id, asset_id: troll.id, x: 3, y: 1 });
    await live.dm.settle();
    await live.tv.settle();
    const labels = async () => (await playerSnapshot()).scene!.tokens.map((token) => token.label).sort();
    expect(await labels()).toEqual(['Guard', 'Troll']);
    // Medium, the second's centre is (3.5, 1.5), out of the fog: both are numbered for players at once.
    ok(await h.inject({ method: 'PATCH', url: `/api/assets/${troll.id}`, payload: { size: 'medium' } }));
    expect(await labels()).toEqual(['Guard', 'Troll 1', 'Troll 2']);
    const shown = h.data.db
      .prepare('SELECT count(*) FROM token WHERE asset_id = ? AND shown = 1')
      .pluck()
      .get(troll.id);
    expect(shown).toBe(2);
  });
});

describe('undo and redo of the region commands (specs/04-live-sync.md §8)', () => {
  it('undoes the drawing, the reveal, the rename and the deletion, and redoes each', async () => {
    const live = await liveScene();
    const { dm, tv } = live;
    const region = await fogBackRoom(live);
    const undo = async () => {
      expect(await h.command(dm, 'undo', {})).toEqual({ ok: true });
      return [await dm.settle(), await tv.settle()] as const;
    };
    const redo = async () => {
      expect(await h.command(dm, 'redo', {})).toEqual({ ok: true });
      return [await dm.settle(), await tv.settle()] as const;
    };
    // The drawing undone: the fog goes, the token comes back; redone: the same region again.
    let [dmEvents, tvEvents] = await undo();
    expect(types(dmEvents)).toContain('region.removed');
    expect(types(tvEvents)).toEqual(['fog.updated', 'token.added']);
    [dmEvents, tvEvents] = await redo();
    expect(regionOf(dmEvents)).toEqual(region);
    expect(types(tvEvents)).toEqual(['fog.updated', 'token.removed']);

    // A reveal undone fogs it again.
    await h.command(dm, 'region.setHidden', { region_id: region.id, hidden: false });
    await dm.settle();
    await tv.settle();
    [, tvEvents] = await undo();
    expect(types(tvEvents)).toEqual(['fog.updated', 'token.removed']);

    // A rename undone takes the old name back.
    await h.command(dm, 'region.rename', { region_id: region.id, name: 'Study' });
    await dm.settle();
    [dmEvents] = await undo();
    expect((payloads(dmEvents, 'region.updated')[0] as { region: Region }).region.name).toBe('Back room');

    // A deletion undone puts the same region back, in its place.
    await h.command(dm, 'region.delete', { region_id: region.id });
    await dm.settle();
    await tv.settle();
    [dmEvents, tvEvents] = await undo();
    expect(regionOf(dmEvents)).toEqual(region);
    expect(types(tvEvents)).toEqual(['fog.updated', 'token.removed']);
    const laptop = await h.connect({ cookie: h.cookie });
    expect((laptop.first.payload as DmSnapshot).scene!.regions).toEqual([region]);
  });
});

describe('preparation over REST (specs/02-architecture.md §5)', () => {
  it('draws, renames, reveals and deletes a region of a scene that is not live; refuses them on the live scene', async () => {
    const live = await liveScene();
    const url = `/api/scenes/${live.other.id}/regions`;
    const region = ok<Region>(await h.post(url, { name: 'Shed', shape: BACK_ROOM }), 201);
    expect(region).toMatchObject({ name: 'Shed', hidden: true, order: 1 });
    const second = ok<Region>(await h.post(url, { name: 'Pond', shape: BACK_ROOM, hidden: false }), 201);
    expect(second.order).toBe(2);
    expect(ok<Region[]>(await h.inject({ method: 'GET', url }))).toEqual([region, second]);
    expect(
      ok<Region>(await h.inject({ method: 'PATCH', url: `/api/regions/${region.id}`, payload: { hidden: false } })),
    ).toMatchObject({ hidden: false });
    ok(await h.inject({ method: 'DELETE', url: `/api/regions/${second.id}` }), 204);
    expect(ok<Region[]>(await h.inject({ method: 'GET', url })).map((each) => each.id)).toEqual([region.id]);
    // Nothing of it reached a player view.
    expect(await live.tv.settle()).toEqual([]);

    const liveUrl = `/api/scenes/${live.scene.id}/regions`;
    const onLive = await fogBackRoom(live);
    expect((await h.post(liveUrl, { name: 'X', shape: BACK_ROOM })).statusCode).toBe(409);
    expect(
      (await h.inject({ method: 'PATCH', url: `/api/regions/${onLive.id}`, payload: { hidden: false } })).statusCode,
    ).toBe(409);
    expect((await h.inject({ method: 'DELETE', url: `/api/regions/${onLive.id}` })).statusCode).toBe(409);
    expect(await live.tv.settle()).toEqual([]);
    // Unknown scene and region, and a body out of the contract.
    expect(
      (await h.post('/api/scenes/00000000-0000-4000-8000-00000000ffff/regions', { name: 'X', shape: BACK_ROOM }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await h.inject({
          method: 'PATCH',
          url: '/api/regions/00000000-0000-4000-8000-00000000ffff',
          payload: { hidden: false },
        })
      ).statusCode,
    ).toBe(404);
    expect((await h.post(url, { name: '   ', shape: BACK_ROOM })).statusCode).toBe(400);
    expect((await h.inject({ method: 'PATCH', url: `/api/regions/${region.id}`, payload: {} })).statusCode).toBe(400);
  });

  it('copies a scene’s regions with it, and deletes them with it', async () => {
    const live = await liveScene();
    const url = `/api/scenes/${live.other.id}/regions`;
    const region = ok<Region>(await h.post(url, { name: 'Shed', shape: BACK_ROOM }), 201);
    const copy = ok<Scene>(await h.post(`/api/scenes/${live.other.id}/duplicate`, { name: 'The garden again' }), 201);
    const copied = ok<Region[]>(await h.inject({ method: 'GET', url: `/api/scenes/${copy.id}/regions` }));
    expect(copied.map(({ name, shape, hidden, order }) => ({ name, shape, hidden, order }))).toEqual([
      { name: 'Shed', shape: BACK_ROOM, hidden: true, order: 1 },
    ]);
    expect(copied[0]!.id).not.toBe(region.id);
    const summary = ok<object>(await h.inject({ method: 'GET', url: `/api/scenes/${copy.id}/deletion` }));
    ok(await h.inject({ method: 'DELETE', url: `/api/scenes/${copy.id}`, payload: { confirm: summary } }), 204);
    expect(h.data.db.prepare('SELECT count(*) FROM region WHERE scene_id = ?').pluck().get(copy.id)).toBe(0);
    expect(h.data.db.prepare('SELECT count(*) FROM region').pluck().get()).toBe(1);
  });

  it('counts the tokens under the fog as hidden in the scene list', async () => {
    const live = await liveScene();
    await fogBackRoom(live);
    const sessionId = live.scene.session_id;
    const summaries = ok<{ id: string; tokens: number; hidden: number }[]>(
      await h.inject({ method: 'GET', url: `/api/sessions/${sessionId}/scenes/summary` }),
    );
    expect(summaries.find((each) => each.id === live.scene.id)).toEqual({ id: live.scene.id, tokens: 3, hidden: 2 });
  });
});
