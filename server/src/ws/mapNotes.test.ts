import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NOTES_MAX_LENGTH,
  type DmSnapshot,
  type ErrorEnvelope,
  type MapNote,
  type MapNotesUpdatedPayload,
  type Scene,
} from '@emberglass/shared';
import { ok, startLive, type Client, type LiveHarness } from './testing/harness.js';

// UXR-08 over a real port and real Socket.io clients, against a real SQLite file (specs/03-domain-model.md §1, §7,
// §10, specs/04-live-sync.md §3, §4, §16, Q-128): map notes placed, edited, moved and deleted over REST on a prepared
// scene and on the live one; on the live scene the DM room told by `mapNotes.updated`, every map note of the scene,
// and the players room told nothing, its version unmoved; nothing undoable; the limit and the bounds; a duplicated
// scene copying them; a deleted scene taking them with it.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let h: LiveHarness;

afterEach(async () => {
  await h.close();
});

const create = (sceneId: string, body: object) =>
  h.inject({ method: 'POST', url: `/api/scenes/${sceneId}/map-notes`, payload: body });
const patch = (id: string, body: object) => h.inject({ method: 'PATCH', url: `/api/map-notes/${id}`, payload: body });
const remove = (id: string) => h.inject({ method: 'DELETE', url: `/api/map-notes/${id}` });
const list = async (sceneId: string) =>
  ok<MapNote[]>(await h.inject({ method: 'GET', url: `/api/scenes/${sceneId}/map-notes` }));
const types = (events: { type: string }[]) => events.map((event) => event.type);
const stored = () => h.data.db.prepare('SELECT count(*) FROM map_note').pluck().get() as number;

interface Table {
  live: Scene;
  prep: Scene;
  dm: Client;
  tv: Client;
}

async function table(): Promise<Table> {
  h = await startLive();
  const live = await h.scene('The bridge', (await h.image('map notes bridge', 96)).id);
  const prep = await h.scene('The crypt', (await h.image('map notes crypt', 80)).id);
  const asset = await h.asset('Bandit', { category: 'monster', default_hidden: false });
  await h.place(live.id, asset.id, 1, 1);
  const dm = await h.connect({ cookie: h.cookie });
  const tv = await h.connect();
  expect(await h.command(dm, 'scene.activate', { scene_id: live.id })).toEqual({ ok: true });
  await dm.settle();
  await tv.settle();
  return { live, prep, dm, tv };
}

describe('map notes over REST (UXR-08, specs/04-live-sync.md §16)', () => {
  it('places, edits, moves and deletes a prepared scene’s map notes, telling no client', async () => {
    const { prep, dm, tv } = await table();
    const text = 'Loose flagstone: pit trap, DC 13.\n\n<b>not bold</b>';
    const created = ok<MapNote>(await create(prep.id, { x: 4.5, y: 2.5, notes: text }), 201);
    expect(Object.keys(created).sort()).toEqual(['id', 'notes', 'scene_id', 'x', 'y']);
    expect(created).toMatchObject({ scene_id: prep.id, x: 4.5, y: 2.5, notes: text });
    const empty = ok<MapNote>(await create(prep.id, { x: -0.5, y: 7.25 }), 201);
    expect(empty.notes).toBe('');
    expect(await list(prep.id)).toEqual(expect.arrayContaining([created, empty]));

    expect(ok<MapNote>(await patch(created.id, { x: 6, y: 3 }))).toMatchObject({ x: 6, y: 3, notes: text });
    expect(ok<MapNote>(await patch(created.id, { notes: 'Barred door.' }))).toMatchObject({
      x: 6,
      notes: 'Barred door.',
    });
    expect((await remove(empty.id)).statusCode).toBe(204);
    expect(await list(prep.id)).toEqual([{ ...created, x: 6, y: 3, notes: 'Barred door.' }]);

    // A scene that is not live reaches no client (specs/04-live-sync.md §1).
    expect(await dm.settle()).toEqual([]);
    expect(await tv.settle()).toEqual([]);
  });

  it('changes the live scene’s map notes, the DM room alone told by mapNotes.updated with all of them', async () => {
    const { live, dm, tv } = await table();
    const before = h.versions.players.current();

    const trap = ok<MapNote>(await create(live.id, { x: 2.5, y: 3.5, notes: 'Trap under the rug.' }), 201);
    const door = ok<MapNote>(await create(live.id, { x: 8, y: 1, notes: 'The door is barred.' }), 201);
    ok<MapNote>(await patch(trap.id, { x: 3.5, notes: 'Trap sprung on round 2.' }));
    expect((await remove(door.id)).statusCode).toBe(204);

    const events = await dm.settle();
    expect(types(events)).toEqual(['mapNotes.updated', 'mapNotes.updated', 'mapNotes.updated', 'mapNotes.updated']);
    const payloads = events.map((event) => event.payload as MapNotesUpdatedPayload);
    expect(payloads.map((payload) => payload.scene_id)).toEqual([live.id, live.id, live.id, live.id]);
    expect(payloads[0]!.map_notes).toEqual([trap]);
    expect(payloads[1]!.map_notes).toEqual(expect.arrayContaining([trap, door]));
    expect(payloads[3]!.map_notes).toEqual([{ ...trap, x: 3.5, notes: 'Trap sprung on round 2.' }]);
    // Each event takes the DM room's next version, so a DM view sees no gap.
    const versions = events.map((event) => event.version);
    expect(versions).toEqual([0, 1, 2, 3].map((n) => versions[0]! + n));

    // Players hear nothing, and their version does not move (specs/04-live-sync.md §4).
    expect(await tv.settle()).toEqual([]);
    expect(h.versions.players.current()).toBe(before);
    const players = JSON.stringify(tv.events);
    for (const secret of ['Trap', 'barred', 'map_notes', 'mapNotes', trap.id, door.id]) {
      expect(players, secret).not.toContain(secret);
    }

    // The DM's snapshot carries them, for a view that reconnects; the players' does not.
    const fresh = (await h.connect({ cookie: h.cookie })).first.payload as DmSnapshot;
    expect(fresh.scene!.map_notes).toEqual([{ ...trap, x: 3.5, notes: 'Trap sprung on round 2.' }]);
    const screen = JSON.stringify((await h.connect()).first);
    for (const secret of ['Trap', 'map_notes', trap.id]) expect(screen, secret).not.toContain(secret);
  });

  it('keeps map notes out of the undo history: undo takes back the last command, not a note', async () => {
    const { live, dm } = await table();
    const before = await h.command(dm, 'undo', {});
    await dm.settle();
    const note = ok<MapNote>(await create(live.id, { x: 1, y: 1, notes: 'Stays.' }), 201);
    ok<MapNote>(await patch(note.id, { x: 5 }));
    // A change of map notes says nothing of the undo state.
    expect(types(await dm.settle())).toEqual(['mapNotes.updated', 'mapNotes.updated']);
    expect(await h.command(dm, 'undo', {})).toEqual(before);
    expect(await list(live.id)).toEqual([{ ...note, x: 5 }]);
  });

  it('refuses a text over the limit, a bad body and an unknown scene or note, storing nothing', async () => {
    const { prep, dm } = await table();
    const longest = 'x'.repeat(NOTES_MAX_LENGTH);
    const note = ok<MapNote>(await create(prep.id, { x: 0, y: 0, notes: longest }), 201);
    expect(note.notes).toHaveLength(NOTES_MAX_LENGTH);
    for (const body of [
      { x: 1, y: 1, notes: `${longest}x` },
      { x: 1 },
      { x: 'east', y: 1 },
      { x: 2e6, y: 1 },
      { x: 1, y: 1, label: 'Trap' },
      { x: 1, y: 1, scene_id: prep.id },
    ]) {
      const response = await create(prep.id, body);
      expect(response.statusCode, JSON.stringify(body).slice(0, 40)).toBe(400);
      expect(response.json<ErrorEnvelope>().error.code).toBe('validation_failed');
    }
    for (const body of [{}, { notes: `${longest}x` }, { notes: null }, { y: Infinity }, { scene_id: prep.id }]) {
      expect((await patch(note.id, body)).statusCode, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect(stored()).toBe(1);
    const unknown = '00000000-0000-4000-8000-00000000abcd';
    for (const response of [
      await create(unknown, { x: 0, y: 0 }),
      await patch(unknown, { x: 1 }),
      await remove(unknown),
      await h.inject({ method: 'GET', url: `/api/scenes/${unknown}/map-notes` }),
    ]) {
      expect(response.statusCode).toBe(404);
      expect(response.json<ErrorEnvelope>().error.code).toBe('not_found');
    }
    expect(stored()).toBe(1);
    expect(await dm.settle()).toEqual([]);
  });

  it('needs a DM session, as every route under /api does', async () => {
    const { live } = await table();
    const note = ok<MapNote>(await create(live.id, { x: 1, y: 1, notes: 'Secret.' }), 201);
    for (const [method, url, payload] of [
      ['GET', `/api/scenes/${live.id}/map-notes`, undefined],
      ['POST', `/api/scenes/${live.id}/map-notes`, { x: 0, y: 0, notes: 'sneaky' }],
      ['PATCH', `/api/map-notes/${note.id}`, { notes: 'sneaky' }],
      ['DELETE', `/api/map-notes/${note.id}`, undefined],
    ] as const) {
      const response = await h.request({ method, url, ...(payload ? { payload } : {}) });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
    expect(await list(live.id)).toEqual([note]);
  });

  it('copies a scene’s map notes when it is duplicated, and deletes them with it', async () => {
    const { prep } = await table();
    const note = ok<MapNote>(await create(prep.id, { x: 4.5, y: 2.5, notes: 'Pit trap.' }), 201);
    const copy = ok<Scene>(
      await h.inject({ method: 'POST', url: `/api/scenes/${prep.id}/duplicate`, payload: { name: 'The crypt 2' } }),
      201,
    );
    const copied = await list(copy.id);
    expect(copied).toHaveLength(1);
    expect(copied[0]).toMatchObject({ scene_id: copy.id, x: 4.5, y: 2.5, notes: 'Pit trap.' });
    expect(copied[0]!.id).not.toBe(note.id);
    // The copy is its own: editing it leaves the original as it was.
    ok<MapNote>(await patch(copied[0]!.id, { notes: 'Sprung.' }));
    expect(await list(prep.id)).toEqual([note]);

    // Deleting a scene states what goes and takes that as its confirmation (specs/03-domain-model.md §7).
    const confirm = ok<unknown>(await h.inject({ method: 'GET', url: `/api/scenes/${prep.id}/deletion` }));
    ok(await h.inject({ method: 'DELETE', url: `/api/scenes/${prep.id}`, payload: { confirm } }), 204);
    expect(await list(copy.id)).toHaveLength(1);
    expect(stored()).toBe(1);
  });
});
