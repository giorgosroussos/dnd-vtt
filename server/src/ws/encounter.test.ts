import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type DmSnapshot,
  type Encounter,
  type ErrorEnvelope,
  type PlayerEncounter,
  type PlayerSnapshot,
  type Scene,
  type SceneToken,
} from '@emberglass/shared';
import { startLive, type Client, type LiveHarness } from './testing/harness.js';

// TBL-06 and DMT-02 over a real port and real Socket.io clients, against a real SQLite file
// (specs/03-domain-model.md §1, §7, specs/04-live-sync.md §2, §3, §4, §8, §14, Q-111, Q-117, Q-118, D-180):
// the encounter commands on the live scene, what each room hears of them, undo and redo, a token's deletion
// taking its entry, monster entries passed over while Dead or unseen, and what players' snapshots and events
// carry of it.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let h: LiveHarness;

afterEach(async () => {
  await h.close();
});

interface Live {
  scene: Scene;
  other: Scene;
  wren: SceneToken;
  tamsin: SceneToken;
  goblin: SceneToken;
  lurker: SceneToken;
  dm: Client;
  tv: Client;
}

async function liveScene(): Promise<Live> {
  h = await startLive();
  const scene = await h.scene('The long hall', (await h.image('encounter map', 96)).id);
  const other = await h.scene('The vault', (await h.image('encounter map B', 80)).id);
  const tamsin = await h.place(scene.id, (await h.asset('Tamsin', { category: 'pc' })).id, 1, 1);
  const wren = await h.place(scene.id, (await h.asset('Wren', { category: 'pc' })).id, 2, 1);
  const goblin = await h.place(
    scene.id,
    (await h.asset('Goblin', { category: 'monster', default_hidden: false })).id,
    6,
    6,
  );
  const lurker = await h.place(
    scene.id,
    (await h.asset('Lurker', { category: 'monster', default_hidden: true, notes: 'Waits in the dark' })).id,
    8,
    8,
  );
  const dm = await h.connect({ cookie: h.cookie });
  const tv = await h.connect();
  expect(await h.command(dm, 'scene.activate', { scene_id: scene.id })).toEqual({ ok: true });
  await dm.settle();
  await tv.settle();
  return { scene, other, wren, tamsin, goblin, lurker, dm, tv };
}

const code = (ack: unknown) => (ack as ErrorEnvelope).error.code;
const types = (events: { type: string }[]) => events.map((event) => event.type);
const ok = { ok: true };
const stored = (sceneId: string): Encounter | null => {
  const row = h.data.db.prepare('SELECT * FROM encounter WHERE scene_id = ?').get(sceneId) as
    | (Omit<Encounter, 'entries' | 'active' | 'enemies_seen'> & {
        entries: string;
        active: number;
        enemies_seen: number;
      })
    | undefined;
  return row === undefined
    ? null
    : {
        ...row,
        active: row.active === 1,
        enemies_seen: row.enemies_seen === 1,
        entries: JSON.parse(row.entries) as Encounter['entries'],
      };
};
const dmEncounter = (events: { type: string; payload: unknown }[]) =>
  (events.filter((event) => event.type === 'encounter.updated').at(-1)?.payload as { encounter: Encounter | null })
    .encounter;
const tvEncounter = (events: { type: string; payload: unknown }[]) =>
  (
    events.filter((event) => event.type === 'encounter.updated').at(-1)?.payload as {
      encounter: PlayerEncounter | null;
    }
  ).encounter;
const send = (client: Client, type: string, payload: object) => h.command(client, type, payload);

async function started(live: Live): Promise<Encounter> {
  expect(await send(live.dm, 'encounter.start', { scene_id: live.scene.id })).toEqual(ok);
  await live.dm.settle();
  await live.tv.settle();
  return stored(live.scene.id)!;
}
const entryOf = (encounter: Encounter, tokenId: string) =>
  encounter.entries.find((entry) => entry.token_id === tokenId)!;

describe('encounter.start and encounter.end (specs/04-live-sync.md §14)', () => {
  it('starts from the visible player characters and monsters in list order, for both rooms', async () => {
    const live = await liveScene();
    const { scene, dm, tv, tamsin, wren, goblin } = live;
    const versions = [h.versions.dm.current(), h.versions.players.current()];
    expect(await send(dm, 'encounter.start', { scene_id: scene.id })).toEqual(ok);
    const [dmEvents, tvEvents] = [await dm.settle(), await tv.settle()];
    expect(dmEvents.map((event) => [event.type, event.version])).toEqual([
      ['encounter.updated', versions[0]! + 1],
      ['history.changed', versions[0]! + 2],
    ]);
    expect(tvEvents.map((event) => [event.type, event.version])).toEqual([['encounter.updated', versions[1]! + 1]]);
    const encounter = dmEncounter(dmEvents)!;
    expect(encounter).toEqual(stored(scene.id));
    expect(encounter).toMatchObject({ active: true, round: 1, current_index: 0, enemies_seen: true });
    // The hidden lurker takes no entry.
    expect(encounter.entries.map((entry) => [entry.kind, entry.token_id, entry.initiative])).toEqual([
      ['pc', tamsin.id, null],
      ['pc', wren.id, null],
      ['monster', goblin.id, null],
    ]);
    expect(tvEncounter(tvEvents)).toEqual({
      round: 1,
      entries: [
        { id: encounter.entries[0]!.id, kind: 'pc', token_id: tamsin.id },
        { id: encounter.entries[1]!.id, kind: 'pc', token_id: wren.id },
        { id: encounter.entries[2]!.id, kind: 'monster', token_id: goblin.id },
      ],
      current: 0,
      next: 1,
    });
    // Starting again while it runs is refused and changes nothing.
    expect(code(await send(dm, 'encounter.start', { scene_id: scene.id }))).toBe('bad_request');
    expect(await tv.settle()).toEqual([]);
  });

  it('ends combat for both rooms, and players hear that no encounter is shown', async () => {
    const live = await liveScene();
    await started(live);
    expect(await send(live.dm, 'encounter.end', { scene_id: live.scene.id })).toEqual(ok);
    expect(dmEncounter(await live.dm.settle())).toMatchObject({ active: false, round: 1, entries: [] });
    expect(tvEncounter(await live.tv.settle())).toBeNull();
    // Nothing runs, so the other commands are refused.
    for (const type of ['encounter.next', 'encounter.previous', 'encounter.end']) {
      expect(code(await send(live.dm, type, { scene_id: live.scene.id })), type).toBe('bad_request');
    }
  });

  it('is refused on a scene that is not live, and from the players room', async () => {
    const live = await liveScene();
    expect(code(await send(live.dm, 'encounter.start', { scene_id: live.other.id }))).toBe('scene_not_live');
    expect(code(await send(live.tv, 'encounter.start', { scene_id: live.scene.id }))).toBe('forbidden');
    expect(stored(live.scene.id)).toBeNull();
    expect(stored(live.other.id)).toBeNull();
  });
});

describe('order, initiative and turns (specs/04-live-sync.md §14)', () => {
  it('sorts by the numbers set, keeps a drag until a number is set again, and the turn follows its entry', async () => {
    const live = await liveScene();
    const { scene, dm, tv, tamsin, wren, goblin } = live;
    let encounter = await started(live);
    const enemies = entryOf(encounter, goblin.id);
    expect(
      await send(dm, 'encounter.setInitiative', {
        scene_id: scene.id,
        entry_id: entryOf(encounter, wren.id).id,
        initiative: 18,
      }),
    ).toEqual(ok);
    encounter = stored(scene.id)!;
    expect(encounter.entries.map((entry) => entry.id)).toEqual([
      entryOf(encounter, wren.id).id,
      entryOf(encounter, tamsin.id).id,
      enemies.id,
    ]);
    // Tamsin had the turn and keeps it at her new place.
    expect(encounter.current_index).toBe(1);
    // Players hear the new order without the number.
    expect(JSON.stringify(await tv.settle())).not.toContain('"initiative"');
    // A drag puts the goblin first; the order stands as dragged.
    const dragged = [enemies.id, entryOf(encounter, tamsin.id).id, entryOf(encounter, wren.id).id];
    expect(await send(dm, 'encounter.reorder', { scene_id: scene.id, entry_ids: dragged })).toEqual(ok);
    expect(stored(scene.id)!.entries.map((entry) => entry.id)).toEqual(dragged);
    // An order that does not name every entry once is refused.
    expect(code(await send(dm, 'encounter.reorder', { scene_id: scene.id, entry_ids: dragged.slice(1) }))).toBe(
      'order_mismatch',
    );
    // Setting a number sorts again: Wren's 18 first, then the unnumbered in their dragged order.
    expect(
      await send(dm, 'encounter.setInitiative', { scene_id: scene.id, entry_id: enemies.id, initiative: 12 }),
    ).toEqual(ok);
    expect(stored(scene.id)!.entries.map((entry) => entry.id)).toEqual([
      entryOf(encounter, wren.id).id,
      enemies.id,
      entryOf(encounter, tamsin.id).id,
    ]);
    expect(
      code(await send(dm, 'encounter.setInitiative', { scene_id: scene.id, entry_id: scene.id, initiative: 3 })),
    ).toBe('not_found');
  });

  it('passes the turn, counts rounds across several, and goes back', async () => {
    const live = await liveScene();
    const { scene, dm, tv } = live;
    await started(live);
    const next = () => send(dm, 'encounter.next', { scene_id: scene.id });
    const turns: [number, number][] = [];
    for (let i = 0; i < 7; i += 1) {
      expect(await next()).toEqual(ok);
      const { current_index, round } = stored(scene.id)!;
      turns.push([current_index, round]);
    }
    expect(turns).toEqual([
      [1, 1],
      [2, 1],
      [0, 2],
      [1, 2],
      [2, 2],
      [0, 3],
      [1, 3],
    ]);
    expect(tvEncounter(await tv.settle())).toMatchObject({ round: 3, current: 1, next: 2 });
    expect(await send(dm, 'encounter.previous', { scene_id: scene.id })).toEqual(ok);
    expect(await send(dm, 'encounter.previous', { scene_id: scene.id })).toEqual(ok);
    expect(stored(scene.id)).toMatchObject({ current_index: 2, round: 2 });
    await dm.settle();
  });

  it('does not pass over an Unconscious or Dead player character', async () => {
    const live = await liveScene();
    const { scene, dm, wren } = live;
    await started(live);
    expect(await h.command(dm, 'token.setMarkers', { token_id: wren.id, markers: [{ id: 'unconscious' }] })).toEqual(
      ok,
    );
    expect(await send(dm, 'encounter.next', { scene_id: scene.id })).toEqual(ok);
    expect(stored(scene.id)!.current_index).toBe(1);
  });

  it('passes over a hidden player character, whom players no longer see in the strip', async () => {
    const live = await liveScene();
    const { scene, dm, tv, wren } = live;
    await started(live);
    expect(await h.command(dm, 'token.setVisibility', { token_id: wren.id, hidden: true })).toEqual(ok);
    const strip = tvEncounter(await tv.settle())!;
    expect(strip.entries.map((entry) => entry.kind)).toEqual(['pc', 'monster']);
    expect(JSON.stringify(strip)).not.toContain(wren.id);
    expect(await send(dm, 'encounter.next', { scene_id: scene.id })).toEqual(ok);
    expect(stored(scene.id)!.current_index).toBe(2);
  });
});

describe('a player character hidden on its own turn (TBL-06 review)', () => {
  it('names no turn and no next to players, and a number or a move of it tells them nothing', async () => {
    const live = await liveScene();
    const { scene, dm, tv, tamsin } = live;
    const encounter = await started(live);
    expect(await h.command(dm, 'token.setVisibility', { token_id: tamsin.id, hidden: true })).toEqual(ok);
    expect(tvEncounter(await tv.settle())).toMatchObject({ current: null, next: null });
    const players = h.versions.players.current();
    const entry = entryOf(encounter, tamsin.id).id;
    expect(await send(dm, 'encounter.setInitiative', { scene_id: scene.id, entry_id: entry, initiative: 3 })).toEqual(
      ok,
    );
    // Only the hidden entry moves: to the end.
    const order = stored(scene.id)!.entries.map((each) => each.id);
    expect(
      await send(dm, 'encounter.reorder', {
        scene_id: scene.id,
        entry_ids: [...order.filter((id) => id !== entry), entry],
      }),
    ).toEqual(ok);
    expect(await tv.settle()).toEqual([]);
    expect(h.versions.players.current()).toBe(players);
  });

  it('passes the turn as Next would when the entry whose turn it is goes', async () => {
    const live = await liveScene();
    const { scene, dm, wren } = live;
    await started(live);
    expect(await send(dm, 'encounter.next', { scene_id: scene.id })).toEqual(ok);
    expect(await h.command(dm, 'token.delete', { token_id: wren.id })).toEqual(ok);
    // Wren had the turn; the goblin takes it.
    expect(stored(scene.id)).toMatchObject({ current_index: 1, round: 1 });
    await dm.settle();
  });
});

describe('monster entries (specs/04-live-sync.md §14, Q-117, Q-118)', () => {
  it('passes over a Dead monster, which stays in the order and greyed for players, until removed', async () => {
    const live = await liveScene();
    const { scene, dm, tv, goblin } = live;
    const encounter = await started(live);
    expect(await send(dm, 'encounter.next', { scene_id: scene.id })).toEqual(ok);
    await tv.settle();
    // The goblin dies on Wren's turn: Next now passes over it, back to Tamsin in round 2.
    expect(await h.command(dm, 'token.setMarkers', { token_id: goblin.id, markers: [{ id: 'dead' }] })).toEqual(ok);
    const tvEvents = await tv.settle();
    expect(tvEncounter(tvEvents)).toMatchObject({ current: 1, next: 0 });
    // Players still see its card: the marker they see on the token greys it.
    expect(tvEncounter(tvEvents)!.entries.map((entry) => entry.token_id)).toContain(goblin.id);
    expect(await send(dm, 'encounter.next', { scene_id: scene.id })).toEqual(ok);
    expect(stored(scene.id)).toMatchObject({ current_index: 0, round: 2, enemies_seen: true });
    expect(stored(scene.id)!.entries.map((entry) => entry.id)).toEqual(encounter.entries.map((entry) => entry.id));
    // Removed, it is gone for both rooms.
    expect(
      await send(dm, 'encounter.removeEntry', { scene_id: scene.id, entry_id: entryOf(encounter, goblin.id).id }),
    ).toEqual(ok);
    expect(tvEncounter(await tv.settle())!.entries.map((entry) => entry.kind)).toEqual(['pc', 'pc']);
    await dm.settle();
  });

  it('never adds a monster revealed mid-combat by itself, and adds it by the number the DM gives', async () => {
    const live = await liveScene();
    const { scene, dm, tv, tamsin, wren, goblin, lurker } = live;
    await started(live);
    for (const [token, initiative] of [
      [tamsin, 18],
      [wren, 12],
      [goblin, 7],
    ] as const) {
      const entry = entryOf(stored(scene.id)!, token.id).id;
      expect(await send(dm, 'encounter.setInitiative', { scene_id: scene.id, entry_id: entry, initiative })).toEqual(
        ok,
      );
    }
    await tv.settle();
    // A hidden token cannot enter.
    expect(code(await send(dm, 'encounter.addEntry', { scene_id: scene.id, token_id: lurker.id }))).toBe('bad_request');
    expect(await h.command(dm, 'token.setVisibility', { token_id: lurker.id, hidden: false })).toEqual(ok);
    // The reveal adds no entry: the DM is offered it (Q-117).
    expect(stored(scene.id)!.entries).toHaveLength(3);
    expect(types(await tv.settle())).toEqual(['token.added']);
    expect(await send(dm, 'encounter.addEntry', { scene_id: scene.id, token_id: lurker.id, initiative: 12 })).toEqual(
      ok,
    );
    // In by its number, after Wren's equal 12, and the turn stays with Tamsin.
    const encounter = stored(scene.id)!;
    expect(encounter.entries.map((entry) => [entry.token_id, entry.initiative])).toEqual([
      [tamsin.id, 18],
      [wren.id, 12],
      [lurker.id, 12],
      [goblin.id, 7],
    ]);
    expect(encounter.current_index).toBe(0);
    expect(tvEncounter(await tv.settle())!.entries.map((entry) => entry.token_id)).toEqual([
      tamsin.id,
      wren.id,
      lurker.id,
      goblin.id,
    ]);
    // Once it has an entry, adding it again is refused; so is an object or a Dead monster.
    expect(code(await send(dm, 'encounter.addEntry', { scene_id: scene.id, token_id: lurker.id }))).toBe('bad_request');
    await dm.settle();
  });

  it('passes over a monster hidden again, and tells players nothing of it while hidden', async () => {
    const live = await liveScene();
    const { scene, dm, tv, goblin } = live;
    await started(live);
    expect(await send(dm, 'encounter.next', { scene_id: scene.id })).toEqual(ok);
    expect(tvEncounter(await tv.settle())).toMatchObject({ current: 1, next: 2 });
    expect(await h.command(dm, 'token.setVisibility', { token_id: goblin.id, hidden: true })).toEqual(ok);
    const events = await tv.settle();
    expect(types(events)).toEqual(['token.removed', 'encounter.updated']);
    expect(tvEncounter(events)).toMatchObject({ current: 1, next: 0 });
    expect(JSON.stringify(tvEncounter(events))).not.toContain(goblin.id);
    // Hidden, the goblin moving, gaining markers or having its number set tells players nothing.
    const players = h.versions.players.current();
    expect(await h.command(dm, 'token.move', { token_id: goblin.id, x: 3, y: 3 })).toEqual(ok);
    expect(await h.command(dm, 'token.setMarkers', { token_id: goblin.id, markers: [{ id: 'prone' }] })).toEqual(ok);
    const entry = entryOf(stored(scene.id)!, goblin.id).id;
    expect(await send(dm, 'encounter.setInitiative', { scene_id: scene.id, entry_id: entry, initiative: 30 })).toEqual(
      ok,
    );
    expect(await tv.settle()).toEqual([]);
    expect(h.versions.players.current()).toBe(players);
    expect(await send(dm, 'encounter.next', { scene_id: scene.id })).toEqual(ok);
    // The goblin, now first by its 30, is passed over: Tamsin, round 2.
    expect(stored(scene.id)).toMatchObject({ current_index: 1, round: 2 });
    await dm.settle();
  });

  it('remembers having had an enemy only once a monster entry could act (Q-118)', async () => {
    const live = await liveScene();
    const { scene, dm, goblin, lurker } = live;
    expect(await h.command(dm, 'token.delete', { token_id: goblin.id })).toEqual(ok);
    expect((await started(live)).enemies_seen).toBe(false);
    expect(await h.command(dm, 'token.setVisibility', { token_id: lurker.id, hidden: false })).toEqual(ok);
    // Seen, but with no entry yet: still no enemy in the encounter.
    expect(stored(scene.id)!.enemies_seen).toBe(false);
    expect(await send(dm, 'encounter.addEntry', { scene_id: scene.id, token_id: lurker.id })).toEqual(ok);
    expect(stored(scene.id)!.enemies_seen).toBe(true);
    // Dead, it stays remembered.
    expect(await h.command(dm, 'token.setMarkers', { token_id: lurker.id, markers: [{ id: 'dead' }] })).toEqual(ok);
    expect(stored(scene.id)!.enemies_seen).toBe(true);
    await dm.settle();
  });
});

describe('entries, deletion and undo (specs/04-live-sync.md §8, §14, specs/03-domain-model.md §7)', () => {
  it('adds a visible player character or monster at the end and removes one, refusing what may not enter', async () => {
    const live = await liveScene();
    const { scene, dm, goblin } = live;
    expect(
      await h.command(dm, 'token.add', {
        scene_id: scene.id,
        asset_id: (await h.asset('Brann', { category: 'pc' })).id,
        x: 4,
        y: 1,
      }),
    ).toEqual(ok);
    const brann = h.data.db.prepare("SELECT id FROM token WHERE label = 'Brann'").pluck().get() as string;
    let encounter = await started(live);
    expect(encounter.entries).toHaveLength(4);
    expect(code(await send(dm, 'encounter.addEntry', { scene_id: scene.id, token_id: brann }))).toBe('bad_request');
    const brannEntry = entryOf(encounter, brann);
    expect(await send(dm, 'encounter.removeEntry', { scene_id: scene.id, entry_id: brannEntry.id })).toEqual(ok);
    expect(await send(dm, 'encounter.addEntry', { scene_id: scene.id, token_id: brann })).toEqual(ok);
    encounter = stored(scene.id)!;
    expect(encounter.entries.at(-1)).toMatchObject({ kind: 'pc', token_id: brann, initiative: null });
    // The goblin has an entry already; removed, it can be added back.
    expect(code(await send(dm, 'encounter.addEntry', { scene_id: scene.id, token_id: goblin.id }))).toBe('bad_request');
    expect(
      await send(dm, 'encounter.removeEntry', { scene_id: scene.id, entry_id: entryOf(encounter, goblin.id).id }),
    ).toEqual(ok);
    // Dead, it may not enter; an object never does.
    expect(await h.command(dm, 'token.setMarkers', { token_id: goblin.id, markers: [{ id: 'dead' }] })).toEqual(ok);
    expect(code(await send(dm, 'encounter.addEntry', { scene_id: scene.id, token_id: goblin.id }))).toBe('bad_request');
    expect(await h.command(dm, 'token.setMarkers', { token_id: goblin.id, markers: [] })).toEqual(ok);
    expect(await send(dm, 'encounter.addEntry', { scene_id: scene.id, token_id: goblin.id })).toEqual(ok);
    expect(stored(scene.id)!.entries.at(-1)).toMatchObject({ kind: 'monster', token_id: goblin.id });
    expect(
      await h.command(dm, 'token.add', {
        scene_id: scene.id,
        asset_id: (await h.asset('Chest', { category: 'object' })).id,
        x: 5,
        y: 1,
      }),
    ).toEqual(ok);
    const chest = h.data.db.prepare("SELECT id FROM token WHERE label = 'Chest'").pluck().get() as string;
    expect(code(await send(dm, 'encounter.addEntry', { scene_id: scene.id, token_id: chest }))).toBe('bad_request');
    await dm.settle();
  });

  it('undoes and redoes every encounter command, the start back to no encounter', async () => {
    const live = await liveScene();
    const { scene, dm, tv } = live;
    await started(live);
    expect(await send(dm, 'encounter.next', { scene_id: scene.id })).toEqual(ok);
    expect(await h.command(dm, 'undo', {})).toEqual(ok);
    expect(stored(scene.id)!.current_index).toBe(0);
    expect(await h.command(dm, 'redo', {})).toEqual(ok);
    expect(stored(scene.id)!.current_index).toBe(1);
    expect(await h.command(dm, 'undo', {})).toEqual(ok);
    expect(await h.command(dm, 'undo', {})).toEqual(ok);
    expect(stored(scene.id)).toBeNull();
    expect(dmEncounter(await dm.settle())).toBeNull();
    expect(tvEncounter(await tv.settle())).toBeNull();
    // Ended combat comes back with undo.
    await started(live);
    expect(await send(dm, 'encounter.end', { scene_id: scene.id })).toEqual(ok);
    expect(await h.command(dm, 'undo', {})).toEqual(ok);
    expect(stored(scene.id)!.active).toBe(true);
    expect(tvEncounter(await tv.settle())).not.toBeNull();
  });

  it('takes a deleted monster’s entry with it', async () => {
    const live = await liveScene();
    const { scene, dm, tv, goblin } = live;
    const before = await started(live);
    expect(await h.command(dm, 'token.delete', { token_id: goblin.id })).toEqual(ok);
    expect(stored(scene.id)!.entries.map((entry) => entry.id)).toEqual(
      before.entries.slice(0, 2).map((entry) => entry.id),
    );
    expect(types(await tv.settle())).toEqual(['token.removed', 'encounter.updated']);
    await dm.settle();
  });

  it('takes a deleted token’s entry with it, and undoing the delete puts the entry back where it was', async () => {
    const live = await liveScene();
    const { scene, dm, tv, tamsin } = live;
    const before = await started(live);
    expect(await h.command(dm, 'token.delete', { token_id: tamsin.id })).toEqual(ok);
    // Undo had something to take back already: the start.
    expect(types(await dm.settle())).toEqual(['token.removed', 'encounter.updated']);
    expect(stored(scene.id)!.entries.map((entry) => entry.id)).toEqual(
      before.entries.slice(1).map((entry) => entry.id),
    );
    expect(types(await tv.settle())).toEqual(['token.removed', 'encounter.updated']);
    expect(await h.command(dm, 'undo', {})).toEqual(ok);
    expect(stored(scene.id)).toEqual(before);
    expect(types(await tv.settle())).toEqual(['token.added', 'encounter.updated']);
    expect(await h.command(dm, 'redo', {})).toEqual(ok);
    expect(stored(scene.id)!.entries).toHaveLength(2);
    await dm.settle();
  });

  it('keeps the encounter of a scene that is no longer live, and deletes it with its scene', async () => {
    const live = await liveScene();
    const { scene, other, dm, tv } = live;
    const encounter = await started(live);
    expect(await h.command(dm, 'scene.activate', { scene_id: other.id })).toEqual(ok);
    expect(((await tv.settle()).at(-1)!.payload as PlayerSnapshot).scene?.encounter).toBeNull();
    expect(stored(scene.id)).toEqual(encounter);
    expect(await h.command(dm, 'scene.activate', { scene_id: scene.id })).toEqual(ok);
    expect(((await tv.settle()).at(-1)!.payload as PlayerSnapshot).scene?.encounter).toMatchObject({ round: 1 });
    expect(await h.command(dm, 'scene.activate', { scene_id: other.id })).toEqual(ok);
    const summary = (await h.inject({ method: 'GET', url: `/api/scenes/${scene.id}/deletion` })).json<unknown>();
    const response = await h.inject({
      method: 'DELETE',
      url: `/api/scenes/${scene.id}`,
      payload: { confirm: summary },
    });
    expect(response.statusCode).toBeLessThan(300);
    expect(stored(scene.id)).toBeNull();
    await dm.settle();
  });
});

describe('snapshots (specs/04-live-sync.md §5, §6, §14)', () => {
  it('gives a reconnecting TV the strip and the DM the whole encounter, and players nothing of a hidden enemy', async () => {
    const live = await liveScene();
    const { scene, dm, lurker, goblin } = live;
    const encounter = await started(live);
    expect(
      await send(dm, 'encounter.setInitiative', {
        scene_id: scene.id,
        entry_id: entryOf(encounter, goblin.id).id,
        initiative: 21,
      }),
    ).toEqual(ok);
    const late = await h.connect();
    const snapshot = (late.first.payload as PlayerSnapshot).scene!;
    expect(snapshot.encounter).toMatchObject({ round: 1, current: 1, next: 2 });
    expect(snapshot.encounter!.entries.map((entry) => entry.kind)).toEqual(['monster', 'pc', 'pc']);
    expect(snapshot.encounter!.entries[0]).toEqual({
      id: entryOf(encounter, goblin.id).id,
      kind: 'monster',
      token_id: goblin.id,
    });
    const text = JSON.stringify(snapshot.encounter);
    for (const secret of [lurker.id, '"initiative"', 'enemies_seen', 'Lurker', 'members']) {
      expect(text, secret).not.toContain(secret);
    }
    const dmLate = await h.connect({ cookie: h.cookie });
    expect((dmLate.first.payload as DmSnapshot).scene!.encounter).toEqual(stored(scene.id));
  });
});
