import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOCKET_CHANNELS, SOCKET_PATH } from '@emberglass/shared';
import { buildTestApp, createTestData, setUpPin, type TestData } from '../http/testing/app.js';
import { MAX_PLAYER_SOCKETS_PER_ADDRESS } from './live.js';

// G-029: one LAN address holds a bounded number of player sockets at once, so a device opening
// hundreds cannot make every broadcast cost that many encodings (specs/04-live-sync.md §1, §4). A
// real SQLite file and real Socket.io clients over a real port; the client address comes from a
// header here, since every test client is on loopback, which is not capped.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const LIMIT = 3;
let data: TestData;
let app: FastifyInstance;
let url: string;
let cookie: string;
const clients: ClientSocket[] = [];

beforeEach(async () => {
  data = createTestData('emberglass-limits-');
  app = await buildTestApp(data, {
    liveLimits: {
      maxPlayerSocketsPerAddress: LIMIT,
      clientAddress: (request) => String(request.headers['x-test-address'] ?? request.socket.remoteAddress),
    },
  });
  cookie = await setUpPin(app, '4826');
  await app.listen({ port: 0, host: '127.0.0.1' });
  url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  await app.close();
  data.remove();
});

/** A socket from `address`: 'snapshot' once it heard its first snapshot, 'dropped' if the server cut it. */
function open(
  address: string,
  headers: Record<string, string> = {},
): Promise<{ socket: ClientSocket; outcome: string }> {
  const socket = connectClient(url, {
    path: SOCKET_PATH,
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    extraHeaders: { origin: url, 'x-test-address': address, ...headers },
  });
  clients.push(socket);
  return new Promise((resolve) => {
    socket.on(SOCKET_CHANNELS.event, (event: { type: string }) => {
      if (event.type === 'scene.snapshot') resolve({ socket, outcome: 'snapshot' });
    });
    socket.on('disconnect', () => resolve({ socket, outcome: 'dropped' }));
    socket.on('connect_error', () => resolve({ socket, outcome: 'refused' }));
  });
}

describe('player sockets per address (G-029)', () => {
  it('drops a player socket past the cap before it hears anything, and admits one again once another goes', async () => {
    expect(MAX_PLAYER_SOCKETS_PER_ADDRESS).toBeGreaterThanOrEqual(8);
    const held = await Promise.all(Array.from({ length: LIMIT }, () => open('192.168.1.40')));
    expect(held.map((each) => each.outcome)).toEqual(['snapshot', 'snapshot', 'snapshot']);
    const extra = await open('192.168.1.40');
    expect(extra.outcome).toBe('dropped');
    // Another address is its own count.
    expect((await open('192.168.1.41')).outcome).toBe('snapshot');
    // One goes: its place is free again.
    held[0]!.socket.disconnect();
    await vi.waitFor(async () => expect((await open('192.168.1.40')).outcome).toBe('snapshot'));
  });

  it('counts an IPv6 client by its /64, never caps the server PC, and never caps a DM view', async () => {
    for (let n = 1; n <= LIMIT; n++) expect((await open(`2001:db8:1:2::${n}`)).outcome).toBe('snapshot');
    expect((await open('2001:db8:1:2:ffff::9')).outcome).toBe('dropped');
    for (let n = 0; n < LIMIT + 2; n++) expect((await open('127.0.0.1')).outcome).toBe('snapshot');
    for (let n = 0; n < LIMIT; n++) expect((await open('192.168.1.50')).outcome).toBe('snapshot');
    expect((await open('192.168.1.50', { cookie })).outcome).toBe('snapshot');
  });
});
