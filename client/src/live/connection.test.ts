import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOCKET_CHANNELS, type EventEnvelope, type SceneSnapshot } from '@emberglass/shared';
import { installFakeSockets, type FakeSocket } from '../ui/testing/fakeSocket.js';
import { connectLive, SNAPSHOT_RETRY_MS, type LiveStatus } from './connection.js';

// The live connection (LIV-01, specs/04-live-sync.md §5, §6), against a scripted socket.

const idle: SceneSnapshot = { role: 'players', scene: null };
const event = (version: number): EventEnvelope => ({ type: 'token.updated', version, payload: {} });

let fake: ReturnType<typeof installFakeSockets>;
let statuses: LiveStatus[];
let snapshots: { snapshot: SceneSnapshot; version: number }[];
let events: number[];
let close: () => void;
let socket: FakeSocket;

beforeEach(() => {
  fake = installFakeSockets();
  statuses = [];
  snapshots = [];
  events = [];
  close = connectLive({
    onStatus: (status) => statuses.push(status),
    onSnapshot: (snapshot, version) => snapshots.push({ snapshot, version }),
    onEvent: (e) => events.push(e.version),
  });
  socket = fake.sockets[0]!;
});

afterEach(() => {
  close();
  fake.restore();
  vi.useRealTimers();
});

describe('live connection', () => {
  it('opens one socket and reports connecting, then connected with the snapshot of its room', () => {
    expect(fake.sockets).toHaveLength(1);
    socket.open(idle, 1);
    expect(statuses).toEqual(['connecting', 'connected']);
    expect(snapshots).toEqual([{ snapshot: idle, version: 1 }]);
  });

  it('applies events in version order and asks for a fresh snapshot on a gap, dropping events until it comes', () => {
    socket.open(idle, 1);
    socket.deliver(event(2));
    socket.deliver(event(4));
    expect(events).toEqual([2]);
    expect(socket.snapshotRequests()).toBe(1);
    socket.deliver(event(5));
    expect(events).toEqual([2]);
    expect(socket.snapshotRequests()).toBe(1);
    socket.deliver({ type: 'scene.snapshot', version: 5, payload: idle });
    socket.deliver(event(6));
    expect(events).toEqual([2, 6]);
    expect(snapshots.map((s) => s.version)).toEqual([1, 5]);
  });

  it('asks again when a snapshot request goes unanswered', () => {
    vi.useFakeTimers();
    socket.open(idle, 1);
    socket.deliver(event(3));
    expect(socket.snapshotRequests()).toBe(1);
    vi.advanceTimersByTime(SNAPSHOT_RETRY_MS);
    expect(socket.snapshotRequests()).toBe(2);
    socket.deliver({ type: 'scene.snapshot', version: 3, payload: idle });
    vi.advanceTimersByTime(SNAPSHOT_RETRY_MS * 3);
    expect(socket.snapshotRequests()).toBe(2);
  });

  it('says it is reconnecting when the connection is lost and resynchronises from the next snapshot', () => {
    socket.open(idle, 4);
    socket.drop('transport close');
    expect(statuses.at(-1)).toBe('reconnecting');
    // An event from before the loss, delivered late, is not applied on top of nothing.
    socket.deliver(event(5));
    expect(events).toEqual([]);
    socket.open({ role: 'players', scene: null }, 1);
    expect(statuses.at(-1)).toBe('connected');
    socket.deliver(event(2));
    expect(events).toEqual([2]);
    // Socket.io reconnects by itself after a transport loss; nothing is forced.
    expect(socket.connects).toBe(0);
  });

  it('connects again at once when the server dropped the socket, so the server can decide its room again', () => {
    socket.open({ role: 'dm', scene: null }, 1);
    socket.drop('io server disconnect');
    expect(socket.connects).toBe(1);
    expect(statuses.at(-1)).toBe('reconnecting');
  });

  it('reports a failed connection attempt as reconnecting', () => {
    (socket as unknown as { fire(event: string): void }).fire('connect_error');
    expect(statuses).toEqual(['connecting', 'reconnecting']);
  });

  it('closes for good: no reconnection, no status after closing', () => {
    socket.open(idle, 1);
    close();
    expect(socket.connected).toBe(false);
    expect(socket.connects).toBe(0);
    expect(statuses.at(-1)).toBe('connected');
    expect(socket.emitted.filter(({ event: name }) => name === SOCKET_CHANNELS.command)).toEqual([]);
  });
});
