import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DmSnapshot, ErrorEnvelope, PlayerSnapshot, Scene, SceneToken } from '@emberglass/shared';
import { startLive, type Client, type LiveHarness } from './testing/harness.js';

// TBL-02 over a real port and real Socket.io clients, against a real SQLite file (specs/03-domain-model.md
// §1, specs/04-live-sync.md §2, §3, §4, §8, Q-099): `token.setMarkers` sets the whole set of condition
// markers a token of the live scene carries, stored in a fixed order; both rooms hear of a visible token's,
// the DM's alone of a hidden one's; undo puts back the set before and redo the set after; a token revealed
// reaches players with its markers, and every snapshot carries them.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let h: LiveHarness;

afterEach(async () => {
  await h.close();
});

interface Live {
  scene: Scene;
  other: Scene;
  goblin: SceneToken;
  lurker: SceneToken;
  dm: Client;
  tv: Client;
}

async function liveScene(): Promise<Live> {
  h = await startLive();
  const scene = await h.scene('The long hall', (await h.image('markers map', 96)).id);
  const other = await h.scene('The vault', (await h.image('markers map B', 80)).id);
  const goblin = await h.place(scene.id, (await h.asset('Goblin', { default_hidden: false })).id, 1, 1);
  const lurker = await h.place(scene.id, (await h.asset('Lurker', { default_hidden: true })).id, 4, 4);
  const dm = await h.connect({ cookie: h.cookie });
  const tv = await h.connect();
  expect(await h.command(dm, 'scene.activate', { scene_id: scene.id })).toEqual({ ok: true });
  await dm.settle();
  await tv.settle();
  return { scene, other, goblin, lurker, dm, tv };
}

const mark = (client: Client, token: SceneToken, markers: string[]) =>
  h.command(client, 'token.setMarkers', { token_id: token.id, markers });
const code = (ack: unknown) => (ack as ErrorEnvelope).error.code;
const types = (events: { type: string }[]) => events.map((event) => event.type);
const markersOf = (event: { payload: unknown }) => (event.payload as { token: { markers: string[] } }).token.markers;
const stored = (id: string) => h.data.db.prepare('SELECT markers FROM token WHERE id = ?').pluck().get(id);

describe('token.setMarkers (specs/04-live-sync.md §2, §3, §4)', () => {
  it('sets a visible token’s markers for both rooms, stored and sent in the fixed order', async () => {
    const { goblin, dm, tv } = await liveScene();
    const versions = [h.versions.dm.current(), h.versions.players.current()];
    expect(await mark(dm, goblin, ['concentrating', 'bloodied'])).toEqual({ ok: true });
    const [dmEvents, tvEvents] = [await dm.settle(), await tv.settle()];
    // The DM's room also hears that undo now has something to take back (UIX-01).
    expect(dmEvents.map((event) => [event.type, event.version])).toEqual([
      ['token.updated', versions[0]! + 1],
      ['history.changed', versions[0]! + 2],
    ]);
    expect(tvEvents.map((event) => [event.type, event.version])).toEqual([['token.updated', versions[1]! + 1]]);
    expect(markersOf(dmEvents[0]!)).toEqual(['bloodied', 'concentrating']);
    expect(markersOf(tvEvents[0]!)).toEqual(['bloodied', 'concentrating']);
    expect(stored(goblin.id)).toBe('["bloodied","concentrating"]');
    // The same set again changes nothing and tells nobody.
    expect(await mark(dm, goblin, ['bloodied', 'concentrating'])).toEqual({ ok: true });
    expect(await dm.settle()).toEqual([]);
    expect(await tv.settle()).toEqual([]);
    // An empty set takes them all off.
    expect(await mark(dm, goblin, [])).toEqual({ ok: true });
    expect(markersOf((await tv.settle())[0]!)).toEqual([]);
  });

  it('tells players nothing of a hidden token’s markers, and reveals it with them', async () => {
    const { lurker, dm, tv } = await liveScene();
    const players = h.versions.players.current();
    expect(await mark(dm, lurker, ['dead'])).toEqual({ ok: true });
    expect(markersOf((await dm.settle())[0]!)).toEqual(['dead']);
    expect(await tv.settle()).toEqual([]);
    expect(h.versions.players.current()).toBe(players);
    expect(await h.command(dm, 'token.setVisibility', { token_id: lurker.id, hidden: false })).toEqual({ ok: true });
    const revealed = await tv.settle();
    expect(types(revealed)).toEqual(['token.added']);
    expect(markersOf(revealed[0]!)).toEqual(['dead']);
  });

  it('refuses a token that is not on the live scene, an unknown one, and markers it cannot carry', async () => {
    const { other, goblin, dm, tv } = await liveScene();
    const elsewhere = await h.place(other.id, (await h.asset('Kobold')).id, 0, 0);
    expect(code(await mark(dm, elsewhere, ['bloodied']))).toBe('scene_not_live');
    expect(code(await mark(dm, { ...goblin, id: '00000000-0000-4000-8000-00000000ffff' }, []))).toBe('not_found');
    for (const markers of [
      ['poisoned'],
      ['dead', 'dead'],
      ['bloodied', 'dead', 'unconscious', 'concentrating', 'dead'],
    ]) {
      expect(code(await mark(dm, goblin, markers)), JSON.stringify(markers)).toBe('validation_failed');
    }
    expect(code(await mark(tv, goblin, ['dead']))).toBe('forbidden');
    expect(await dm.settle()).toEqual([]);
    expect(await tv.settle()).toEqual([]);
    expect(stored(goblin.id)).toBe('[]');
  });

  it('is undone to the set before and redone to the set after, each reaching players as a change', async () => {
    const { goblin, dm, tv } = await liveScene();
    await mark(dm, goblin, ['bloodied']);
    await mark(dm, goblin, ['bloodied', 'unconscious']);
    await dm.settle();
    await tv.settle();
    expect(await h.command(dm, 'undo', {})).toEqual({ ok: true });
    let events = await tv.settle();
    expect(types(events)).toEqual(['token.updated']);
    expect(markersOf(events[0]!)).toEqual(['bloodied']);
    expect(await h.command(dm, 'undo', {})).toEqual({ ok: true });
    expect(markersOf((await tv.settle())[0]!)).toEqual([]);
    expect(await h.command(dm, 'redo', {})).toEqual({ ok: true });
    events = await tv.settle();
    expect(markersOf(events[0]!)).toEqual(['bloodied']);
    expect(stored(goblin.id)).toBe('["bloodied"]');
    // A new marker change empties the redo stack.
    await mark(dm, goblin, ['concentrating']);
    await tv.settle();
    expect(await h.command(dm, 'redo', {})).toEqual({ ok: true });
    expect(await tv.settle()).toEqual([]);
  });

  it('puts a deleted token back with its markers on undo', async () => {
    const { goblin, dm, tv } = await liveScene();
    await mark(dm, goblin, ['unconscious']);
    await h.command(dm, 'token.delete', { token_id: goblin.id });
    await dm.settle();
    await tv.settle();
    expect(await h.command(dm, 'undo', {})).toEqual({ ok: true });
    const events = await tv.settle();
    expect(types(events)).toEqual(['token.added']);
    expect(markersOf(events[0]!)).toEqual(['unconscious']);
  });

  it('gives every snapshot the markers, a hidden token’s to the DM only', async () => {
    const { goblin, lurker, dm } = await liveScene();
    await mark(dm, goblin, ['bloodied']);
    await mark(dm, lurker, ['concentrating']);
    const tv = await h.connect();
    const tokens = (tv.first.payload as PlayerSnapshot).scene!.tokens;
    expect(tokens.map((token) => [token.id, token.markers])).toEqual([[goblin.id, ['bloodied']]]);
    const laptop = await h.connect({ cookie: h.cookie });
    const dmTokens = (laptop.first.payload as DmSnapshot).scene!.tokens;
    expect(Object.fromEntries(dmTokens.map((token) => [token.id, token.markers]))).toEqual({
      [goblin.id]: ['bloodied'],
      [lurker.id]: ['concentrating'],
    });
  });
});
