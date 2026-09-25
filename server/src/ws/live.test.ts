import type { AddressInfo } from 'node:net';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import sharp from 'sharp';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DmSnapshotSchema,
  ErrorEnvelopeSchema,
  PlayerSnapshotSchema,
  PlayerTokenSchema,
  SOCKET_CHANNELS,
  SOCKET_PATH,
  type CommandAck,
  type DmSnapshot,
  type ErrorEnvelope,
  type EventEnvelope,
  type Image,
  type LibraryAsset,
  type PlayerSnapshot,
  type Scene,
  type SceneSnapshot,
  type SnapshotEvent,
  type TokenChange,
} from '@emberglass/shared';
import { createVersionCounter, type VersionCounter } from '../domain/version.js';
import { buildTestApp, createTestData, dmCookie, setUpPin, type TestData } from '../http/testing/app.js';
import { type LogFields, type Logger } from '../log/logger.js';
import { compileSchema } from '../validation.js';

// LIV-01: the WebSocket rooms, snapshots and versions, against a real SQLite file and a real
// Socket.io client over a real port (specs/04-live-sync.md §1, §2, §4, §5, §6,
// specs/07-security-and-access.md §2, §3, §7, §8; D-064, D-104, G-011). Images are generated (Q-088).

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const isPlayerSnapshot = compileSchema<PlayerSnapshot>(PlayerSnapshotSchema);
const isDmSnapshot = compileSchema<DmSnapshot>(DmSnapshotSchema);
const isEnvelope = compileSchema<ErrorEnvelope>(ErrorEnvelopeSchema);

interface Line {
  level: string;
  event: string;
  msg: string;
  fields?: LogFields | undefined;
}

let data: TestData;
let app: FastifyInstance;
let cookie: string;
let url: string;
let version: VersionCounter;
let lines: Line[];
const clients: ClientSocket[] = [];

const recording = (): Logger => ({
  info: (event, msg, fields) => lines.push({ level: 'info', event, msg, fields }),
  warn: (event, msg, fields) => lines.push({ level: 'warn', event, msg, fields }),
  error: (event, msg, fields) => lines.push({ level: 'error', event, msg, fields }),
});

async function start(options: Parameters<typeof buildTestApp>[1] = {}): Promise<void> {
  lines = [];
  version = createVersionCounter();
  app = await buildTestApp(data, { logger: recording(), version, ...options });
  // A restarted server on the same data directory already has its PIN: sign in with it.
  const { pin_set } = (await app.inject({ method: 'GET', url: '/api/setup' })).json<{ pin_set: boolean }>();
  cookie = pin_set
    ? dmCookie(await app.inject({ method: 'POST', url: '/api/auth', payload: { pin: '4826' } }))
    : await setUpPin(app, '4826');
  await app.listen({ port: 0, host: '127.0.0.1' });
  url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  data = createTestData('emberglass-live-');
  await start();
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  await app.close();
  data.remove();
});

interface Connected {
  socket: ClientSocket;
  events: EventEnvelope[];
  /** The next event, whatever arrived before it. */
  next(): Promise<EventEnvelope>;
  first: SnapshotEvent;
}

/** A client as a browser on this server would connect: its Origin is the server unless told otherwise. */
async function connect(headers: Record<string, string | undefined> = {}): Promise<Connected> {
  const extraHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries({ origin: url, ...headers }))
    if (value !== undefined) extraHeaders[name] = value;
  const socket = connectClient(url, {
    path: SOCKET_PATH,
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    extraHeaders,
  });
  clients.push(socket);
  const events: EventEnvelope[] = [];
  const waiting: ((event: EventEnvelope) => void)[] = [];
  socket.on(SOCKET_CHANNELS.event, (event: EventEnvelope) => {
    events.push(event);
    waiting.shift()?.(event);
  });
  const next = () => new Promise<EventEnvelope>((resolve) => waiting.push(resolve));
  const first = await new Promise<SnapshotEvent>((resolve, reject) => {
    waiting.push((event) => resolve(event as SnapshotEvent));
    socket.once('connect_error', reject);
  });
  return { socket, events, next, first };
}

const refused = (headers: Record<string, string | undefined>) =>
  connect(headers).then(
    () => 'connected',
    (error: Error) => error.message,
  );

const command = (socket: ClientSocket, raw: unknown) =>
  socket.timeout(5_000).emitWithAck(SOCKET_CHANNELS.command, raw) as Promise<CommandAck>;

const requestSnapshot = async (client: Connected): Promise<SnapshotEvent> => {
  const arriving = client.next();
  const ack: unknown = await client.socket.timeout(5_000).emitWithAck(SOCKET_CHANNELS.snapshot);
  expect(ack).toEqual({ ok: true });
  return (await arriving) as SnapshotEvent;
};

function disconnected(socket: ClientSocket): Promise<string> {
  return new Promise((resolve) => socket.once('disconnect', (reason) => resolve(reason)));
}

/** Resolves with 'pending' if `promise` has not settled within `ms`. */
const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), ms))]);

// --- the data of a live scene, prepared over REST --------------------------------------------

let seed = 0;
const inject = (options: InjectOptions, as = cookie) =>
  app.inject({ ...options, headers: { cookie: as, ...(options.headers as Record<string, string> | undefined) } });
const post = (target: string, payload: unknown, as = cookie) =>
  inject({ method: 'POST', url: target, payload: payload as object }, as);

function ok<T>(response: LightMyRequestResponse, status = 200): T {
  expect(response.statusCode, response.body).toBe(status);
  return (status === 204 ? undefined : response.json<T>()) as T;
}

async function image(width = 64): Promise<Image> {
  const png = await sharp({ create: { width, height: 48, channels: 3, background: { r: seed++ % 256, g: 9, b: 3 } } })
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
    await post('/api/assets', { name, image_id, category: 'npc', size: 'medium', ...fields }),
    201,
  );
}

interface LiveFixture {
  scene: Scene;
  map: Image;
  goblin: LibraryAsset;
  lurker: LibraryAsset;
  visible: TokenChange['token'][];
  hidden: TokenChange['token'];
}

/** A scene with a map, a visible token under and over a hidden one, made live in the database. */
async function liveScene(): Promise<LiveFixture> {
  const campaign = ok<{ id: string }>(await post('/api/campaigns', { name: 'Secret campaign' }), 201);
  const session = ok<{ id: string }>(await post(`/api/campaigns/${campaign.id}/sessions`, { title: 'Night one' }), 201);
  const created = ok<Scene>(await post(`/api/sessions/${session.id}/scenes`, { name: 'Lair of the lurker' }), 201);
  const map = await image(96);
  const scene = ok<Scene>(
    await inject({ method: 'PATCH', url: `/api/scenes/${created.id}`, payload: { map_image_id: map.id } }),
  );
  const goblin = await asset('Goblin');
  const lurker = await asset('Lurker', { category: 'monster', default_hidden: true, notes: 'Waits in the dark' });
  const place = async (assetId: string, x: number, y: number) =>
    ok<TokenChange>(await post(`/api/scenes/${scene.id}/tokens`, { asset_id: assetId, x, y }), 201).token;
  const under = await place(goblin.id, 1, 1);
  const hidden = await place(lurker.id, 2.5, 3);
  const over = await place(goblin.id, 4, 1);
  expect(hidden.hidden).toBe(true);
  data.db.prepare('UPDATE settings SET live_scene_id = ?').run(scene.id);
  return { scene, map, goblin, lurker, visible: [under, over], hidden };
}

// --- rooms ------------------------------------------------------------------------------------

describe('rooms from the DM session only (specs/04-live-sync.md §1, Q-046)', () => {
  it('puts a socket with the DM cookie in dm and one without in players', async () => {
    const dm = await connect({ cookie });
    const player = await connect();
    expect(dm.first.payload.role).toBe('dm');
    expect(player.first.payload.role).toBe('players');
    expect(app.live.count('dm')).toBe(1);
    expect(app.live.count('players')).toBe(1);
  });

  it('puts a forged cookie, a malformed one and an ended session in players', async () => {
    const forged = await connect({ cookie: `emberglass_dm=${'ab'.repeat(32)}` });
    const malformed = await connect({ cookie: 'emberglass_dm=dm; role=dm' });
    const signedOut = dmCookie(await app.inject({ method: 'POST', url: '/api/auth', payload: { pin: '4826' } }));
    ok(await inject({ method: 'DELETE', url: '/api/auth' }, signedOut), 204);
    const ended = await connect({ cookie: signedOut });
    for (const client of [forged, malformed, ended]) expect(client.first.payload.role).toBe('players');
    expect(app.live.count('dm')).toBe(0);
    expect(app.live.count('players')).toBe(3);
  });

  it('gives no weight to a role the client declares in the handshake', async () => {
    const socket = connectClient(url, {
      path: SOCKET_PATH,
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      extraHeaders: { origin: url },
      auth: { role: 'dm', session: 'dm' },
      query: { role: 'dm' },
    });
    clients.push(socket);
    const first = await new Promise<SnapshotEvent>((resolve) => socket.once(SOCKET_CHANNELS.event, resolve));
    expect(first.payload.role).toBe('players');
  });
});

describe('the handshake Origin (specs/07-security-and-access.md §2, Q-043)', () => {
  it('refuses an Origin that is not this server, and accepts this server or none', async () => {
    const port = (app.server.address() as AddressInfo).port;
    for (const origin of [
      'http://evil.example',
      `http://127.0.0.1:${port + 1}`,
      `https://127.0.0.1:${port}`,
      'null',
      'not a url',
    ]) {
      expect(await refused({ origin, cookie }), origin).not.toBe('connected');
    }
    expect(app.live.count('dm') + app.live.count('players')).toBe(0);
    expect(await refused({ origin: url })).toBe('connected');
    expect(await refused({ origin: undefined })).toBe('connected');
  });
});

// --- snapshots --------------------------------------------------------------------------------

describe('snapshots for each role (specs/04-live-sync.md §3, §4, §5)', () => {
  it('sends each role the idle state while nothing is live', async () => {
    const dm = await connect({ cookie });
    const player = await connect();
    expect(dm.first).toEqual({ type: 'scene.snapshot', version: 1, payload: { role: 'dm', scene: null } });
    expect(player.first).toEqual({ type: 'scene.snapshot', version: 1, payload: { role: 'players', scene: null } });
  });

  it('sends the DM the full live scene, every token included', async () => {
    const live = await liveScene();
    const { payload } = (await connect({ cookie })).first;
    expect(isDmSnapshot(payload), JSON.stringify(isDmSnapshot.errors)).toBe(true);
    const snapshot = payload as DmSnapshot;
    expect(snapshot.scene?.scene).toEqual(live.scene);
    expect(snapshot.scene?.map?.id).toBe(live.map.id);
    expect(snapshot.scene?.tokens.map((token) => token.id)).toEqual([
      live.visible[0]!.id,
      live.hidden.id,
      live.visible[1]!.id,
    ]);
    expect(snapshot.scene?.tokens.find((token) => token.id === live.hidden.id)?.hidden).toBe(true);
  });

  it('gives players visible tokens only, with player fields only', async () => {
    const live = await liveScene();
    const { payload } = (await connect()).first;
    expect(isPlayerSnapshot(payload), JSON.stringify(isPlayerSnapshot.errors)).toBe(true);
    const snapshot = payload as PlayerSnapshot;
    const tokens = snapshot.scene!.tokens;
    expect(tokens).toEqual([
      {
        id: live.visible[0]!.id,
        x: 1,
        y: 1,
        size: 'medium',
        image_id: live.goblin.image_id,
        z_order: 0,
        label: 'Goblin 1',
      },
      {
        id: live.visible[1]!.id,
        x: 4,
        y: 1,
        size: 'medium',
        image_id: live.goblin.image_id,
        z_order: 1,
        label: 'Goblin 2',
      },
    ]);
    for (const token of tokens)
      expect(Object.keys(token).sort()).toEqual(Object.keys(PlayerTokenSchema.properties).sort());

    // Nothing from which the hidden token can be learnt: no id, asset, image, name or notes;
    // nothing of the scene record, the session or the campaign; no asset of any token.
    const text = JSON.stringify(payload);
    for (const secret of [
      live.hidden.id,
      live.lurker.id,
      live.lurker.image_id,
      'Lurker',
      'Waits in the dark',
      live.goblin.id,
      live.scene.id,
      live.scene.session_id,
      'Lair of the lurker',
      'Night one',
      'Secret campaign',
      '"hidden"',
      '"notes"',
      '"asset',
      'thumbnail',
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(snapshot.scene!.map).toEqual({
      id: live.map.id,
      width: live.map.width,
      height: live.map.height,
      variants: { display: live.map.variants.display },
    });
    expect(snapshot.scene!.grid).toEqual(live.scene.grid);
  });

  it('gives players the same snapshot whether or not a hidden token lies between visible ones', async () => {
    const live = await liveScene();
    const withHidden = (await connect()).first.payload;
    data.db.prepare('DELETE FROM token WHERE id = ?').run(live.hidden.id);
    const without = (await connect()).first.payload;
    expect(withHidden).toEqual(without);
  });

  it('gives players nothing when every token of the live scene is hidden', async () => {
    const live = await liveScene();
    data.db.prepare('UPDATE token SET hidden = 1').run();
    const { payload } = (await connect()).first;
    expect((payload as PlayerSnapshot).scene?.tokens).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain(live.visible[0]!.id);
  });

  it('answers a snapshot request from either room with a fresh snapshot to that socket alone', async () => {
    const dm = await connect({ cookie });
    const player = await connect();
    const live = await liveScene();
    const fresh = await requestSnapshot(player);
    expect(fresh.type).toBe('scene.snapshot');
    expect((fresh.payload as PlayerSnapshot).scene?.tokens.map((token) => token.id)).toEqual(
      live.visible.map((t) => t.id),
    );
    const dmFresh = await requestSnapshot(dm);
    expect((dmFresh.payload as DmSnapshot).scene?.tokens).toHaveLength(3);
    // Each asked for itself; neither received the other's.
    expect(player.events.map((event) => (event.payload as SceneSnapshot).role)).toEqual(['players', 'players']);
    expect(dm.events.map((event) => (event.payload as SceneSnapshot).role)).toEqual(['dm', 'dm']);
  });
});

describe('versions (specs/04-live-sync.md §5, D-017, Q-056)', () => {
  it('starts at 1 and gives other clients no gap when a screen connects or asks for a snapshot', async () => {
    const first = await connect();
    expect(first.first.version).toBe(1);
    const second = await connect({ cookie });
    await requestSnapshot(second);
    expect(second.first.version).toBe(1);
    // The first client received nothing while the second connected and asked.
    expect(first.events).toHaveLength(1);
    expect(version.current()).toBe(1);
  });

  it('carries the version of the latest event in every snapshot, ascending with the counter', async () => {
    const client = await connect();
    const seen = [client.first.version];
    for (let i = 0; i < 3; i++) {
      version.next(); // an event emitted for the live scene (LIV-02 onward)
      seen.push((await requestSnapshot(client)).version);
    }
    expect(seen).toEqual([1, 2, 3, 4]);
  });
});

// --- commands ---------------------------------------------------------------------------------

describe('commands from the players room (specs/04-live-sync.md §2, specs/07-security-and-access.md §3, D-064, D-068)', () => {
  const tokenCount = () => data.db.prepare('SELECT count(*) FROM token').pluck().get() as number;
  const settingsRow = () => JSON.stringify(data.db.prepare('SELECT * FROM settings').get());

  it('refuses every command type from players over the wire, in the envelope, changing nothing', async () => {
    await liveScene();
    const player = await connect();
    const before = { tokens: tokenCount(), settings: settingsRow() };
    for (const type of [
      'token.add',
      'token.move',
      'token.delete',
      'token.setVisibility',
      'scene.activate',
      'scene.deactivate',
      'camera.setPlayer',
      'ruler.update',
      'ruler.clear',
      'undo',
    ]) {
      const ack = await command(player.socket, { type, payload: {} });
      expect(isEnvelope(ack), type).toBe(true);
      expect((ack as ErrorEnvelope).error.code, type).toBe('forbidden');
    }
    // Garbage is refused the same way, before it is even read.
    for (const raw of [null, 'scene.deactivate', { type: 'nope' }, { __proto__: { type: 'undo' } }]) {
      expect(((await command(player.socket, raw)) as ErrorEnvelope).error.code).toBe('forbidden');
    }
    expect({ tokens: tokenCount(), settings: settingsRow() }).toEqual(before);
    expect(player.events).toHaveLength(1);
  });

  it('checks the room before the content: a command valid in every other way never reaches the apply step', async () => {
    await app.close();
    const applied: unknown[] = [];
    await start({
      commands: { validate: (raw) => ({ ok: true, command: raw as never }), apply: (c) => applied.push(c) },
    });
    const player = await connect();
    const dm = await connect({ cookie });
    expect(((await command(player.socket, { type: 'undo', payload: {} })) as ErrorEnvelope).error.code).toBe(
      'forbidden',
    );
    expect(applied).toEqual([]);
    expect(await command(dm.socket, { type: 'undo', payload: {} })).toEqual({ ok: true });
    expect(applied).toEqual([{ type: 'undo', payload: {} }]);
  });

  it('validates a DM command in the envelope: none is supported before LIV-02', async () => {
    const dm = await connect({ cookie });
    expect(((await command(dm.socket, { type: 'scene.deactivate', payload: {} })) as ErrorEnvelope).error.code).toBe(
      'command_unsupported',
    );
    expect(((await command(dm.socket, { type: 'nope', payload: {} })) as ErrorEnvelope).error.code).toBe(
      'validation_failed',
    );
    expect(((await command(dm.socket, Buffer.from('{}'))) as ErrorEnvelope).error.code).toBe('validation_failed');
  });

  it('survives a command sent without an acknowledgement', async () => {
    const player = await connect();
    player.socket.emit(SOCKET_CHANNELS.command, { type: 'undo', payload: {} });
    player.socket.emit(SOCKET_CHANNELS.command);
    expect((await requestSnapshot(player)).payload.role).toBe('players');
  });
});

// --- sessions ending --------------------------------------------------------------------------

describe('an ended session drops its sockets at once (specs/07-security-and-access.md §2, G-011)', () => {
  it('drops the other device on a PIN change, keeps the changer, and lets the dropped one back only as a player', async () => {
    const other = dmCookie(await app.inject({ method: 'POST', url: '/api/auth', payload: { pin: '4826' } }));
    const changer = await connect({ cookie });
    const dropped = await connect({ cookie: other });
    expect(dropped.first.payload.role).toBe('dm');
    const gone = disconnected(dropped.socket);
    const kept = disconnected(changer.socket);
    ok(
      await inject({ method: 'PUT', url: '/api/settings/pin', payload: { current_pin: '4826', new_pin: '5937' } }),
      204,
    );
    expect(await within(gone, 1_000)).toBe('io server disconnect');
    expect(await within(kept, 200)).toBe('pending');
    expect(app.live.count('dm')).toBe(1);
    const back = await connect({ cookie: other });
    expect(back.first.payload.role).toBe('players');
  });

  it('drops the sockets of a browser that signs out, and only those', async () => {
    const other = dmCookie(await app.inject({ method: 'POST', url: '/api/auth', payload: { pin: '4826' } }));
    const leaving = [await connect({ cookie: other }), await connect({ cookie: other })];
    const staying = await connect({ cookie });
    const gone = leaving.map((client) => disconnected(client.socket));
    ok(await inject({ method: 'DELETE', url: '/api/auth' }, other), 204);
    for (const reason of gone) expect(await within(reason, 1_000)).toBe('io server disconnect');
    expect(staying.socket.connected).toBe(true);
    expect(app.live.count('dm')).toBe(1);
  });

  it('refuses a command from a DM socket whose session ended before the socket was dropped', async () => {
    const dm = await connect({ cookie });
    // End the session without its notification reaching the socket layer first.
    const sessions = app.auth.sessions as { end(id: string): void; has(id: string): boolean };
    const id = cookie.split('=')[1]!;
    const has = sessions.has.bind(sessions);
    sessions.has = (value: string) => (value === id ? false : has(value));
    expect(((await command(dm.socket, { type: 'undo', payload: {} })) as ErrorEnvelope).error.code).toBe('forbidden');
  });
});

// --- logging ----------------------------------------------------------------------------------

describe('connection logs (specs/07-security-and-access.md §8, Q-041, Q-044)', () => {
  it('names the role and the address of each connection and never a session or cookie', async () => {
    const other = dmCookie(await app.inject({ method: 'POST', url: '/api/auth', payload: { pin: '4826' } }));
    const dm = await connect({ cookie });
    await connect({ cookie: other });
    await connect();
    const gone = disconnected(dm.socket);
    dm.socket.disconnect();
    await gone;
    await vi.waitFor(() => expect(lines.filter((line) => line.event === 'ws.disconnected')).toHaveLength(1));
    const connections = lines.filter((line) => line.event === 'ws.connected');
    expect(connections.map((line) => line.fields?.role)).toEqual(['dm', 'dm', 'players']);
    for (const line of connections) expect(line.fields?.address).toBe('127.0.0.1');
    const text = JSON.stringify(lines);
    for (const secret of [cookie.split('=')[1]!, other.split('=')[1]!, 'emberglass_dm'])
      expect(text).not.toContain(secret);
  });
});
