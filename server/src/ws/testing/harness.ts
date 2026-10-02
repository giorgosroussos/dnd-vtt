import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import sharp from 'sharp';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';
import { expect, vi } from 'vitest';
import {
  SOCKET_CHANNELS,
  SOCKET_PATH,
  type CommandAck,
  type EventEnvelope,
  type Image,
  type LibraryAsset,
  type Scene,
  type SnapshotEvent,
  type TokenChange,
} from '@emberglass/shared';
import { DATABASE_FILE } from '../../db/database.js';
import { createVersionCounters, type VersionCounters } from '../../domain/version.js';
import { buildTestApp, createTestData, setUpPin, type TestData } from '../../http/testing/app.js';

// A live server for the WebSocket tests: a real SQLite file in a temporary data directory, a real
// port and real Socket.io clients (specs/10-testing-acceptance.md §2). Images are generated from a
// name, so the same name gives the same bytes and the same sha256 in every run (Q-088).
//
// With EMBERGLASS_TEST_PACKAGE naming the folder of an installed or unzipped package (PKG-03,
// specs/10-testing-acceptance.md §4), the server is that package instead: its own runtime runs its
// launcher, as Emberglass.cmd does, on a fresh data directory and a free port, with no program on PATH
// (so no browser opens). Requests then go over HTTP, the database is read through a read-only connection
// to the package's file, and the package's own limits apply, its one snapshot a second among them
// (`make package-gates`, D-176).

/** The package the tests run against, or undefined for the in-process server. */
export const PACKAGE_DIR = process.env.EMBERGLASS_TEST_PACKAGE || undefined;

// A packaged server starts in seconds, and answers at most one snapshot request a second per socket,
// which the tests ask for after every step.
if (PACKAGE_DIR) vi.setConfig({ testTimeout: 900_000, hookTimeout: 120_000 });

export interface Client {
  socket: ClientSocket;
  /** Every event received, in order, the connection's snapshot first. */
  events: EventEnvelope[];
  first: SnapshotEvent;
  /** Resolves once `count` events in all have arrived. */
  received(count: number): Promise<EventEnvelope[]>;
  /**
   * The events that arrived since the last call, once everything sent before now has arrived:
   * asks for a snapshot and waits for it, so the requested snapshot itself is not among them.
   */
  settle(): Promise<EventEnvelope[]>;
}

export interface LiveHarness {
  readonly data: TestData;
  /** The in-process server; absent against a package, where `request` and `inject` go over HTTP. */
  readonly app: FastifyInstance;
  readonly cookie: string;
  readonly url: string;
  /** The in-process version counters; absent against a package, whose snapshots carry the version. */
  readonly versions: VersionCounters;
  connect(headers?: Record<string, string | undefined>, auth?: Record<string, unknown>): Promise<Client>;
  command(client: Client, type: string, payload: unknown): Promise<CommandAck>;
  inject(options: InjectOptions, as?: string): Promise<LightMyRequestResponse>;
  /** A request without any session, as a player view's browser makes it. */
  request(options: InjectOptions): Promise<LightMyRequestResponse>;
  post(target: string, payload: unknown): Promise<LightMyRequestResponse>;
  image(name: string, width?: number): Promise<Image>;
  asset(name: string, fields?: Partial<LibraryAsset>): Promise<LibraryAsset>;
  scene(name: string, mapId?: string): Promise<Scene>;
  place(sceneId: string, assetId: string, x: number, y: number): Promise<TokenChange['token']>;
  close(): Promise<void>;
}

export function ok<T>(response: LightMyRequestResponse, status = 200): T {
  expect(response.statusCode, response.body).toBe(status);
  return (status === 204 ? undefined : response.json<T>()) as T;
}

/** The server a harness drives: the in-process app, or a package's own process. */
interface Backend {
  data: TestData;
  app: FastifyInstance;
  versions: VersionCounters;
  url: string;
  cookie: string;
  /** A request with the headers given, and no others. */
  send(options: InjectOptions): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

const PIN = '4826';

async function inProcess(snapshotIntervalMs: number): Promise<Backend> {
  const data = createTestData('emberglass-liv02-');
  const versions = createVersionCounters();
  // Snapshot requests unthrottled unless a test says otherwise: the tests use one after each step to
  // know that every event the step caused has arrived (Socket.io keeps a socket's messages in order).
  // The same interval bounds viewport reports (LIV-06).
  const app = await buildTestApp(data, { versions, liveLimits: { snapshotIntervalMs } });
  const cookie = await setUpPin(app, PIN);
  await app.listen({ port: 0, host: '127.0.0.1' });
  return {
    data,
    app,
    versions,
    url: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`,
    cookie,
    send: (options) => app.inject(options),
    async close() {
      await app.close();
      data.remove();
    },
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** The fields of an inject response the tests read, from a real HTTP exchange. */
async function overHttp(url: string, options: InjectOptions): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries((options.headers ?? {}) as Record<string, string | number | undefined>)) {
    if (value !== undefined) headers[name.toLowerCase()] = String(value);
  }
  const payload = options.payload ?? options.body;
  let body: string | Buffer | undefined;
  if (typeof payload === 'string' || Buffer.isBuffer(payload)) body = payload;
  else if (payload !== undefined) {
    body = JSON.stringify(payload);
    headers['content-type'] ??= 'application/json';
  }
  if (typeof options.url !== 'string') throw new Error('Requests to a package take a URL string.');
  const target = options.url;
  const response = await fetch(new URL(target, url), {
    method: options.method ?? 'GET',
    headers,
    redirect: 'manual',
    ...(body === undefined ? {} : { body }),
  });
  const rawPayload = Buffer.from(await response.arrayBuffer());
  const responseHeaders: Record<string, string | string[]> = {};
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') responseHeaders[name] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) responseHeaders['set-cookie'] = cookies.length === 1 ? cookies[0]! : cookies;
  const text = rawPayload.toString('utf8');
  return {
    statusCode: response.status,
    headers: responseHeaders,
    rawPayload,
    payload: text,
    body: text,
    json: () => JSON.parse(text) as unknown,
  } as unknown as LightMyRequestResponse;
}

/** The environment of a DM's PC with no program on PATH: no Node, and no browser for the launcher to open. */
function packageEnv(root: string, port: number, dataDir: string): NodeJS.ProcessEnv {
  const noPrograms = path.join(root, 'no-programs');
  mkdirSync(noPrograms, { recursive: true });
  const keep =
    process.platform === 'win32'
      ? ['SystemRoot', 'SystemDrive', 'windir', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']
      : ['TMPDIR'];
  return {
    ...Object.fromEntries(keep.filter((name) => process.env[name]).map((name) => [name, process.env[name]])),
    ...(process.platform === 'win32' ? {} : { HOME: root }),
    PATH: noPrograms,
    EMBERGLASS_PORT: String(port),
    EMBERGLASS_DATA_DIR: dataDir,
  };
}

async function packaged(folder: string): Promise<Backend> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'emberglass-package-gate-'));
  const dataDir = path.join(root, 'data');
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const runtime = path.join(folder, process.platform === 'win32' ? 'emberglass.exe' : 'emberglass');
  const child: ChildProcess = spawn(runtime, [path.join(folder, 'app', 'launcher.mjs')], {
    env: packageEnv(root, port, dataDir),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout!.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  child.stderr!.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.once('error', (error) => (output += `\n${error.message}`));
  const opened: Database.Database[] = [];
  const stop = async () => {
    for (const db of opened) if (db.open) db.close();
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32' && child.pid !== undefined) {
        spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
      } else child.kill('SIGTERM');
      await exited;
    }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
  try {
    // The launcher starts the server in its own process and says so (specs/09-operations.md §1, §2).
    await vi.waitFor(
      async () => {
        if (child.exitCode !== null) throw new Error(`the package's launcher exited:\n${output}`);
        expect(output).toContain(`Emberglass is running on port ${port}`);
        expect((await fetch(`${url}/api/auth`)).status).toBe(200);
      },
      { timeout: 60_000, interval: 200 },
    );
    const setup = await overHttp(url, { method: 'POST', url: '/api/setup', payload: { pin: PIN } });
    const cookie = [setup.headers['set-cookie'] ?? []].flat().find((value) => value.startsWith('emberglass_dm='));
    if (setup.statusCode !== 200 || !cookie) throw new Error(`setup answered ${setup.statusCode}: ${setup.body}`);
    const reopen = () => {
      const db = new Database(path.join(dataDir, DATABASE_FILE), { readonly: true, fileMustExist: true });
      opened.push(db);
      return db;
    };
    const absent = (what: string) => () => {
      throw new Error(`${what} is the in-process server's; the tests run against the package in ${folder}`);
    };
    return {
      data: {
        root,
        dataDir,
        dist: path.join(folder, 'app', 'client', 'dist'),
        db: reopen(),
        reopen,
        // Closed with the server, by `close`.
        remove: () => undefined,
      },
      get app(): FastifyInstance {
        return absent('app')();
      },
      get versions(): VersionCounters {
        return absent('versions')();
      },
      url,
      cookie: cookie.split(';', 1)[0]!,
      send: (options) => overHttp(url, options),
      close: stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

export async function startLive({
  snapshotIntervalMs = 0,
}: { snapshotIntervalMs?: number } = {}): Promise<LiveHarness> {
  if (PACKAGE_DIR && snapshotIntervalMs !== 0) {
    throw new Error('A test of its own snapshot interval cannot run against a package, whose interval is fixed.');
  }
  const backend = PACKAGE_DIR ? await packaged(PACKAGE_DIR) : await inProcess(snapshotIntervalMs);
  const { url, cookie } = backend;
  const clients: ClientSocket[] = [];
  let session: { id: string } | undefined;

  const inject = (options: InjectOptions, as = cookie) =>
    backend.send({ ...options, headers: { cookie: as, ...(options.headers as Record<string, string> | undefined) } });
  const post = (target: string, payload: unknown) =>
    inject({ method: 'POST', url: target, payload: payload as object });

  const connect = async (headers: Record<string, string | undefined> = {}, auth: Record<string, unknown> = {}) => {
    const extraHeaders: Record<string, string> = {};
    for (const [name, value] of Object.entries({ origin: url, ...headers }))
      if (value !== undefined) extraHeaders[name] = value;
    const socket = connectClient(url, {
      path: SOCKET_PATH,
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      extraHeaders,
      auth,
    });
    clients.push(socket);
    const events: EventEnvelope[] = [];
    const waiting: { count: number; resolve: () => void }[] = [];
    socket.on(SOCKET_CHANNELS.event, (event: EventEnvelope) => {
      events.push(event);
      for (const wait of waiting.splice(0)) {
        if (events.length >= wait.count) wait.resolve();
        else waiting.push(wait);
      }
    });
    const received = (count: number) =>
      new Promise<EventEnvelope[]>((resolve, reject) => {
        if (events.length >= count) return resolve(events);
        const timer = setTimeout(() => reject(new Error(`expected ${count} events, got ${events.length}`)), 5_000);
        waiting.push({
          count,
          resolve: () => {
            clearTimeout(timer);
            resolve(events);
          },
        });
      });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect_error', reject);
      void received(1).then(() => resolve(), reject);
    });
    let cursor = 1;
    const settle = async () => {
      const ack: unknown = await socket.timeout(5_000).emitWithAck(SOCKET_CHANNELS.snapshot);
      expect(ack).toEqual({ ok: true });
      // The server sends the requested snapshot before its acknowledgement, on the same socket, so
      // it has arrived, after everything sent to this socket before it.
      const fresh = events.slice(cursor, -1);
      expect(events.at(-1)?.type).toBe('scene.snapshot');
      cursor = events.length;
      return fresh;
    };
    return { socket, events, first: events[0] as SnapshotEvent, received, settle };
  };

  const image = async (name: string, width = 64) => {
    const [r, g, b] = createHash('sha256').update(name).digest();
    const png = await sharp({ create: { width, height: 48, channels: 3, background: { r: r!, g: g!, b: b! } } })
      .png()
      .toBuffer();
    const response = await inject({
      method: 'POST',
      url: '/api/images',
      payload: png,
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect([200, 201], response.body).toContain(response.statusCode);
    return response.json<Image>();
  };

  const harness: LiveHarness = {
    get data() {
      return backend.data;
    },
    get app() {
      return backend.app;
    },
    cookie,
    url,
    get versions() {
      return backend.versions;
    },
    connect,
    command: (client, type, payload) =>
      client.socket.timeout(5_000).emitWithAck(SOCKET_CHANNELS.command, { type, payload }) as Promise<CommandAck>,
    inject,
    request: (options) => backend.send(options),
    post,
    image,
    async asset(name, fields = {}) {
      const { id: image_id } = await image(`asset ${name}`);
      return ok<LibraryAsset>(
        await post('/api/assets', { name, image_id, category: 'npc', size: 'medium', ...fields }),
        201,
      );
    },
    async scene(name, mapId) {
      if (!session) {
        const campaign = ok<{ id: string }>(await post('/api/campaigns', { name: 'Secret campaign' }), 201);
        session = ok<{ id: string }>(await post(`/api/campaigns/${campaign.id}/sessions`, { title: 'Night one' }), 201);
      }
      const scene = ok<Scene>(await post(`/api/sessions/${session.id}/scenes`, { name }), 201);
      if (mapId === undefined) return scene;
      return ok<Scene>(
        await inject({ method: 'PATCH', url: `/api/scenes/${scene.id}`, payload: { map_image_id: mapId } }),
      );
    },
    async place(sceneId, assetId, x, y) {
      return ok<TokenChange>(await post(`/api/scenes/${sceneId}/tokens`, { asset_id: assetId, x, y }), 201).token;
    },
    async close() {
      for (const client of clients.splice(0)) client.disconnect();
      await backend.close();
    },
  };
  return harness;
}

/** A player's copy of the live scene, kept from its snapshot and events as a player client would. */
export interface PlayerState {
  version: number;
  scene: {
    map: unknown;
    grid: unknown;
    tokens: Record<string, unknown>[];
    camera: unknown;
    ruler: unknown;
    fog: unknown;
    encounter: unknown;
  } | null;
}

/**
 * Applies the players' events as `shared/src/live.ts` states them: an added token goes in at its
 * rank, a removed one leaves, a moved one is replaced, a renamed one takes its new label, and
 * `camera.player` replaces the camera (LIV-06), `ruler.shown` and `ruler.cleared` the measurement
 * (LIV-07), `fog.updated` the painted fog (TBL-04), `encounter.updated` the encounter (TBL-06). Throws on a version that is not the next one,
 * which is a gap.
 */
export function applyPlayerEvent(state: PlayerState, event: EventEnvelope): PlayerState {
  if (event.type === 'scene.snapshot') {
    const payload = event.payload as { scene: PlayerState['scene'] };
    return { version: event.version, scene: structuredClone(payload.scene) };
  }
  if (event.version !== state.version + 1) throw new Error(`gap: ${state.version} then ${event.version}`);
  const next: PlayerState = { version: event.version, scene: structuredClone(state.scene) };
  if (event.type === 'scene.cleared') return { ...next, scene: null };
  if (event.type === 'camera.player') {
    next.scene!.camera = structuredClone((event.payload as { camera: unknown }).camera);
    return next;
  }
  if (event.type === 'ruler.shown') {
    next.scene!.ruler = structuredClone((event.payload as { ruler: unknown }).ruler);
    return next;
  }
  if (event.type === 'ruler.cleared') {
    next.scene!.ruler = null;
    return next;
  }
  if (event.type === 'fog.updated') {
    next.scene!.fog = structuredClone((event.payload as { fog: unknown }).fog);
    return next;
  }
  if (event.type === 'encounter.updated') {
    next.scene!.encounter = structuredClone((event.payload as { encounter: unknown }).encounter);
    return next;
  }
  const tokens = next.scene!.tokens;
  const payload = event.payload as { id?: string; token?: { id: string; z_order: number }; relabelled?: [] };
  const at = (id: string) => tokens.findIndex((token) => token.id === id);
  if (event.type === 'token.added') tokens.splice(payload.token!.z_order, 0, payload.token!);
  if (event.type === 'token.updated') tokens.splice(at(payload.token!.id), 1, payload.token!);
  if (event.type === 'token.removed') tokens.splice(at(payload.id!), 1);
  for (const renamed of (payload.relabelled ?? []) as { id: string }[]) tokens.splice(at(renamed.id), 1, renamed);
  // The ranks a client holds are the positions in that order, and every token the event carries
  // already names the rank it now has.
  for (const sent of [payload.token, ...(payload.relabelled ?? [])] as (
    { id: string; z_order: number } | undefined
  )[]) {
    if (sent && at(sent.id) !== sent.z_order) throw new Error(`rank ${sent.z_order} sent, ${at(sent.id)} held`);
  }
  tokens.forEach((token, rank) => (token.z_order = rank));
  return next;
}
