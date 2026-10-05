import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NOTES_MAX_LENGTH,
  type DmSnapshot,
  type ErrorEnvelope,
  type NotesUpdatedPayload,
  type Scene,
  type SceneToken,
} from '@emberglass/shared';
import { ok, startLive, type Client, type LiveHarness } from './testing/harness.js';

// DMT-04 over a real port and real Socket.io clients, against a real SQLite file (specs/03-domain-model.md §7, §10,
// specs/04-live-sync.md §2, §3, §4, §16, Q-114, D-181, D-186): a scene's and a token's notes edited over REST on a
// prepared scene and on the live one, the whole text, line breaks kept, last write winning; on the live scene the DM
// room told by `notes.updated` and the players room told nothing, its version unmoved; nothing undoable; the limit;
// a duplicated scene copying its notes and its tokens' with their hit points; an asset's notes beside a token's.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let h: LiveHarness;

afterEach(async () => {
  await h.close();
});

const putScene = (id: string, notes: unknown) =>
  h.inject({ method: 'PUT', url: `/api/scenes/${id}/notes`, payload: { notes } });
const putToken = (id: string, notes: unknown) =>
  h.inject({ method: 'PUT', url: `/api/tokens/${id}/notes`, payload: { notes } });
const types = (events: { type: string }[]) => events.map((event) => event.type);
const storedNotes = (table: 'scene' | 'token', id: string) =>
  h.data.db.prepare(`SELECT notes FROM ${table} WHERE id = ?`).pluck().get(id) as string;

interface Table {
  live: Scene;
  prep: Scene;
  bandit: SceneToken;
  lurker: SceneToken;
  prepBandit: SceneToken;
  dm: Client;
  tv: Client;
}

async function table(): Promise<Table> {
  h = await startLive();
  const live = await h.scene('The bridge', (await h.image('notes map', 96)).id);
  const prep = await h.scene('The crypt', (await h.image('notes crypt', 80)).id);
  const banditAsset = await h.asset('Bandit', {
    category: 'monster',
    default_hidden: false,
    notes: 'Bandits: flee when the leader falls.',
  });
  const lurkerAsset = await h.asset('Lurker', { category: 'monster', default_hidden: true });
  const bandit = await h.place(live.id, banditAsset.id, 1, 1);
  const lurker = await h.place(live.id, lurkerAsset.id, 4, 4);
  const prepBandit = await h.place(prep.id, banditAsset.id, 2, 2);
  const dm = await h.connect({ cookie: h.cookie });
  const tv = await h.connect();
  expect(await h.command(dm, 'scene.activate', { scene_id: live.id })).toEqual({ ok: true });
  await dm.settle();
  await tv.settle();
  return { live, prep, bandit, lurker, prepBandit, dm, tv };
}

describe('DM notes over REST (DMT-04, specs/04-live-sync.md §16)', () => {
  it('starts empty on every new scene and token, and shows a token its asset’s notes', async () => {
    const { prep, prepBandit } = await table();
    expect(prep.notes).toBe('');
    expect(prepBandit.notes).toBe('');
    expect(prepBandit.asset.notes).toBe('Bandits: flee when the leader falls.');
  });

  it('edits a prepared scene’s notes and a token’s, the whole text with its line breaks, telling no client', async () => {
    const { prep, prepBandit, dm, tv } = await table();
    const text = 'Leader: flees at half HP\n\n  Ambush from the north.\r\n<b>not bold</b>';
    const scene = ok<Scene>(await putScene(prep.id, text));
    expect(scene).toMatchObject({ id: prep.id, name: 'The crypt', notes: text });
    expect(storedNotes('scene', prep.id)).toBe(text);
    expect(ok<Scene>(await h.inject({ method: 'GET', url: `/api/scenes/${prep.id}` })).notes).toBe(text);

    const token = ok<SceneToken>(await putToken(prepBandit.id, 'Carries the key.'));
    expect(token).toMatchObject({ id: prepBandit.id, notes: 'Carries the key.', x: 2, y: 2 });
    const listed = ok<SceneToken[]>(await h.inject({ method: 'GET', url: `/api/scenes/${prep.id}/tokens` }));
    expect(listed.find((each) => each.id === prepBandit.id)!.notes).toBe('Carries the key.');

    // Last write wins; an empty text clears them.
    expect(ok<Scene>(await putScene(prep.id, '')).notes).toBe('');
    // A scene that is not live reaches no client (specs/04-live-sync.md §1).
    expect(await dm.settle()).toEqual([]);
    expect(await tv.settle()).toEqual([]);
  });

  it('edits the live scene’s notes and its tokens’, hidden ones included, the DM room alone told by notes.updated', async () => {
    const { live, bandit, lurker, dm, tv } = await table();
    const before = h.versions.players.current();

    ok<Scene>(await putScene(live.id, 'Round 3: reinforcements.'));
    ok<SceneToken>(await putToken(bandit.id, 'Leader: flees at half HP'));
    ok<SceneToken>(await putToken(lurker.id, 'Waits in the dark'));

    const events = await dm.settle();
    expect(types(events)).toEqual(['notes.updated', 'notes.updated', 'notes.updated']);
    expect(events.map((event) => event.payload as NotesUpdatedPayload)).toEqual([
      { scene_id: live.id, token_id: null, notes: 'Round 3: reinforcements.' },
      { scene_id: live.id, token_id: bandit.id, notes: 'Leader: flees at half HP' },
      { scene_id: live.id, token_id: lurker.id, notes: 'Waits in the dark' },
    ]);
    // Each event takes the DM room's next version, so a DM view sees no gap.
    const versions = events.map((event) => event.version);
    expect(versions).toEqual([versions[0], versions[0]! + 1, versions[0]! + 2]);

    // Players hear nothing, and their version does not move (specs/04-live-sync.md §4).
    expect(await tv.settle()).toEqual([]);
    expect(h.versions.players.current()).toBe(before);
    const players = JSON.stringify(tv.events);
    for (const secret of ['reinforcements', 'flees at half', 'Waits in the dark', 'leader falls', '"notes"']) {
      expect(players, secret).not.toContain(secret);
    }

    // The DM's snapshot carries them, for a view that reconnects; the players' does not.
    const fresh = (await h.connect({ cookie: h.cookie })).first.payload as DmSnapshot;
    expect(fresh.scene!.scene.notes).toBe('Round 3: reinforcements.');
    expect(fresh.scene!.tokens.find((each) => each.id === bandit.id)).toMatchObject({
      notes: 'Leader: flees at half HP',
      asset: { notes: 'Bandits: flee when the leader falls.' },
    });
    const screen = await h.connect();
    expect(JSON.stringify(screen.first)).not.toContain('"notes"');
  });

  it('keeps notes out of the undo history: undo takes back the last command, not a note', async () => {
    const { live, bandit, dm } = await table();
    expect(await h.command(dm, 'token.move', { token_id: bandit.id, x: 3, y: 3 })).toEqual({ ok: true });
    await dm.settle();
    ok<SceneToken>(await putToken(bandit.id, 'Moved on round 2.'));
    ok<Scene>(await putScene(live.id, 'Bridge collapses on round 5.'));
    // A change of notes says nothing of the undo state.
    expect(types(await dm.settle())).toEqual(['notes.updated', 'notes.updated']);

    expect(await h.command(dm, 'undo', {})).toEqual({ ok: true });
    const undone = await dm.settle();
    expect(types(undone)).toContain('token.updated');
    const token = (undone.find((event) => event.type === 'token.updated')!.payload as { token: SceneToken }).token;
    expect(token).toMatchObject({ x: 1, y: 1, notes: 'Moved on round 2.' });
    expect(storedNotes('scene', live.id)).toBe('Bridge collapses on round 5.');
    expect(await h.command(dm, 'undo', {})).toEqual({ ok: true });
    expect(storedNotes('token', bandit.id)).toBe('Moved on round 2.');
  });

  it('puts a deleted token back with its notes when its deletion is undone', async () => {
    const { bandit, dm } = await table();
    ok<SceneToken>(await putToken(bandit.id, 'Has the map.'));
    expect(await h.command(dm, 'token.delete', { token_id: bandit.id })).toEqual({ ok: true });
    expect(await h.command(dm, 'undo', {})).toEqual({ ok: true });
    expect(storedNotes('token', bandit.id)).toBe('Has the map.');
  });

  it('refuses a text over the limit, a body that is not one text and an unknown scene or token, storing nothing', async () => {
    const { prep, prepBandit, dm } = await table();
    ok<Scene>(await putScene(prep.id, 'kept'));
    const longest = 'x'.repeat(NOTES_MAX_LENGTH);
    expect(ok<Scene>(await putScene(prep.id, longest)).notes).toHaveLength(NOTES_MAX_LENGTH);
    for (const body of [{ notes: `${longest}x` }, { notes: null }, {}, { notes: 'x', label: 'y' }]) {
      const response = await h.inject({ method: 'PUT', url: `/api/scenes/${prep.id}/notes`, payload: body });
      expect(response.statusCode, JSON.stringify(body).slice(0, 40)).toBe(400);
      expect(response.json<ErrorEnvelope>().error.code).toBe('validation_failed');
      const token = await h.inject({ method: 'PUT', url: `/api/tokens/${prepBandit.id}/notes`, payload: body });
      expect(token.statusCode).toBe(400);
    }
    expect(storedNotes('scene', prep.id)).toBe(longest);
    expect(storedNotes('token', prepBandit.id)).toBe('');
    const unknown = '00000000-0000-4000-8000-00000000abcd';
    for (const response of [await putScene(unknown, 'x'), await putToken(unknown, 'x')]) {
      expect(response.statusCode).toBe(404);
      expect(response.json<ErrorEnvelope>().error.code).toBe('not_found');
    }
    expect(await dm.settle()).toEqual([]);
  });

  it('needs a DM session, as every route under /api does', async () => {
    const { live, bandit } = await table();
    for (const url of [`/api/scenes/${live.id}/notes`, `/api/tokens/${bandit.id}/notes`]) {
      const response = await h.request({ method: 'PUT', url, payload: { notes: 'sneaky' } });
      expect(response.statusCode, url).toBe(401);
    }
    expect(storedNotes('scene', live.id)).toBe('');
    expect(storedNotes('token', bandit.id)).toBe('');
  });
});

describe('duplicating a scene (specs/03-domain-model.md §7)', () => {
  it('copies its notes and its tokens’ notes, hit points and armour class, the original keeping its own', async () => {
    const { prep, prepBandit } = await table();
    ok<Scene>(await putScene(prep.id, 'The crypt: a trap on the stairs.'));
    ok<SceneToken>(await putToken(prepBandit.id, 'Leader: flees at half HP'));
    ok(
      await h.inject({
        method: 'PATCH',
        url: `/api/tokens/${prepBandit.id}`,
        payload: { hp_max: 11, hp_current: 7, hp_temp: 2, ac: 12 },
      }),
    );

    const copy = ok<Scene>(await h.post(`/api/scenes/${prep.id}/duplicate`, { name: 'The crypt (copy)' }), 201);
    expect(copy.id).not.toBe(prep.id);
    expect(copy.notes).toBe('The crypt: a trap on the stairs.');
    const [token] = ok<SceneToken[]>(await h.inject({ method: 'GET', url: `/api/scenes/${copy.id}/tokens` }));
    expect(token!.id).not.toBe(prepBandit.id);
    expect(token).toMatchObject({
      notes: 'Leader: flees at half HP',
      hp_max: 11,
      hp_current: 7,
      hp_temp: 2,
      ac: 12,
      asset: { notes: 'Bandits: flee when the leader falls.' },
    });

    // Each copy is its own: editing one changes nothing of the other.
    ok<Scene>(await putScene(copy.id, 'Only in the copy.'));
    ok<SceneToken>(await putToken(token!.id, 'Only in the copy.'));
    expect(storedNotes('scene', prep.id)).toBe('The crypt: a trap on the stairs.');
    expect(storedNotes('token', prepBandit.id)).toBe('Leader: flees at half HP');
  });

  it('copies the live scene’s notes too, without telling any room of the copy’s', async () => {
    const { live, bandit, dm, tv } = await table();
    ok<Scene>(await putScene(live.id, 'Live notes.'));
    ok<SceneToken>(await putToken(bandit.id, 'Live token notes.'));
    await dm.settle();
    const copy = ok<Scene>(await h.post(`/api/scenes/${live.id}/duplicate`, { name: 'The bridge (copy)' }), 201);
    expect(copy.notes).toBe('Live notes.');
    const tokens = ok<SceneToken[]>(await h.inject({ method: 'GET', url: `/api/scenes/${copy.id}/tokens` }));
    expect(tokens.map((each) => each.notes).sort()).toEqual(['', 'Live token notes.']);
    ok<Scene>(await putScene(copy.id, 'Not live.'));
    expect(types(await dm.settle())).not.toContain('notes.updated');
    expect(JSON.stringify(await tv.settle())).not.toContain('notes');
  });
});

describe('an asset’s notes beside its tokens’ (specs/03-domain-model.md §10)', () => {
  it('reaches the DM room as a snapshot when a live token’s asset’s notes change, the players room nothing', async () => {
    const { bandit, dm, tv } = await table();
    ok(
      await h.inject({
        method: 'PATCH',
        url: `/api/assets/${bandit.asset_id}`,
        payload: { notes: 'Bandits: surrender when outnumbered.' },
      }),
    );
    const events = await dm.settle();
    expect(types(events)).toEqual(['scene.snapshot']);
    const snapshot = events[0]!.payload as DmSnapshot;
    expect(snapshot.scene!.tokens.find((each) => each.id === bandit.id)!.asset.notes).toBe(
      'Bandits: surrender when outnumbered.',
    );
    expect(await tv.settle()).toEqual([]);
  });

  it('refuses an asset’s notes over the limit', async () => {
    const { bandit } = await table();
    const response = await h.inject({
      method: 'PATCH',
      url: `/api/assets/${bandit.asset_id}`,
      payload: { notes: 'x'.repeat(NOTES_MAX_LENGTH + 1) },
    });
    expect(response.statusCode).toBe(400);
  });
});
