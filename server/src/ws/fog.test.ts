import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DmSnapshot,
  ErrorEnvelope,
  EventEnvelope,
  FogMask,
  FogStroke,
  PlayerSnapshot,
  PlayerToken,
  Scene,
  SceneToken,
} from '@emberglass/shared';
import { ok, startLive, type Client, type LiveHarness } from './testing/harness.js';

// TBL-04 over a real port and real Socket.io clients, against a real SQLite file (specs/04-live-sync.md
// §2, §3, §4, §8, §13, specs/07-security-and-access.md §5, Q-101): a token under painted fog is to players
// as a hidden one is. Both rooms receive the mask, which names no token; painting over a token removes it
// for players and erasing adds it back, each at its rank; a token moved across the edge comes and goes; its
// image file follows; numbering waits for players to see a token; each stroke is undone and redone; a player
// view cannot paint.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let h: LiveHarness;

afterEach(async () => {
  await h.close();
});

// The back room: a stroke from (5, 2) to (7, 2), a square and a half wide each way, covering the
// cultist's centre (5.5, 1.5) and the lurker's (6.5, 2.5), not the guard's (1.5, 1.5).
const BACK_ROOM: FogStroke = {
  mode: 'paint',
  radius: 1.5,
  points: [
    { x: 5, y: 2 },
    { x: 7, y: 2 },
  ],
};
const ERASE_ROOM: FogStroke = { ...BACK_ROOM, mode: 'erase', radius: 2 };

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
const fogOf = (events: EventEnvelope[]) => (payloads(events, 'fog.updated')[0] as { fog: FogMask }).fog;
const playerSnapshot = async () => (await h.connect()).first.payload as PlayerSnapshot;
const drawn = async () => (await playerSnapshot()).scene!.tokens.map((token) => token.id);
const imageStatus = async (token: SceneToken) =>
  (await h.app.inject({ method: 'GET', url: `/images/${token.asset.image_id}/display` })).statusCode;

async function paint(live: Live, stroke: FogStroke = BACK_ROOM): Promise<FogMask> {
  expect(await h.command(live.dm, 'fog.paint', { scene_id: live.scene.id, stroke })).toEqual({ ok: true });
  const fog = fogOf(await live.dm.settle());
  await live.tv.settle();
  return fog;
}

describe('painting and erasing the fog (specs/04-live-sync.md §2, §3, §13)', () => {
  it('paints: both rooms hear the mask, players also of the token it covers, and nothing of a hidden one', async () => {
    const live = await liveScene();
    const { dm, tv, cultist, scene } = live;
    expect(await imageStatus(cultist)).toBe(200);
    expect(await h.command(dm, 'fog.paint', { scene_id: scene.id, stroke: BACK_ROOM })).toEqual({ ok: true });
    const dmEvents = await dm.settle();
    expect(types(dmEvents)).toEqual(['fog.updated', 'history.changed']);
    const fog = fogOf(dmEvents);
    expect(fog.length).toBeGreaterThan(0);
    const tvEvents = await tv.settle();
    expect(types(tvEvents)).toEqual(['fog.updated', 'token.removed']);
    expect(tvEvents[0]!.payload).toEqual({ fog });
    expect(tvEvents[1]!.payload).toEqual({ id: cultist.id });
    // Nothing of the hidden lurker reaches players.
    expect(JSON.stringify(tvEvents)).not.toContain(live.lurker.id);
    // The snapshots agree, and the covered token's image is refused from now on.
    const snapshot = await playerSnapshot();
    expect(snapshot.scene!.fog).toEqual(fog);
    expect(snapshot.scene!.tokens.map((token) => token.id)).toEqual([live.guard.id]);
    expect(await imageStatus(cultist)).toBe(404);
    const laptop = await h.connect({ cookie: h.cookie });
    expect((laptop.first.payload as DmSnapshot).scene!.fog).toEqual(fog);
  });

  it('erases: players see the visible token under it come back at its rank, never the hidden one', async () => {
    const live = await liveScene();
    await paint(live);
    expect(await h.command(live.dm, 'fog.paint', { scene_id: live.scene.id, stroke: ERASE_ROOM })).toEqual({
      ok: true,
    });
    expect(types(await live.dm.settle())).toEqual(['fog.updated']);
    const tvEvents = await live.tv.settle();
    expect(types(tvEvents)).toEqual(['fog.updated', 'token.added']);
    expect(tvEvents[0]!.payload).toEqual({ fog: [] });
    const added = (tvEvents[1]!.payload as { token: PlayerToken }).token;
    expect(added).toMatchObject({ id: live.cultist.id, z_order: 1 });
    expect(JSON.stringify(tvEvents)).not.toContain(live.lurker.id);
    expect(await drawn()).toEqual([live.guard.id, live.cultist.id]);
    expect(await imageStatus(live.cultist)).toBe(200);
    expect(await imageStatus(live.lurker)).toBe(404);
  });

  it('tells nobody of a stroke that changes nothing, and keeps no undo step for it', async () => {
    const live = await liveScene();
    await paint(live);
    expect(await h.command(live.dm, 'fog.paint', { scene_id: live.scene.id, stroke: BACK_ROOM })).toEqual({
      ok: true,
    });
    expect(await live.dm.settle()).toEqual([]);
    expect(await live.tv.settle()).toEqual([]);
    // Erasing where there is no fog changes nothing either.
    const far: FogStroke = { mode: 'erase', radius: 1, points: [{ x: 20, y: 15 }] };
    expect(await h.command(live.dm, 'fog.paint', { scene_id: live.scene.id, stroke: far })).toEqual({ ok: true });
    expect(await live.dm.settle()).toEqual([]);
    // So one undo takes the painting back, and nothing is left to undo.
    expect(await h.command(live.dm, 'undo', {})).toEqual({ ok: true });
    const dmEvents = await live.dm.settle();
    expect(fogOf(dmEvents)).toEqual([]);
    expect(payloads(dmEvents, 'history.changed')).toEqual([{ can_undo: false, can_redo: true }]);
  });

  it('fogs the whole map and clears it', async () => {
    const live = await liveScene();
    expect(await h.command(live.dm, 'fog.fill', { scene_id: live.scene.id, fogged: true })).toEqual({ ok: true });
    await live.dm.settle();
    const tvEvents = await live.tv.settle();
    expect(types(tvEvents)).toEqual(['fog.updated', 'token.removed', 'token.removed']);
    expect(await drawn()).toEqual([]);
    expect(await h.command(live.dm, 'fog.fill', { scene_id: live.scene.id, fogged: false })).toEqual({ ok: true });
    await live.dm.settle();
    expect(types(await live.tv.settle())).toEqual(['fog.updated', 'token.added', 'token.added']);
    expect((await playerSnapshot()).scene!.fog).toEqual([]);
  });

  it('refuses a stroke for a scene that is not live, an unknown scene, a bad stroke and a player view', async () => {
    const live = await liveScene();
    expect(code(await h.command(live.dm, 'fog.paint', { scene_id: live.other.id, stroke: BACK_ROOM }))).toBe(
      'scene_not_live',
    );
    const unknown = '00000000-0000-4000-8000-00000000ffff';
    expect(code(await h.command(live.dm, 'fog.fill', { scene_id: unknown, fogged: true }))).toBe('scene_not_live');
    for (const stroke of [
      { ...BACK_ROOM, radius: 0.3 },
      { ...BACK_ROOM, radius: 6 },
      { ...BACK_ROOM, points: [] },
      { ...BACK_ROOM, mode: 'reveal' },
    ]) {
      expect(code(await h.command(live.dm, 'fog.paint', { scene_id: live.scene.id, stroke }))).toBe(
        'validation_failed',
      );
    }
    expect(code(await h.command(live.tv, 'fog.paint', { scene_id: live.scene.id, stroke: BACK_ROOM }))).toBe(
      'forbidden',
    );
    expect(await live.dm.settle()).toEqual([]);
    expect(await live.tv.settle()).toEqual([]);
  });

  it('refuses at once a stroke that would cost too much, over the socket and over REST (review)', async () => {
    const live = await liveScene();
    // A zigzag the height of the map a thousand times over: small to send, far too much to apply.
    const zigzag: FogStroke = {
      mode: 'paint',
      radius: 0.25,
      points: Array.from({ length: 1000 }, (_, i) => ({ x: (i % 30) + 0.5, y: i % 2 === 0 ? -1000 : 1000 })),
    };
    const started = Date.now();
    expect(code(await h.command(live.dm, 'fog.paint', { scene_id: live.scene.id, stroke: zigzag }))).toBe(
      'payload_too_large',
    );
    expect((await h.post(`/api/scenes/${live.other.id}/fog`, { stroke: zigzag })).statusCode).toBe(413);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(await live.dm.settle()).toEqual([]);
    expect(await live.tv.settle()).toEqual([]);
  });

  it('judges each token by its centre: a stroke past it leaves it seen', async () => {
    const live = await liveScene();
    // A dab at (0, 0), a square in radius: the guard's centre (1.5, 1.5) is 2.1 away.
    await paint(live, { mode: 'paint', radius: 1, points: [{ x: 0, y: 0 }] });
    expect(await drawn()).toEqual([live.guard.id, live.cultist.id]);
  });
});

describe('tokens and the fog', () => {
  it('sends a move into the fog as token.removed and out of it as token.added, the image following', async () => {
    const live = await liveScene();
    await paint(live);
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

  it('keeps a revealed token under the fog from players, and a token placed there, until it is erased', async () => {
    const live = await liveScene();
    await paint(live);
    const { dm, tv, lurker, scene } = live;
    expect(await h.command(dm, 'token.setVisibility', { token_id: lurker.id, hidden: false })).toEqual({ ok: true });
    expect(await tv.settle()).toEqual([]);
    const imp = await h.asset('Imp', { default_hidden: false });
    expect(await h.command(dm, 'token.add', { scene_id: scene.id, asset_id: imp.id, x: 6, y: 2 })).toEqual({
      ok: true,
    });
    expect(await tv.settle()).toEqual([]);
    expect(await drawn()).toEqual([live.guard.id]);
    expect(await h.command(dm, 'fog.paint', { scene_id: scene.id, stroke: ERASE_ROOM })).toEqual({ ok: true });
    const events = await tv.settle();
    expect(types(events)).toEqual(['fog.updated', 'token.added', 'token.added', 'token.added']);
    // Each arrives at its rank, bottom of the stack first, so they insert as a snapshot would draw them.
    expect(events.slice(1).map((event) => (event.payload as { token: PlayerToken }).token.z_order)).toEqual([1, 2, 3]);
    expect((await drawn()).length).toBe(4);
  });

  it('numbers a token placed visible under the fog when players first see it, renaming its sibling only then', async () => {
    const live = await liveScene();
    await paint(live);
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
    // The fog is erased: the new one is "Guard 2" and the first becomes "Guard 1", both at once.
    expect(await h.command(dm, 'fog.paint', { scene_id: scene.id, stroke: ERASE_ROOM })).toEqual({ ok: true });
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
    await paint(live);
    const troll = await h.asset('Troll', { default_hidden: false, size: 'huge' });
    // One outside the fog, and one whose centre (4, 2.5) is under it: players see only the first, bare-named.
    await h.command(live.dm, 'token.add', { scene_id: live.scene.id, asset_id: troll.id, x: 0, y: 6 });
    await h.command(live.dm, 'token.add', { scene_id: live.scene.id, asset_id: troll.id, x: 2.5, y: 1 });
    await live.dm.settle();
    await live.tv.settle();
    const labels = async () => (await playerSnapshot()).scene!.tokens.map((token) => token.label).sort();
    expect(await labels()).toEqual(['Guard', 'Troll']);
    // Medium, the second's centre is (3, 1.5), out of the fog: both are numbered for players at once.
    ok(await h.inject({ method: 'PATCH', url: `/api/assets/${troll.id}`, payload: { size: 'medium' } }));
    expect(await labels()).toEqual(['Guard', 'Troll 1', 'Troll 2']);
    const shown = h.data.db
      .prepare('SELECT count(*) FROM token WHERE asset_id = ? AND shown = 1')
      .pluck()
      .get(troll.id);
    expect(shown).toBe(2);
  });
});

describe('undo and redo of the fog commands (specs/04-live-sync.md §8)', () => {
  it('undoes a stroke, an erasure and a fill, one step each, and redoes them', async () => {
    const live = await liveScene();
    const { dm, tv } = live;
    const painted = await paint(live);
    const undo = async () => {
      expect(await h.command(dm, 'undo', {})).toEqual({ ok: true });
      return [await dm.settle(), await tv.settle()] as const;
    };
    const redo = async () => {
      expect(await h.command(dm, 'redo', {})).toEqual({ ok: true });
      return [await dm.settle(), await tv.settle()] as const;
    };
    // The stroke undone: the fog goes, the token comes back; redone: the same mask again.
    let [dmEvents, tvEvents] = await undo();
    expect(fogOf(dmEvents)).toEqual([]);
    expect(types(tvEvents)).toEqual(['fog.updated', 'token.added']);
    [dmEvents, tvEvents] = await redo();
    expect(fogOf(dmEvents)).toEqual(painted);
    expect(types(tvEvents)).toEqual(['fog.updated', 'token.removed']);

    // A second stroke undone leaves the first.
    await paint(live, { mode: 'paint', radius: 1, points: [{ x: 15, y: 10 }] });
    [dmEvents] = await undo();
    expect(fogOf(dmEvents)).toEqual(painted);

    // An erasure undone fogs it again.
    await paint(live, ERASE_ROOM);
    [, tvEvents] = await undo();
    expect(types(tvEvents)).toEqual(['fog.updated', 'token.removed']);

    // A fill undone puts the painted mask back.
    expect(await h.command(dm, 'fog.fill', { scene_id: live.scene.id, fogged: true })).toEqual({ ok: true });
    await dm.settle();
    await tv.settle();
    [dmEvents, tvEvents] = await undo();
    expect(fogOf(dmEvents)).toEqual(painted);
    expect(types(tvEvents)).toEqual(['fog.updated', 'token.added']);
    const laptop = await h.connect({ cookie: h.cookie });
    expect((laptop.first.payload as DmSnapshot).scene!.fog).toEqual(painted);
  });
});

describe('preparation over REST (specs/02-architecture.md §5)', () => {
  it('paints, erases, fills and clears the fog of a scene that is not live; refuses it on the live scene', async () => {
    const live = await liveScene();
    const url = `/api/scenes/${live.other.id}/fog`;
    expect(ok<FogMask>(await h.inject({ method: 'GET', url }))).toEqual([]);
    const painted = ok<FogMask>(await h.post(url, { stroke: BACK_ROOM }));
    expect(painted.length).toBeGreaterThan(0);
    expect(ok<FogMask>(await h.inject({ method: 'GET', url }))).toEqual(painted);
    expect(ok<FogMask>(await h.post(url, { stroke: ERASE_ROOM }))).toEqual([]);
    // The garden's map is 80 pixels, 30 columns: the whole image is filled, row by row.
    const filled = ok<FogMask>(await h.post(url, { fill: true }));
    expect(filled[0]).toEqual({ y: 0, runs: [0, 120] });
    expect(ok<FogMask>(await h.post(url, { fill: false }))).toEqual([]);
    // Nothing of it reached a player view.
    expect(await live.tv.settle()).toEqual([]);

    const liveUrl = `/api/scenes/${live.scene.id}/fog`;
    expect((await h.post(liveUrl, { stroke: BACK_ROOM })).statusCode).toBe(409);
    expect((await h.post(liveUrl, { fill: true })).statusCode).toBe(409);
    expect(await live.tv.settle()).toEqual([]);
    // An unknown scene, and a body out of the contract.
    const unknown = '/api/scenes/00000000-0000-4000-8000-00000000ffff/fog';
    expect((await h.post(unknown, { fill: true })).statusCode).toBe(404);
    expect((await h.inject({ method: 'GET', url: unknown })).statusCode).toBe(404);
    expect((await h.post(url, { mask: [] })).statusCode).toBe(400);
    expect((await h.post(url, { stroke: { ...BACK_ROOM, radius: 0 } })).statusCode).toBe(400);
  });

  it('needs a DM session to read or paint the fog', async () => {
    const live = await liveScene();
    const url = `/api/scenes/${live.scene.id}/fog`;
    expect((await h.app.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'POST', url, payload: { fill: true } })).statusCode).toBe(401);
  });

  it('copies a scene’s fog with it', async () => {
    const live = await liveScene();
    const url = `/api/scenes/${live.other.id}/fog`;
    const painted = ok<FogMask>(await h.post(url, { stroke: BACK_ROOM }));
    const copy = ok<Scene>(await h.post(`/api/scenes/${live.other.id}/duplicate`, { name: 'The garden again' }), 201);
    expect(ok<FogMask>(await h.inject({ method: 'GET', url: `/api/scenes/${copy.id}/fog` }))).toEqual(painted);
    // Each copy is its own: erasing one leaves the other.
    ok(await h.post(`/api/scenes/${copy.id}/fog`, { fill: false }));
    expect(ok<FogMask>(await h.inject({ method: 'GET', url }))).toEqual(painted);
  });

  it('counts the tokens under the fog as hidden in the scene list', async () => {
    const live = await liveScene();
    await paint(live);
    const sessionId = live.scene.session_id;
    const summaries = ok<{ id: string; tokens: number; hidden: number }[]>(
      await h.inject({ method: 'GET', url: `/api/sessions/${sessionId}/scenes/summary` }),
    );
    expect(summaries.find((each) => each.id === live.scene.id)).toEqual({ id: live.scene.id, tokens: 3, hidden: 2 });
  });
});
