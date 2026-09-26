import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMMAND_TYPES,
  DmSnapshotSchema,
  DmTokenEventPayloadSchema,
  ErrorEnvelopeSchema,
  PlayerSnapshotSchema,
  PlayerTokenAddedPayloadSchema,
  PlayerTokenSchema,
  PlayerTokenUpdatedPayloadSchema,
  PLAYER_VIEW_AUTH,
  TokenRemovedPayloadSchema,
  type DmSnapshot,
  type ErrorEnvelope,
  type EventEnvelope,
  type LibraryAsset,
  type PlayerSnapshot,
  type PlayerToken,
  type Scene,
  type SceneToken,
  type TokenChange,
} from '@emberglass/shared';
import { compileSchema } from '../validation.js';
import { applyPlayerEvent, ok, startLive, type Client, type LiveHarness, type PlayerState } from './testing/harness.js';

// LIV-02: the live commands and the role-filtered projection, against a real SQLite file and real
// Socket.io clients over a real port (specs/04-live-sync.md §2, §3, §4, §5,
// specs/07-security-and-access.md §3, §5, specs/05-assets-and-images.md §3, §4, Q-083, Q-092,
// Q-093, D-108, G-020, G-023, G-025). Images are generated (Q-088).

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const isEnvelope = compileSchema<ErrorEnvelope>(ErrorEnvelopeSchema);
const isDmSnapshot = compileSchema<DmSnapshot>(DmSnapshotSchema);
const isPlayerSnapshot = compileSchema<PlayerSnapshot>(PlayerSnapshotSchema);
const isDmTokenEvent = compileSchema(DmTokenEventPayloadSchema);
const isPlayerAdded = compileSchema(PlayerTokenAddedPayloadSchema);
const isPlayerUpdated = compileSchema(PlayerTokenUpdatedPayloadSchema);
const isRemoved = compileSchema(TokenRemovedPayloadSchema);
const PLAYER_KEYS = Object.keys(PlayerTokenSchema.properties).sort();

let h: LiveHarness;

beforeEach(async () => {
  h = await startLive();
});

afterEach(async () => {
  await h.close();
});

interface World {
  sceneA: Scene;
  sceneB: Scene;
  goblin: LibraryAsset;
  lurker: LibraryAsset;
  kobold: LibraryAsset;
  /** Goblin 1 and Goblin 2, visible, on scene A. */
  goblins: SceneToken[];
  /** A hidden Lurker on scene A. */
  hidden: SceneToken;
}

/** Two scenes with maps; scene A holds two visible goblins and a hidden lurker. Nothing is live. */
async function world(): Promise<World> {
  const mapA = await h.image('map A', 96);
  const mapB = await h.image('map B', 80);
  const sceneA = await h.scene('Lair of the lurker', mapA.id);
  const sceneB = await h.scene('The road', mapB.id);
  const goblin = await h.asset('Goblin');
  const lurker = await h.asset('Lurker', { category: 'monster', default_hidden: true, notes: 'Waits in the dark' });
  const kobold = await h.asset('Kobold', { category: 'monster', default_hidden: true });
  const first = await h.place(sceneA.id, goblin.id, 1, 1);
  const hidden = await h.place(sceneA.id, lurker.id, 2, 2);
  const second = await h.place(sceneA.id, goblin.id, 3, 1);
  const goblins = ok<SceneToken[]>(await h.inject({ method: 'GET', url: `/api/scenes/${sceneA.id}/tokens` })).filter(
    (token) => token.asset_id === goblin.id,
  );
  expect(goblins.map((token) => token.id)).toEqual([first.id, second.id]);
  return { sceneA, sceneB, goblin, lurker, kobold, goblins, hidden };
}

// Every table of the database, read from the schema itself, so a new table cannot escape it.
const dump = () =>
  JSON.stringify(
    (
      h.data.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .pluck()
        .all() as string[]
    ).map((table) => [table, h.data.db.prepare(`SELECT * FROM "${table}"`).all()]),
  );
const liveSceneId = () => h.data.db.prepare('SELECT live_scene_id FROM settings').pluck().get() as string | null;
const tokenRow = (id: string) =>
  h.data.db.prepare('SELECT label, x, y, hidden, z_order FROM token WHERE id = ?').get(id) as
    { label: string; x: number; y: number; hidden: 0 | 1; z_order: number } | undefined;

async function acknowledged(client: Client, type: string, payload: unknown): Promise<void> {
  const ack = await h.command(client, type, payload);
  expect(ack, `${type} ${JSON.stringify(ack)}`).toEqual({ ok: true });
}

async function refused(client: Client, type: string, payload: unknown, code: string): Promise<void> {
  const ack = await h.command(client, type, payload);
  expect(isEnvelope(ack), `${type} ${JSON.stringify(ack)}`).toBe(true);
  expect((ack as ErrorEnvelope).error.code, `${type} ${JSON.stringify(payload)}`).toBe(code);
}

/** A DM socket and a player socket, with scene A made live through the socket. */
async function liveA(w: World): Promise<{ dm: Client; tv: Client }> {
  const dm = await h.connect({ cookie: h.cookie });
  const tv = await h.connect();
  await acknowledged(dm, 'scene.activate', { scene_id: w.sceneA.id });
  expect((await dm.settle()).map((event) => event.type)).toEqual(['scene.snapshot']);
  expect((await tv.settle()).map((event) => event.type)).toEqual(['scene.snapshot']);
  return { dm, tv };
}

const payloadOf = <T>(event: EventEnvelope | undefined): T => event!.payload as T;

// --- payload schemas --------------------------------------------------------------------------

describe('payload schemas (specs/04-live-sync.md §2, specs/07-security-and-access.md §7)', () => {
  it('refuses an invalid payload of every live command in the envelope, changing nothing and telling nobody', async () => {
    const w = await world();
    const { dm, tv } = await liveA(w);
    const token = w.goblins[0]!.id;
    const before = dump();
    const cases: [string, unknown][] = [
      ['token.add', {}],
      ['token.add', { scene_id: w.sceneA.id, asset_id: w.goblin.id, x: 1 }],
      ['token.add', { scene_id: w.sceneA.id, asset_id: w.goblin.id, x: 1, y: 1, hidden: false }],
      ['token.add', { scene_id: w.sceneA.id, asset_id: w.goblin.id, x: 1, y: 1, label: 'Boss' }],
      ['token.add', { scene_id: 'nope', asset_id: w.goblin.id, x: 1, y: 1 }],
      ['token.add', { scene_id: w.sceneA.id, asset_id: w.goblin.id, x: '1', y: 1 }],
      ['token.add', { scene_id: w.sceneA.id, asset_id: w.goblin.id, x: 2e6, y: 1 }],
      ['token.move', { token_id: token, x: 1 }],
      ['token.move', { token_id: token, x: 1, y: 1, z_order: 9 }],
      ['token.move', { token_id: token, x: null, y: 1 }],
      ['token.move', { id: token, x: 1, y: 1 }],
      ['token.setVisibility', { token_id: token }],
      ['token.setVisibility', { token_id: token, hidden: 'yes' }],
      ['token.setVisibility', { token_id: token, hidden: true, label: 'x' }],
      ['token.delete', {}],
      ['token.delete', { token_id: token, confirm: true }],
      ['token.delete', { token_id: token.toUpperCase() }],
      ['scene.activate', {}],
      ['scene.activate', { scene_id: w.sceneB.id, role: 'dm' }],
      ['scene.deactivate', { scene_id: w.sceneA.id }],
    ];
    for (const [type, payload] of cases) await refused(dm, type, payload, 'validation_failed');
    expect(dump()).toEqual(before);
    expect(await dm.settle()).toEqual([]);
    expect(await tv.settle()).toEqual([]);
  });

  it('refuses a command for what does not exist or is not live, changing nothing and telling nobody', async () => {
    const w = await world();
    const { dm, tv } = await liveA(w);
    const inB = await h.place(w.sceneB.id, w.goblin.id, 0, 0);
    const before = dump();
    const unknown = '00000000-0000-4000-8000-00000000abcd';
    await refused(dm, 'token.add', { scene_id: w.sceneB.id, asset_id: w.goblin.id, x: 0, y: 0 }, 'scene_not_live');
    await refused(dm, 'token.add', { scene_id: unknown, asset_id: w.goblin.id, x: 0, y: 0 }, 'scene_not_live');
    await refused(dm, 'token.add', { scene_id: w.sceneA.id, asset_id: unknown, x: 0, y: 0 }, 'reference_not_found');
    await refused(dm, 'token.move', { token_id: inB.id, x: 5, y: 5 }, 'scene_not_live');
    await refused(dm, 'token.setVisibility', { token_id: inB.id, hidden: true }, 'scene_not_live');
    await refused(dm, 'token.delete', { token_id: inB.id }, 'scene_not_live');
    for (const [type, payload] of [
      ['token.move', { token_id: unknown, x: 5, y: 5 }],
      ['token.setVisibility', { token_id: unknown, hidden: true }],
      ['token.delete', { token_id: unknown }],
      ['scene.activate', { scene_id: unknown }],
    ] as const) {
      await refused(dm, type, payload, 'not_found');
    }
    expect(dump()).toEqual(before);
    expect(await dm.settle()).toEqual([]);
    expect(await tv.settle()).toEqual([]);
  });
});

// --- activation -------------------------------------------------------------------------------

describe('scene.activate and scene.deactivate (specs/04-live-sync.md §2, §3, §5, D-039)', () => {
  it('makes a scene live and sends each room a fresh snapshot of its own, taking one version of each', async () => {
    const w = await world();
    const dm = await h.connect({ cookie: h.cookie });
    const other = await h.connect({ cookie: h.cookie });
    const tv = await h.connect();
    await acknowledged(dm, 'scene.activate', { scene_id: w.sceneA.id });
    expect(liveSceneId()).toBe(w.sceneA.id);
    for (const client of [dm, other]) {
      const [event] = await client.settle();
      expect(event).toMatchObject({ type: 'scene.snapshot', version: 2 });
      expect(isDmSnapshot(event!.payload)).toBe(true);
      expect(payloadOf<DmSnapshot>(event).scene?.tokens).toHaveLength(3);
    }
    const [event] = await tv.settle();
    expect(event).toMatchObject({ type: 'scene.snapshot', version: 2 });
    expect(isPlayerSnapshot(event!.payload), JSON.stringify(isPlayerSnapshot.errors)).toBe(true);
    expect(payloadOf<PlayerSnapshot>(event).scene?.tokens.map((token) => token.label)).toEqual([
      'Goblin 1',
      'Goblin 2',
    ]);
    expect(JSON.stringify(event)).not.toContain(w.hidden.id);
  });

  it('replaces the live scene when another is activated, with only its tokens', async () => {
    const w = await world();
    const { dm, tv } = await liveA(w);
    const onB = await h.place(w.sceneB.id, w.kobold.id, 0, 0);
    await acknowledged(dm, 'scene.activate', { scene_id: w.sceneB.id });
    expect(liveSceneId()).toBe(w.sceneB.id);
    const [dmEvent] = await dm.settle();
    expect(payloadOf<DmSnapshot>(dmEvent).scene?.tokens.map((token) => token.id)).toEqual([onB.id]);
    const [tvEvent] = await tv.settle();
    // The kobold is hidden: players see scene B's map and no token.
    expect(payloadOf<PlayerSnapshot>(tvEvent).scene?.tokens).toEqual([]);
    expect(JSON.stringify(tvEvent)).not.toContain(onB.id);
  });

  it('clears the live scene: both rooms receive scene.cleared, and clearing with nothing live tells nobody', async () => {
    const w = await world();
    const { dm, tv } = await liveA(w);
    await acknowledged(dm, 'scene.deactivate', {});
    expect(liveSceneId()).toBeNull();
    expect(await dm.settle()).toEqual([{ type: 'scene.cleared', version: 3, payload: {} }]);
    expect(await tv.settle()).toEqual([{ type: 'scene.cleared', version: 3, payload: {} }]);
    await acknowledged(dm, 'scene.deactivate', {});
    expect(await dm.settle()).toEqual([]);
    expect(await tv.settle()).toEqual([]);
    expect([h.versions.dm.current(), h.versions.players.current()]).toEqual([3, 3]);
  });

  it('keeps preparation REST writes to the live scene refused once it is made live through the socket (D-100)', async () => {
    const w = await world();
    await liveA(w);
    const token = w.goblins[0]!.id;
    const before = dump();
    for (const response of [
      await h.post(`/api/scenes/${w.sceneA.id}/tokens`, { asset_id: w.goblin.id, x: 0, y: 0 }),
      await h.inject({ method: 'PATCH', url: `/api/tokens/${token}`, payload: { x: 9 } }),
      await h.inject({ method: 'PATCH', url: `/api/tokens/${token}`, payload: { label: 'Boss' } }),
      await h.inject({ method: 'DELETE', url: `/api/tokens/${token}` }),
    ]) {
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json<ErrorEnvelope>().error.code).toBe('scene_live');
    }
    expect(dump()).toEqual(before);
  });
});

// --- token commands ---------------------------------------------------------------------------

describe('token commands and what each room receives (specs/04-live-sync.md §2, §3, §4)', () => {
  it('token.add places a visible token for both rooms, and a hidden one for dm only, the players version untouched', async () => {
    const w = await world();
    const { dm, tv } = await liveA(w);
    await acknowledged(dm, 'token.add', { scene_id: w.sceneA.id, asset_id: w.goblin.id, x: 5.5, y: 2 });
    const [added] = await dm.settle();
    expect(added).toMatchObject({ type: 'token.added', version: 3 });
    expect(isDmTokenEvent(added!.payload)).toBe(true);
    const { token } = payloadOf<TokenChange>(added);
    expect(token).toMatchObject({ scene_id: w.sceneA.id, label: 'Goblin 3', x: 5.5, y: 2, hidden: false });
    expect(tokenRow(token.id)).toMatchObject({ label: 'Goblin 3', x: 5.5, y: 2, hidden: 0 });
    const [shown] = await tv.settle();
    expect(shown).toMatchObject({ type: 'token.added', version: 3 });
    expect(isPlayerAdded(shown!.payload)).toBe(true);
    const sent = payloadOf<{ token: PlayerToken; relabelled: PlayerToken[] }>(shown);
    expect(Object.keys(sent.token).sort()).toEqual(PLAYER_KEYS);
    // On top of the two visible goblins: rank 2, whatever the hidden lurker's stored order.
    expect(sent).toEqual({
      token: { id: token.id, x: 5.5, y: 2, size: 'medium', image_id: w.goblin.image_id, z_order: 2, label: 'Goblin 3' },
      relabelled: [],
    });

    await acknowledged(dm, 'token.add', { scene_id: w.sceneA.id, asset_id: w.lurker.id, x: 7, y: 7 });
    const [secret] = await dm.settle();
    expect(secret).toMatchObject({ type: 'token.added', version: 4 });
    const lurker = payloadOf<TokenChange>(secret).token;
    // Placed hidden, it keeps the bare name (Q-092).
    expect(lurker).toMatchObject({ hidden: true, label: 'Lurker' });
    expect(tokenRow(lurker.id)).toMatchObject({ hidden: 1 });
    expect(await tv.settle()).toEqual([]);
    expect([h.versions.dm.current(), h.versions.players.current()]).toEqual([4, 3]);
  });

  it('token.move moves a token for both rooms when visible, and for dm only when hidden', async () => {
    const w = await world();
    const { dm, tv } = await liveA(w);
    const [goblin] = w.goblins;
    await acknowledged(dm, 'token.move', { token_id: goblin!.id, x: 8.25, y: -1 });
    expect(tokenRow(goblin!.id)).toMatchObject({ x: 8.25, y: -1 });
    const [moved] = await dm.settle();
    expect(moved).toMatchObject({ type: 'token.updated', payload: { token: { id: goblin!.id, x: 8.25, y: -1 } } });
    const [seen] = await tv.settle();
    expect(seen?.type).toBe('token.updated');
    expect(isPlayerUpdated(seen!.payload)).toBe(true);
    expect(payloadOf<{ token: PlayerToken }>(seen).token).toEqual({
      id: goblin!.id,
      x: 8.25,
      y: -1,
      size: 'medium',
      image_id: w.goblin.image_id,
      z_order: 0,
      label: 'Goblin 1',
    });

    await acknowledged(dm, 'token.move', { token_id: w.hidden.id, x: 4, y: 4 });
    expect(tokenRow(w.hidden.id)).toMatchObject({ x: 4, y: 4 });
    expect((await dm.settle()).map((event) => event.type)).toEqual(['token.updated']);
    expect(await tv.settle()).toEqual([]);
  });

  it('keeps a revealed token at its place in the stacking order, not brought to the front (Q-095, G-030)', async () => {
    const w = await world();
    const { dm, tv } = await liveA(w);
    const stored = tokenRow(w.hidden.id)!.z_order;
    await acknowledged(dm, 'token.setVisibility', { token_id: w.hidden.id, hidden: false });
    await dm.settle();
    const [reveal] = await tv.settle();
    // Between the two goblins, as a fresh snapshot shows it; a token placed live would be rank 2.
    expect(payloadOf<{ token: PlayerToken }>(reveal).token.z_order).toBe(1);
    expect(tokenRow(w.hidden.id)!.z_order).toBe(stored);
    const [fresh] = await tv.settle().then(() => tv.events.slice(-1));
    expect((fresh!.payload as PlayerSnapshot).scene?.tokens.map((token) => token.id)).toEqual([
      w.goblins[0]!.id,
      w.hidden.id,
      w.goblins[1]!.id,
    ]);
  });

  it('token.setVisibility reveals as token.added and hides as token.removed to players, exactly what deleting sends (Q-083)', async () => {
    const w = await world();
    const { dm, tv } = await liveA(w);
    await acknowledged(dm, 'token.setVisibility', { token_id: w.hidden.id, hidden: false });
    expect(tokenRow(w.hidden.id)).toMatchObject({ hidden: 0, label: 'Lurker' });
    const [dmReveal] = await dm.settle();
    expect(dmReveal).toMatchObject({ type: 'token.updated', payload: { token: { id: w.hidden.id, hidden: false } } });
    const [reveal] = await tv.settle();
    expect(reveal?.type).toBe('token.added');
    // Its stored order lies between the goblins, so it goes in at rank 1.
    expect(payloadOf<{ token: PlayerToken }>(reveal).token).toMatchObject({
      id: w.hidden.id,
      z_order: 1,
      label: 'Lurker',
    });

    await acknowledged(dm, 'token.setVisibility', { token_id: w.hidden.id, hidden: true });
    expect(tokenRow(w.hidden.id)).toMatchObject({ hidden: 1 });
    expect((await dm.settle()).map((event) => event.type)).toEqual(['token.updated']);
    const [hide] = await tv.settle();

    await acknowledged(dm, 'token.delete', { token_id: w.goblins[1]!.id });
    expect((await dm.settle()).map((event) => event.type)).toEqual(['token.removed']);
    const [remove] = await tv.settle();
    for (const [event, id] of [
      [hide, w.hidden.id],
      [remove, w.goblins[1]!.id],
    ] as const) {
      expect(isRemoved(event!.payload)).toBe(true);
      expect({ type: event!.type, payload: event!.payload }).toEqual({ type: 'token.removed', payload: { id } });
    }

    // Hiding what is hidden, or revealing what is visible, changes nothing, so nobody is told.
    const versions = [h.versions.dm.current(), h.versions.players.current()];
    await acknowledged(dm, 'token.setVisibility', { token_id: w.hidden.id, hidden: true });
    await acknowledged(dm, 'token.setVisibility', { token_id: w.goblins[0]!.id, hidden: false });
    expect(await dm.settle()).toEqual([]);
    expect(await tv.settle()).toEqual([]);
    expect([h.versions.dm.current(), h.versions.players.current()]).toEqual(versions);
  });

  it('token.delete removes a token for both rooms when visible, and for dm only when hidden', async () => {
    const w = await world();
    const { dm, tv } = await liveA(w);
    await acknowledged(dm, 'token.delete', { token_id: w.goblins[0]!.id });
    expect(tokenRow(w.goblins[0]!.id)).toBeUndefined();
    expect(await dm.settle()).toEqual([{ type: 'token.removed', version: 3, payload: { id: w.goblins[0]!.id } }]);
    expect(await tv.settle()).toEqual([{ type: 'token.removed', version: 3, payload: { id: w.goblins[0]!.id } }]);
    await acknowledged(dm, 'token.delete', { token_id: w.hidden.id });
    expect(tokenRow(w.hidden.id)).toBeUndefined();
    expect(await dm.settle()).toEqual([{ type: 'token.removed', version: 4, payload: { id: w.hidden.id } }]);
    expect(await tv.settle()).toEqual([]);
    expect([h.versions.dm.current(), h.versions.players.current()]).toEqual([4, 3]);
  });

  it('sends the players room payloads whose tokens carry exactly the player fields, and dm payloads in the DM shape', async () => {
    const w = await world();
    const { dm, tv } = await liveA(w);
    await acknowledged(dm, 'token.add', { scene_id: w.sceneA.id, asset_id: w.goblin.id, x: 0, y: 0 });
    await acknowledged(dm, 'token.move', { token_id: w.goblins[0]!.id, x: 2, y: 2 });
    await acknowledged(dm, 'token.setVisibility', { token_id: w.hidden.id, hidden: false });
    await acknowledged(dm, 'token.setVisibility', { token_id: w.hidden.id, hidden: true });
    await acknowledged(dm, 'token.delete', { token_id: w.goblins[1]!.id });
    const players = await tv.settle();
    expect(players.map((event) => event.type)).toEqual([
      'token.added',
      'token.updated',
      'token.added',
      'token.removed',
      'token.removed',
    ]);
    for (const event of players) {
      const payload = event.payload as { token?: object; relabelled?: object[] };
      for (const token of [payload.token, ...(payload.relabelled ?? [])].filter(Boolean)) {
        expect(Object.keys(token!).sort()).toEqual(PLAYER_KEYS);
      }
      const text = JSON.stringify(event);
      for (const forbidden of ['"hidden"', '"asset', '"scene_id"', '"character_id"', w.goblin.id, w.sceneA.id]) {
        expect(text, forbidden).not.toContain(forbidden);
      }
    }
    for (const event of (await dm.settle()).filter((each) => each.type !== 'token.removed')) {
      expect(isDmTokenEvent(event.payload), JSON.stringify(event)).toBe(true);
    }
  });
});

// --- concurrency, versions and the players' copy ------------------------------------------------

describe('last write wins and versions over the wire (specs/04-live-sync.md §2, §5, Q-093, D-108)', () => {
  it('ends two DM sockets conflicting moves on the one applied last, which both sockets see last', async () => {
    const w = await world();
    const { dm, tv } = await liveA(w);
    const other = await h.connect({ cookie: h.cookie });
    const goblin = w.goblins[0]!.id;
    const acks = [];
    for (let i = 0; i < 10; i++) {
      acks.push(h.command(dm, 'token.move', { token_id: goblin, x: i, y: 0 }));
      acks.push(h.command(other, 'token.move', { token_id: goblin, x: 100 + i, y: 1 }));
    }
    for (const ack of await Promise.all(acks)) expect(ack).toEqual({ ok: true });
    const seenByDm = await dm.settle();
    const seenByOther = await other.settle();
    expect(seenByDm).toHaveLength(20);
    expect(seenByOther).toEqual(seenByDm);
    const last = payloadOf<TokenChange>(seenByDm.at(-1)).token;
    expect(tokenRow(goblin)).toMatchObject({ x: last.x, y: last.y });
    const lastSeenByTv = (await tv.settle()).at(-1);
    expect(payloadOf<{ token: PlayerToken }>(lastSeenByTv).token).toMatchObject({ x: last.x, y: last.y });
  });

  it('delivers the events of its own command to the sender before the acknowledgement', async () => {
    const w = await world();
    const { dm } = await liveA(w);
    const before = dm.events.length;
    const heldAtAck = await new Promise<number>((resolve) => {
      dm.socket.emit('command', { type: 'token.move', payload: { token_id: w.goblins[0]!.id, x: 2, y: 2 } }, () =>
        resolve(dm.events.length),
      );
    });
    expect(heldAtAck - before).toBe(1);
    expect(dm.events.at(-1)?.type).toBe('token.updated');
  });

  it('gives each room ascending versions without a hole across real events, hidden ones advancing dm only', async () => {
    const w = await world();
    const { dm, tv } = await liveA(w);
    const steps: [string, unknown][] = [
      ['token.add', { scene_id: w.sceneA.id, asset_id: w.lurker.id, x: 1, y: 1 }],
      ['token.move', { token_id: w.hidden.id, x: 3, y: 3 }],
      ['token.move', { token_id: w.goblins[0]!.id, x: 3, y: 3 }],
      ['token.add', { scene_id: w.sceneA.id, asset_id: w.goblin.id, x: 1, y: 1 }],
      ['token.setVisibility', { token_id: w.hidden.id, hidden: false }],
      ['token.setVisibility', { token_id: w.hidden.id, hidden: true }],
      ['token.delete', { token_id: w.hidden.id }],
      ['scene.activate', { scene_id: w.sceneB.id }],
      ['scene.deactivate', {}],
    ];
    for (const [type, payload] of steps) await acknowledged(dm, type, payload);
    const dmVersions = (await dm.settle()).map((event) => event.version);
    const tvVersions = (await tv.settle()).map((event) => event.version);
    expect(dmVersions).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // Players never heard of the lurker's add and move, nor of the hidden token's deletion.
    expect(tvVersions).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it('keeps a player copy built from the snapshot and the events equal to a fresh snapshot after every step (G-025)', async () => {
    const w = await world();
    const { dm, tv } = await liveA(w);
    const last = tv.events.at(-1)!;
    let state: PlayerState = applyPlayerEvent({ version: 0, scene: null }, last);
    const steps: [string, unknown][] = [
      ['token.setVisibility', { token_id: w.hidden.id, hidden: false }],
      ['token.add', { scene_id: w.sceneA.id, asset_id: w.kobold.id, x: 1, y: 1 }],
      ['token.add', { scene_id: w.sceneA.id, asset_id: w.goblin.id, x: 4, y: 4 }],
      ['token.setVisibility', { token_id: w.goblins[0]!.id, hidden: true }],
      ['token.move', { token_id: w.goblins[1]!.id, x: 6, y: 6 }],
      ['token.setVisibility', { token_id: w.goblins[0]!.id, hidden: false }],
      ['token.delete', { token_id: w.hidden.id }],
    ];
    for (const [type, payload] of steps) {
      await acknowledged(dm, type, payload);
      for (const event of await tv.settle()) state = applyPlayerEvent(state, event);
      // settle asked for a snapshot: the copy must equal it.
      const fresh = tv.events.at(-1)!;
      expect(fresh.version).toBe(state.version);
      expect(state.scene, type).toEqual((fresh.payload as PlayerSnapshot).scene);
    }
  });
});

// --- numbering on the live scene (G-023, Q-092) ---------------------------------------------------

describe('numbering on the live scene (specs/05-assets-and-images.md §3, G-023, Q-092)', () => {
  it('shows "Goblin 1" and "Goblin 2" on a player socket when a second goblin is revealed live', async () => {
    const w = await world();
    // Goblins that start hidden: placed hidden, each keeps the bare name until shown.
    const hiddenGoblin = await h.asset('Goblin', { category: 'monster', default_hidden: true });
    const a = await h.place(w.sceneB.id, hiddenGoblin.id, 1, 1);
    const b = await h.place(w.sceneB.id, hiddenGoblin.id, 2, 1);
    const dm = await h.connect({ cookie: h.cookie });
    const tv = await h.connect();
    await acknowledged(dm, 'scene.activate', { scene_id: w.sceneB.id });
    await tv.settle();
    let state: PlayerState = applyPlayerEvent({ version: 0, scene: null }, tv.events.at(-1)!);

    await acknowledged(dm, 'token.setVisibility', { token_id: a.id, hidden: false });
    const [first] = await tv.settle();
    expect(payloadOf<{ token: PlayerToken }>(first).token.label).toBe('Goblin');
    state = applyPlayerEvent(state, first!);

    await acknowledged(dm, 'token.setVisibility', { token_id: b.id, hidden: false });
    const [second] = await tv.settle();
    expect(second?.type).toBe('token.added');
    expect(payloadOf<{ token: PlayerToken; relabelled: PlayerToken[] }>(second)).toMatchObject({
      token: { id: b.id, label: 'Goblin 2' },
      relabelled: [{ id: a.id, label: 'Goblin 1' }],
    });
    state = applyPlayerEvent(state, second!);
    expect(state.scene?.tokens.map((token) => token.label)).toEqual(['Goblin 1', 'Goblin 2']);
    // The DM room hears of the rename too, and the database agrees.
    const dmEvents = await dm.settle();
    expect(payloadOf<TokenChange>(dmEvents.at(-1)).relabelled.map((token) => token.label)).toEqual(['Goblin 1']);
    expect([tokenRow(a.id)?.label, tokenRow(b.id)?.label]).toEqual(['Goblin 1', 'Goblin 2']);
  });

  it('renames the lone visible goblin in both rooms when a second is added visible live', async () => {
    const w = await world();
    const lone = await h.place(w.sceneB.id, w.goblin.id, 0, 0);
    expect(lone.label).toBe('Goblin');
    const dm = await h.connect({ cookie: h.cookie });
    const tv = await h.connect();
    await acknowledged(dm, 'scene.activate', { scene_id: w.sceneB.id });
    await tv.settle();
    await acknowledged(dm, 'token.add', { scene_id: w.sceneB.id, asset_id: w.goblin.id, x: 1, y: 0 });
    const [event] = await tv.settle();
    expect(payloadOf<{ token: PlayerToken; relabelled: PlayerToken[] }>(event)).toMatchObject({
      token: { label: 'Goblin 2', z_order: 1 },
      relabelled: [{ id: lone.id, label: 'Goblin 1', z_order: 0 }],
    });
  });

  it('never counts a hidden token the DM relabelled, nor one whose asset was renamed (Q-094)', async () => {
    const w = await world();
    const shade = await h.asset('Shade', { category: 'monster', default_hidden: true });
    const boss = await h.place(w.sceneB.id, shade.id, 0, 0);
    const lurking = await h.place(w.sceneB.id, shade.id, 1, 0);
    ok(await h.inject({ method: 'PATCH', url: `/api/tokens/${boss.id}`, payload: { label: 'Boss' } }));
    const dm = await h.connect({ cookie: h.cookie });
    const tv = await h.connect();
    await acknowledged(dm, 'scene.activate', { scene_id: w.sceneB.id });
    await tv.settle();
    // Renamed while live: the bare-named hidden token follows, the label the DM typed stays.
    ok(
      await h.inject({
        method: 'PATCH',
        url: `/api/assets/${shade.id}`,
        payload: { name: 'Wraith', default_hidden: false },
      }),
    );
    expect([tokenRow(boss.id)?.label, tokenRow(lurking.id)?.label]).toEqual(['Boss', 'Wraith']);
    await acknowledged(dm, 'token.add', { scene_id: w.sceneB.id, asset_id: shade.id, x: 2, y: 0 });
    const [first] = await tv.settle();
    expect(payloadOf<{ token: PlayerToken; relabelled: PlayerToken[] }>(first)).toMatchObject({
      token: { label: 'Wraith' },
      relabelled: [],
    });
  });

  it('tells players nothing, and renames nothing, when a hidden goblin joins a lone visible one live (Q-092)', async () => {
    const w = await world();
    const hiddenGoblin = await h.asset('Goblin', { category: 'monster', default_hidden: true });
    const lone = await h.place(w.sceneB.id, w.goblin.id, 0, 0);
    const dm = await h.connect({ cookie: h.cookie });
    const tv = await h.connect();
    await acknowledged(dm, 'scene.activate', { scene_id: w.sceneB.id });
    await tv.settle();
    await acknowledged(dm, 'token.add', { scene_id: w.sceneB.id, asset_id: hiddenGoblin.id, x: 1, y: 0 });
    expect(await tv.settle()).toEqual([]);
    expect(tokenRow(lone.id)?.label).toBe('Goblin');
  });
});

// --- the gates of specs/10-testing-acceptance.md §3 ---------------------------------------------

describe('player commands (specs/10-testing-acceptance.md §3, specs/07-security-and-access.md §3, Q-068)', () => {
  it('@gate:player-command-rejection refuses every command type from the players room over the wire and changes nothing', async () => {
    const w = await world();
    const { dm, tv } = await liveA(w);
    // The TV of the DM's own laptop, which carries the DM cookie but asks to be a player (D-105).
    const laptopTv = await h.connect({ cookie: h.cookie }, { ...PLAYER_VIEW_AUTH });
    const valid: Record<string, unknown> = {
      'token.add': { scene_id: w.sceneA.id, asset_id: w.goblin.id, x: 1, y: 1 },
      'token.move': { token_id: w.goblins[0]!.id, x: 9, y: 9 },
      'token.delete': { token_id: w.goblins[0]!.id },
      'token.setVisibility': { token_id: w.hidden.id, hidden: false },
      'scene.activate': { scene_id: w.sceneB.id },
      'scene.deactivate': {},
      'camera.setPlayer': {},
      'ruler.update': {},
      'ruler.clear': {},
      undo: {},
    };
    expect(Object.keys(valid).sort()).toEqual([...COMMAND_TYPES].sort());
    const before = dump();
    const versions = [h.versions.dm.current(), h.versions.players.current()];
    for (const player of [tv, laptopTv]) {
      for (const type of COMMAND_TYPES) await refused(player, type, valid[type], 'forbidden');
      for (const raw of [null, 'scene.deactivate', { type: 'scene.deactivate' }, [valid['scene.deactivate']]]) {
        const ack = (await player.socket.timeout(5_000).emitWithAck('command', raw)) as unknown;
        expect((ack as ErrorEnvelope).error.code).toBe('forbidden');
      }
    }
    expect(dump()).toEqual(before);
    expect([h.versions.dm.current(), h.versions.players.current()]).toEqual(versions);
    for (const client of [dm, tv, laptopTv]) expect(await client.settle()).toEqual([]);
    // The same commands from the DM socket do run: the refusal is the room's, not the content's.
    await acknowledged(dm, 'token.move', valid['token.move']);
    expect(tokenRow(w.goblins[0]!.id)).toMatchObject({ x: 9, y: 9 });
  });
});

describe('image entitlement follows the live scene (specs/07-security-and-access.md §5, specs/10-testing-acceptance.md §3, G-020)', () => {
  const fetchAs = (id: string, variant = 'display', cookie?: string) =>
    h.app.inject({ method: 'GET', url: `/images/${id}/${variant}`, headers: cookie ? { cookie } : {} });
  const status = async (id: string, variant = 'display') => (await fetchAs(id, variant)).statusCode;

  it('@gate:image-revocation refuses an image a player fetched once its token is hidden, the scene deactivated or replaced, or the map replaced', async () => {
    const mapA = await h.image('revocation map A', 96);
    const mapB = await h.image('revocation map B', 80);
    const sceneA = await h.scene('A', mapA.id);
    const sceneB = await h.scene('B', mapB.id);
    const knight = await h.asset('Knight');
    const shade = await h.asset('Shade', { category: 'monster', default_hidden: true });
    const knightToken = await h.place(sceneA.id, knight.id, 1, 1);
    const shadeToken = await h.place(sceneA.id, shade.id, 2, 2);
    const dm = await h.connect({ cookie: h.cookie });

    // Nothing is live: nothing is fetchable without a DM session, which fetches everything.
    for (const id of [mapA.id, knight.image_id, shade.image_id]) {
      expect(await status(id)).toBe(404);
      expect((await fetchAs(id, 'original', h.cookie)).statusCode).toBe(200);
    }

    await acknowledged(dm, 'scene.activate', { scene_id: sceneA.id });
    expect(await status(mapA.id)).toBe(200);
    expect(await status(knight.image_id)).toBe(200);
    // Only the display version, and never a hidden token's image.
    for (const variant of ['original', 'thumbnail']) {
      expect(await status(mapA.id, variant)).toBe(404);
      expect(await status(knight.image_id, variant)).toBe(404);
    }
    expect(await status(shade.image_id)).toBe(404);
    expect(await status(mapB.id)).toBe(404);

    // Hiding its token revokes the image at once; revealing grants it again.
    await acknowledged(dm, 'token.setVisibility', { token_id: knightToken.id, hidden: true });
    expect(await status(knight.image_id)).toBe(404);
    await acknowledged(dm, 'token.setVisibility', { token_id: shadeToken.id, hidden: false });
    expect(await status(shade.image_id)).toBe(200);
    await acknowledged(dm, 'token.setVisibility', { token_id: knightToken.id, hidden: false });
    expect(await status(knight.image_id)).toBe(200);

    // Deactivating revokes the map and every token image.
    await acknowledged(dm, 'scene.deactivate', {});
    for (const id of [mapA.id, knight.image_id, shade.image_id]) expect(await status(id)).toBe(404);

    // Activating another scene revokes the first one's.
    await acknowledged(dm, 'scene.activate', { scene_id: sceneA.id });
    expect(await status(mapA.id)).toBe(200);
    await acknowledged(dm, 'scene.activate', { scene_id: sceneB.id });
    expect(await status(mapB.id)).toBe(200);
    for (const id of [mapA.id, knight.image_id, shade.image_id]) expect(await status(id)).toBe(404);

    // Replacing the live map revokes the old one although another scene still uses it (G-020).
    await acknowledged(dm, 'scene.activate', { scene_id: sceneA.id });
    const other = await h.scene('Uses map A too', mapA.id);
    expect(other.map_image_id).toBe(mapA.id);
    expect(await status(mapA.id)).toBe(200);
    ok<Scene>(await h.inject({ method: 'PATCH', url: `/api/scenes/${sceneA.id}`, payload: { map_image_id: mapB.id } }));
    expect(await status(mapA.id)).toBe(404);
    expect(await status(mapB.id)).toBe(200);
    // Deleting the visible token revokes its image too.
    await acknowledged(dm, 'token.delete', { token_id: knightToken.id });
    expect(await status(knight.image_id)).toBe(404);
  });

  it('answers a revoked image exactly as an image that never existed', async () => {
    const w = await world();
    const { dm } = await liveA(w);
    const comparable = async (id: string) => {
      const response = await fetchAs(id);
      const headers: Record<string, unknown> = { ...response.headers };
      delete headers.date;
      return { status: response.statusCode, headers, body: response.body };
    };
    const never = await comparable('0'.repeat(64));
    expect(await comparable(w.lurker.image_id)).toEqual(never);
    await acknowledged(dm, 'token.delete', { token_id: w.goblins[0]!.id });
    await acknowledged(dm, 'token.delete', { token_id: w.goblins[1]!.id });
    expect(await comparable(w.goblin.image_id)).toEqual(never);
  });
});
