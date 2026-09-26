import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import sharp from 'sharp';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';
import { expect } from 'vitest';
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
import { createVersionCounters, type VersionCounters } from '../../domain/version.js';
import { buildTestApp, createTestData, setUpPin, type TestData } from '../../http/testing/app.js';

// A live server for the WebSocket tests: a real SQLite file in a temporary data directory, a real
// port and real Socket.io clients (specs/10-testing-acceptance.md §2). Images are generated from a
// name, so the same name gives the same bytes and the same sha256 in every run (Q-088).

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
  readonly app: FastifyInstance;
  readonly cookie: string;
  readonly url: string;
  readonly versions: VersionCounters;
  connect(headers?: Record<string, string | undefined>, auth?: Record<string, unknown>): Promise<Client>;
  command(client: Client, type: string, payload: unknown): Promise<CommandAck>;
  inject(options: InjectOptions, as?: string): Promise<LightMyRequestResponse>;
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

export async function startLive(): Promise<LiveHarness> {
  const data = createTestData('emberglass-liv02-');
  const versions = createVersionCounters();
  // Snapshot requests unthrottled: the tests use one after each step to know that every event the
  // step caused has arrived (Socket.io keeps a socket's messages in order).
  const app = await buildTestApp(data, { versions, liveLimits: { snapshotIntervalMs: 0 } });
  const cookie = await setUpPin(app, '4826');
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const clients: ClientSocket[] = [];
  let session: { id: string } | undefined;

  const inject = (options: InjectOptions, as = cookie) =>
    app.inject({ ...options, headers: { cookie: as, ...(options.headers as Record<string, string> | undefined) } });
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
    data,
    app,
    cookie,
    url,
    versions,
    connect,
    command: (client, type, payload) =>
      client.socket.timeout(5_000).emitWithAck(SOCKET_CHANNELS.command, { type, payload }) as Promise<CommandAck>,
    inject,
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
      await app.close();
      data.remove();
    },
  };
  return harness;
}

/** A player's copy of the live scene, kept from its snapshot and events as a player client would. */
export interface PlayerState {
  version: number;
  scene: { map: unknown; grid: unknown; tokens: Record<string, unknown>[] } | null;
}

/**
 * Applies the players' events as `shared/src/live.ts` states them: an added token goes in at its
 * rank, a removed one leaves, a moved one is replaced, a renamed one takes its new label. Throws on
 * a version that is not the next one, which is a gap.
 */
export function applyPlayerEvent(state: PlayerState, event: EventEnvelope): PlayerState {
  if (event.type === 'scene.snapshot') {
    const payload = event.payload as { scene: PlayerState['scene'] };
    return { version: event.version, scene: structuredClone(payload.scene) };
  }
  if (event.version !== state.version + 1) throw new Error(`gap: ${state.version} then ${event.version}`);
  const next: PlayerState = { version: event.version, scene: structuredClone(state.scene) };
  if (event.type === 'scene.cleared') return { ...next, scene: null };
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
