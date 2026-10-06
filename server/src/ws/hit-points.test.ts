import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ErrorEnvelope, LibraryAsset, SceneToken, TokenChange, TokenMarker } from '@emberglass/shared';
import { ok, startLive, type Client, type LiveHarness } from './testing/harness.js';

// DMT-01 over a real port and real Socket.io clients, against a real SQLite file (specs/03-domain-model.md §9,
// specs/04-live-sync.md §2, §3, §4, §8, §15, Q-112, Q-116, D-180, D-181, D-182): an asset's defaults copied to
// its new tokens; `token.setStats` and `token.applyHp` on the live scene, each one undoable step with the markers
// the hit points set; the DM's room alone hears hit points and armour class, and players hear only the markers
// they set on a token they can see; preparation over REST runs the same rule.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let h: LiveHarness;

afterEach(async () => {
  await h.close();
});

interface Live {
  ogre: SceneToken;
  hero: SceneToken;
  crate: SceneToken;
  lurker: SceneToken;
  ogreAsset: LibraryAsset;
  dm: Client;
  tv: Client;
}

async function liveScene(): Promise<Live> {
  h = await startLive();
  const scene = await h.scene('The bridge', (await h.image('hp map', 96)).id);
  const ogreAsset = await h.asset('Ogre', { category: 'monster', default_hidden: false, hp_max: 27, ac: 11 });
  const ogre = await h.place(scene.id, ogreAsset.id, 1, 1);
  const hero = await h.place(scene.id, (await h.asset('Hero', { category: 'pc', hp_max: 20, ac: 16 })).id, 3, 1);
  const crate = await h.place(scene.id, (await h.asset('Crate', { category: 'object', hp_max: 4 })).id, 5, 1);
  const lurker = await h.place(
    scene.id,
    (await h.asset('Lurker', { category: 'monster', default_hidden: true, hp_max: 10, ac: 14 })).id,
    6,
    6,
  );
  const dm = await h.connect({ cookie: h.cookie });
  const tv = await h.connect();
  expect(await h.command(dm, 'scene.activate', { scene_id: scene.id })).toEqual({ ok: true });
  await dm.settle();
  await tv.settle();
  return { ogre, hero, crate, lurker, ogreAsset, dm, tv };
}

const STAT_KEYS = ['hp_current', 'hp_max', 'hp_temp', 'ac'];
const code = (ack: unknown) => (ack as ErrorEnvelope).error.code;
const types = (events: { type: string }[]) => events.map((event) => event.type);
const tokenOf = (event: { payload: unknown }) => (event.payload as { token: SceneToken }).token;
const ids = (markers: readonly TokenMarker[]) => markers.map((marker) => marker.id);
const stored = (id: string) =>
  h.data.db.prepare('SELECT hp_current, hp_max, hp_temp, ac, markers FROM token WHERE id = ?').get(id) as {
    hp_current: number | null;
    hp_max: number | null;
    hp_temp: number | null;
    ac: number | null;
    markers: string;
  };
const storedMarkers = (id: string) => ids(JSON.parse(stored(id).markers) as TokenMarker[]);
const setStats = (client: Client, token: SceneToken, fields: Record<string, unknown>) =>
  h.command(client, 'token.setStats', { token_id: token.id, ...fields });
const applyHp = (client: Client, token: SceneToken, delta: number) =>
  h.command(client, 'token.applyHp', { token_id: token.id, delta });

/** Every key anywhere in a message, nested ones included. */
function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((each) => keysOf(each, out));
  else if (value !== null && typeof value === 'object') {
    for (const [key, each] of Object.entries(value)) {
      out.add(key);
      keysOf(each, out);
    }
  }
  return out;
}

describe('asset defaults (specs/03-domain-model.md §9, D-181)', () => {
  it('copies the asset’s maximum and armour class to a new token at full hit points, and later edits change no token', async () => {
    const { ogre, ogreAsset } = await liveScene();
    expect(ogre).toMatchObject({ hp_current: 27, hp_max: 27, hp_temp: null, ac: 11 });
    ok(await h.inject({ method: 'PATCH', url: `/api/assets/${ogreAsset.id}`, payload: { hp_max: 40, ac: null } }));
    expect(stored(ogre.id)).toMatchObject({ hp_current: 27, hp_max: 27, ac: 11 });
    const asset = ok<LibraryAsset>(await h.inject({ method: 'GET', url: `/api/assets/${ogreAsset.id}` }));
    expect(asset).toMatchObject({ hp_max: 40, ac: null });
  });
});

describe('token.setStats and token.applyHp (specs/04-live-sync.md §2, §15)', () => {
  it('tells only the DM’s room of a change of hit points or armour class alone', async () => {
    const { ogre, dm, tv } = await liveScene();
    const players = h.versions.players.current();
    expect(await setStats(dm, ogre, { ac: 13, hp_temp: 5 })).toEqual({ ok: true });
    const dmEvents = await dm.settle();
    expect(types(dmEvents)).toEqual(['token.updated', 'history.changed']);
    expect(tokenOf(dmEvents[0]!)).toMatchObject({ ac: 13, hp_temp: 5, hp_current: 27 });
    expect(await applyHp(dm, ogre, -3)).toEqual({ ok: true });
    await dm.settle();
    expect(stored(ogre.id)).toMatchObject({ hp_temp: 2, hp_current: 27 });
    expect(await tv.settle()).toEqual([]);
    expect(h.versions.players.current()).toBe(players);
    // The same values again change nothing and tell nobody.
    expect(await setStats(dm, ogre, { ac: 13 })).toEqual({ ok: true });
    expect(await dm.settle()).toEqual([]);
  });

  it('takes damage from temporary hit points first, stops at 0 and heals up to the maximum', async () => {
    const { ogre, dm } = await liveScene();
    await setStats(dm, ogre, { hp_temp: 4 });
    await applyHp(dm, ogre, -10);
    expect(stored(ogre.id)).toMatchObject({ hp_temp: null, hp_current: 21 });
    await applyHp(dm, ogre, -100);
    expect(stored(ogre.id)).toMatchObject({ hp_current: 0 });
    await applyHp(dm, ogre, 100);
    expect(stored(ogre.id)).toMatchObject({ hp_current: 27, hp_temp: null });
  });

  it('sets Bloodied at half rounded down and Dead at 0 on a monster, reaching players as its markers only', async () => {
    const { ogre, dm, tv } = await liveScene();
    // 27 → Bloodied at 13 or less.
    expect(await setStats(dm, ogre, { hp_current: 14 })).toEqual({ ok: true });
    expect(storedMarkers(ogre.id)).toEqual([]);
    expect(await tv.settle()).toEqual([]);
    expect(await applyHp(dm, ogre, -1)).toEqual({ ok: true });
    expect(storedMarkers(ogre.id)).toEqual(['bloodied']);
    const bloodied = await tv.settle();
    expect(types(bloodied)).toEqual(['token.updated']);
    expect(ids(tokenOf(bloodied[0]!).markers)).toEqual(['bloodied']);
    expect(await applyHp(dm, ogre, -50)).toEqual({ ok: true });
    expect(storedMarkers(ogre.id)).toEqual(['bloodied', 'dead']);
    // Healing from 0 removes neither Dead nor, while at half or less, Bloodied (Q-116); above half, Bloodied goes.
    await applyHp(dm, ogre, 5);
    expect(storedMarkers(ogre.id)).toEqual(['bloodied', 'dead']);
    await applyHp(dm, ogre, 20);
    expect(storedMarkers(ogre.id)).toEqual(['dead']);
    // The DM's room carries the fields; players' never.
    const [tvEvents, dmEvents] = [await tv.settle(), await dm.settle()];
    expect(tvEvents.length).toBeGreaterThan(0);
    for (const event of tvEvents) expect(STAT_KEYS.some((key) => keysOf(event.payload).has(key))).toBe(false);
    for (const event of dmEvents.filter((each) => each.type === 'token.updated')) {
      expect(STAT_KEYS.every((key) => keysOf(event.payload).has(key))).toBe(true);
    }
  });

  it('makes a player character Unconscious at 0, an object neither, and a lowered maximum carries Bloodied', async () => {
    const { hero, crate, dm } = await liveScene();
    await applyHp(dm, hero, -20);
    expect(storedMarkers(hero.id)).toEqual(['bloodied', 'unconscious']);
    await applyHp(dm, hero, 15);
    expect(storedMarkers(hero.id)).toEqual(['unconscious']);
    await applyHp(dm, crate, -4);
    expect(storedMarkers(crate.id)).toEqual(['bloodied']);
    // A maximum set below the current hit points brings them down with it (D-182).
    await setStats(dm, hero, { hp_max: 10 });
    expect(stored(hero.id)).toMatchObject({ hp_current: 10, hp_max: 10 });
  });

  it('keeps a marker the DM toggled until the next change of hit points applies the rule again', async () => {
    const { ogre, dm } = await liveScene();
    await applyHp(dm, ogre, -20);
    expect(storedMarkers(ogre.id)).toEqual(['bloodied']);
    await h.command(dm, 'token.setMarkers', { token_id: ogre.id, markers: [] });
    expect(storedMarkers(ogre.id)).toEqual([]);
    // Armour class alone is no change of hit points.
    await setStats(dm, ogre, { ac: 18 });
    expect(storedMarkers(ogre.id)).toEqual([]);
    await applyHp(dm, ogre, -1);
    expect(storedMarkers(ogre.id)).toEqual(['bloodied']);
  });

  it('only stores values on a token without a maximum', async () => {
    const { ogre, dm } = await liveScene();
    await setStats(dm, ogre, { hp_max: null });
    await setStats(dm, ogre, { hp_current: 0 });
    expect(stored(ogre.id)).toMatchObject({ hp_current: 0, hp_max: null });
    expect(storedMarkers(ogre.id)).toEqual([]);
    await applyHp(dm, ogre, 30);
    expect(stored(ogre.id)).toMatchObject({ hp_current: 30 });
    expect(storedMarkers(ogre.id)).toEqual([]);
  });

  it('undoes the hit points and the markers they set in one step, and redoes them', async () => {
    const { ogre, dm, tv } = await liveScene();
    await applyHp(dm, ogre, -30);
    expect(storedMarkers(ogre.id)).toEqual(['bloodied', 'dead']);
    await dm.settle();
    await tv.settle();
    expect(await h.command(dm, 'undo', {})).toEqual({ ok: true });
    expect(stored(ogre.id)).toMatchObject({ hp_current: 27 });
    expect(storedMarkers(ogre.id)).toEqual([]);
    expect(ids(tokenOf((await tv.settle())[0]!).markers)).toEqual([]);
    expect(await h.command(dm, 'redo', {})).toEqual({ ok: true });
    expect(stored(ogre.id)).toMatchObject({ hp_current: 0 });
    expect(storedMarkers(ogre.id)).toEqual(['bloodied', 'dead']);
    // A change of armour class alone undoes too, and tells players nothing.
    await tv.settle();
    await setStats(dm, ogre, { ac: 20 });
    await h.command(dm, 'undo', {});
    expect(stored(ogre.id)).toMatchObject({ ac: 11 });
    expect(await tv.settle()).toEqual([]);
  });

  it('tells players nothing of a hidden token’s hit points or the markers they set', async () => {
    const { lurker, dm, tv } = await liveScene();
    const players = h.versions.players.current();
    await applyHp(dm, lurker, -10);
    expect(storedMarkers(lurker.id)).toEqual(['bloodied', 'dead']);
    expect(await tv.settle()).toEqual([]);
    expect(h.versions.players.current()).toBe(players);
    await h.command(dm, 'token.setVisibility', { token_id: lurker.id, hidden: false });
    const revealed = await tv.settle();
    expect(types(revealed)).toEqual(['token.added']);
    expect(STAT_KEYS.some((key) => keysOf(revealed[0]!.payload).has(key))).toBe(false);
  });

  it('refuses a token without hit points to change, one not on the live scene, bad values and the players room', async () => {
    const { ogre, dm, tv } = await liveScene();
    await setStats(dm, ogre, { hp_current: null });
    expect(code(await applyHp(dm, ogre, -1))).toBe('bad_request');
    const other = await h.scene('Elsewhere');
    const kobold = await h.place(other.id, (await h.asset('Kobold')).id, 0, 0);
    expect(code(await setStats(dm, kobold, { ac: 12 }))).toBe('scene_not_live');
    expect(code(await applyHp(dm, kobold, -1))).toBe('scene_not_live');
    for (const fields of [{}, { hp_max: 0 }, { hp_current: -1 }, { ac: 100 }, { hp_temp: 1.5 }, { hp: 3 }]) {
      expect(code(await setStats(dm, ogre, fields)), JSON.stringify(fields)).toBe('validation_failed');
    }
    expect(code(await applyHp(dm, ogre, 10_000))).toBe('validation_failed');
    expect(code(await applyHp(tv, ogre, -1))).toBe('forbidden');
  });
});

describe('players never receive hit points or armour class (specs/04-live-sync.md §4)', () => {
  it('leaves them out of the players’ snapshot and keeps them in the DM’s', async () => {
    await liveScene();
    const [players, dms] = [(await h.connect()).first, (await h.connect({ cookie: h.cookie })).first];
    expect(STAT_KEYS.some((key) => keysOf(players.payload).has(key))).toBe(false);
    expect(STAT_KEYS.every((key) => keysOf(dms.payload).has(key))).toBe(true);
  });
});

describe('preparation over REST (specs/02-architecture.md §5, specs/04-live-sync.md §15)', () => {
  it('sets hit points and armour class on a scene that is not live, with the same markers', async () => {
    h = await startLive();
    const scene = await h.scene('Prep');
    const ogre = await h.place(scene.id, (await h.asset('Ogre', { category: 'monster', hp_max: 27 })).id, 0, 0);
    const patch = async (payload: Record<string, unknown>) =>
      ok<TokenChange>(await h.inject({ method: 'PATCH', url: `/api/tokens/${ogre.id}`, payload }));
    const first = await patch({ hp_current: 0, ac: 12 });
    expect(first.token).toMatchObject({ hp_current: 0, ac: 12 });
    expect(ids(first.token.markers)).toEqual(['bloodied', 'dead']);
    // Markers given in the same body are the DM's: no rule overrides them.
    const second = await patch({ hp_current: 20, markers: [] });
    expect(second.token.markers).toEqual([]);
    expect(
      (await h.inject({ method: 'PATCH', url: `/api/tokens/${ogre.id}`, payload: { hp_max: 0 } })).statusCode,
    ).toBe(400);
  });
});
