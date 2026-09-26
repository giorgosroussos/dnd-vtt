import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOCKET_CHANNELS, type EventEnvelope, type SceneSnapshot } from '@emberglass/shared';
import { installFakeSockets, type FakeSocket } from '../ui/testing/fakeSocket.js';
import { COMMAND_TIMEOUT_MS, connectLive, SNAPSHOT_RETRY_MS, type LiveStatus } from './connection.js';

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
  close = connectLive('player', {
    onStatus: (status) => statuses.push(status),
    onSnapshot: (snapshot, version) => snapshots.push({ snapshot, version }),
    onEvent: (e) => events.push(e.version),
  }).close;
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
    socket.open(idle, 1);
    socket.drop('io server disconnect');
    expect(socket.connects).toBe(1);
    expect(statuses.at(-1)).toBe('reconnecting');
  });

  it('reports a failed attempt as still connecting before any connection, and as reconnecting after one', () => {
    const fire = (socket as unknown as { fire(event: string): void }).fire.bind(socket);
    fire('connect_error');
    expect(statuses).toEqual(['connecting', 'connecting']);
    socket.open(idle, 1);
    socket.drop('transport close');
    fire('connect_error');
    expect(statuses.slice(2)).toEqual(['connected', 'reconnecting', 'reconnecting']);
  });

  it('sends no snapshot request while disconnected, and none late after reconnecting', () => {
    vi.useFakeTimers();
    socket.open(idle, 1);
    socket.deliver(event(3));
    expect(socket.snapshotRequests()).toBe(1);
    socket.drop('transport close');
    vi.advanceTimersByTime(SNAPSHOT_RETRY_MS * 3);
    expect(socket.snapshotRequests()).toBe(1);
    socket.open(idle, 1);
    vi.advanceTimersByTime(SNAPSHOT_RETRY_MS * 3);
    expect(socket.snapshotRequests()).toBe(1);
  });

  it('opens the socket of the player view as a player view, and never uses a DM snapshot there (D-105)', () => {
    expect(socket.view).toBe('player');
    socket.open({ role: 'dm', scene: null }, 1);
    expect(snapshots).toEqual([]);
    socket.deliver({ type: 'scene.snapshot', version: 2, payload: idle });
    expect(snapshots).toEqual([{ snapshot: idle, version: 2 }]);
  });

  it('lets the DM view take a snapshot of either room, so it can learn its session ended', () => {
    const seen: string[] = [];
    const closeDm = connectLive('dm', {
      onStatus: () => {},
      onSnapshot: (snapshot) => seen.push(snapshot.role),
      onEvent: () => {},
    }).close;
    const dm = fake.sockets[1]!;
    expect(dm.view).toBe('dm');
    dm.open({ role: 'dm', scene: null });
    dm.deliver({ type: 'scene.snapshot', version: 1, payload: { role: 'players', scene: null } });
    expect(seen).toEqual(['dm', 'players']);
    closeDm();
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

describe('commands from the DM view (LIV-04, specs/04-live-sync.md §2)', () => {
  const dmConnection = () => {
    const connection = connectLive('dm', { onStatus: () => {}, onSnapshot: () => {}, onEvent: () => {} });
    return { connection, dm: fake.sockets.at(-1)! };
  };

  it('sends a command in its envelope and answers what the server acknowledged', async () => {
    const { connection, dm } = dmConnection();
    dm.open({ role: 'dm', scene: null });
    dm.onCommand = (command, ack) =>
      ack(
        command.type === 'scene.deactivate'
          ? { ok: true }
          : { error: { code: 'scene_not_live', message: 'The scene is not live.' } },
      );
    await expect(connection.command('scene.deactivate', {})).resolves.toEqual({ ok: true });
    await expect(connection.command('token.delete', { token_id: 'a' })).resolves.toEqual({
      ok: false,
      code: 'scene_not_live',
    });
    expect(dm.commands()).toEqual([
      { type: 'scene.deactivate', payload: {} },
      { type: 'token.delete', payload: { token_id: 'a' } },
    ]);
    connection.close();
  });

  it('sends nothing while disconnected, so no command is replayed after a reconnection', async () => {
    const { connection, dm } = dmConnection();
    await expect(connection.command('scene.deactivate', {})).resolves.toEqual({ ok: false, code: 'network' });
    dm.open({ role: 'dm', scene: null });
    dm.drop();
    await expect(connection.command('token.move', { token_id: 'a', x: 1, y: 1 })).resolves.toEqual({
      ok: false,
      code: 'network',
    });
    expect(dm.commands()).toEqual([]);
    connection.close();
    await expect(connection.command('scene.deactivate', {})).resolves.toEqual({ ok: false, code: 'network' });
  });

  it('reports a command left unanswered as a lost connection', async () => {
    vi.useFakeTimers();
    const { connection, dm } = dmConnection();
    dm.open({ role: 'dm', scene: null });
    const outcome = connection.command('scene.deactivate', {});
    vi.advanceTimersByTime(COMMAND_TIMEOUT_MS);
    await expect(outcome).resolves.toEqual({ ok: false, code: 'network' });
    connection.close();
  });

  it('reconnects on request, and not once closed', () => {
    const { connection, dm } = dmConnection();
    dm.open({ role: 'dm', scene: null });
    connection.reconnect();
    expect(dm.connects).toBe(1);
    connection.close();
    connection.reconnect();
    expect(dm.connects).toBe(1);
  });
});
