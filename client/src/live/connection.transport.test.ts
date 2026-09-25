import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server, type Socket } from 'socket.io';
import { io } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOCKET_CHANNELS, SOCKET_PATH, type EventEnvelope, type SceneSnapshot } from '@emberglass/shared';
import { connectLive, setSocketFactory, type LiveStatus } from './connection.js';

// The live connection over a real Socket.io client and server (LIV-01 review, D-106): the gap
// loop and the reconnection after the server ends a socket, which the component tests only
// drive through a scripted socket. The Emberglass server's own side is server/src/ws/live.test.ts.

const idle: SceneSnapshot = { role: 'players', scene: null };

let http: HttpServer;
let server: Server;
let url: string;
let version: number;
let restore: () => void;
let close: (() => void) | undefined;
const sockets: Socket[] = [];
let snapshotRequests: number;

beforeEach(async () => {
  version = 1;
  snapshotRequests = 0;
  http = createServer();
  server = new Server(http, { path: SOCKET_PATH, transports: ['websocket'] });
  server.on('connection', (socket) => {
    sockets.push(socket);
    socket.emit(SOCKET_CHANNELS.event, { type: 'scene.snapshot', version, payload: idle });
    socket.on(SOCKET_CHANNELS.snapshot, (ack: (answer: { ok: true }) => void) => {
      snapshotRequests++;
      socket.emit(SOCKET_CHANNELS.event, { type: 'scene.snapshot', version, payload: idle });
      ack({ ok: true });
    });
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  restore = setSocketFactory(() =>
    io(url, { path: SOCKET_PATH, transports: ['websocket'], forceNew: true, reconnectionDelay: 50 }),
  );
});

afterEach(async () => {
  close?.();
  close = undefined;
  restore();
  sockets.length = 0;
  await server.close();
});

function open() {
  const statuses: LiveStatus[] = [];
  const snapshots: number[] = [];
  const events: number[] = [];
  close = connectLive('player', {
    onStatus: (status) => statuses.push(status),
    onSnapshot: (_snapshot, at) => snapshots.push(at),
    onEvent: (event) => events.push(event.version),
  });
  return { statuses, snapshots, events };
}

const emitEvent = (at: number) =>
  sockets
    .at(-1)!
    .emit(SOCKET_CHANNELS.event, { type: 'token.updated', version: at, payload: {} } satisfies EventEnvelope);

describe('live connection over a real Socket.io transport', () => {
  it('applies the next version and answers a gap with a snapshot request the server serves', async () => {
    const seen = open();
    await vi.waitFor(() => expect(seen.snapshots).toEqual([1]));
    version = 2;
    emitEvent(2);
    await vi.waitFor(() => expect(seen.events).toEqual([2]));
    version = 4;
    emitEvent(4); // version 3 never arrived
    await vi.waitFor(() => expect(seen.snapshots).toEqual([1, 4]));
    expect(seen.events).toEqual([2]);
    expect(snapshotRequests).toBe(1);
    version = 5;
    emitEvent(5);
    await vi.waitFor(() => expect(seen.events).toEqual([2, 5]));
  });

  it('connects again at once when the server ends the socket, and resynchronises from its snapshot', async () => {
    const seen = open();
    await vi.waitFor(() => expect(seen.snapshots).toEqual([1]));
    version = 7;
    sockets.at(-1)!.disconnect(true);
    await vi.waitFor(() => expect(seen.snapshots).toEqual([1, 7]));
    expect(sockets).toHaveLength(2);
    expect(seen.statuses).toEqual(['connecting', 'connected', 'reconnecting', 'connected']);
  });
});
