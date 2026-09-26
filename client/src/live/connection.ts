import { io } from 'socket.io-client';
import {
  PLAYER_VIEW_AUTH,
  SOCKET_CHANNELS,
  SOCKET_PATH,
  type CommandAck,
  type CommandType,
  type ErrorCode,
  type EventEnvelope,
  type Room,
  type SceneSnapshot,
} from '@emberglass/shared';
import { createVersionTracker } from './versions.js';

// The live connection both views keep (LIV-01; specs/04-live-sync.md §5, §6, D-104). The server
// decides the room from the DM session cookie the browser sends with the handshake; the client
// declares nothing. Socket.io reconnects by itself after sleep or a network loss, and every
// connection starts with a fresh snapshot, so a reconnected client is in step again without
// asking. The server also drops the sockets of a session that ended; the client then connects
// again at once and the server puts it in `players`, which the DM view reads as signed out.
//
// Commands (LIV-04, specs/04-live-sync.md §2): the DM view sends each on `command` and learns the
// outcome from the acknowledgement; the events it caused arrive first (D-111). A command is sent
// only while connected: Socket.io would otherwise buffer it and send it after a reconnection, when
// a move or a reveal may no longer be what the DM means. One left unanswered is reported as a lost
// connection after COMMAND_TIMEOUT_MS; if it did apply, its events still bring the view in step.

export type LiveStatus = 'connecting' | 'connected' | 'reconnecting';

/** What the connection needs of a Socket.io client socket; the component tests pass a fake. */
export interface LiveSocketLike {
  readonly connected: boolean;
  on(event: string, listener: (...args: never[]) => void): unknown;
  emit(event: string, ...args: unknown[]): unknown;
  connect(): unknown;
  disconnect(): unknown;
}

/** The view asking: the player view's socket is always put in `players` by the server (D-105). */
export type LiveView = 'dm' | 'player';

export type SocketFactory = (view: LiveView) => LiveSocketLike;

const realSocket: SocketFactory = (view) =>
  io({
    path: SOCKET_PATH,
    auth: view === 'player' ? { ...PLAYER_VIEW_AUTH } : {},
    // WebSocket only: no long-polling requests (D-104).
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5_000,
  });

let socketFactory: SocketFactory = realSocket;

/** Replaces the socket for tests; returns the function that puts the real one back. */
export function setSocketFactory(factory: SocketFactory): () => void {
  const previous = socketFactory;
  socketFactory = factory;
  return () => {
    socketFactory = previous;
  };
}

export interface LiveHandlers {
  onStatus(status: LiveStatus): void;
  onSnapshot(snapshot: SceneSnapshot, version: number): void;
  /** An event that is exactly the next version; snapshots go to onSnapshot. */
  onEvent(event: EventEnvelope): void;
}

// How long a snapshot request may go unanswered before it is sent again.
export const SNAPSHOT_RETRY_MS = 5_000;
// How long a command may go unanswered before the view says the connection was lost.
export const COMMAND_TIMEOUT_MS = 10_000;

/** A command's outcome: `network` when it could not be sent or was not answered in time. */
export type CommandOutcome = { ok: true } | { ok: false; code: ErrorCode | 'network' };

export interface LiveConnection {
  /** Closes the connection for good. */
  close: () => void;
  /** Sends a command from the DM view (the server refuses every other socket's, Q-046). */
  command: (type: CommandType, payload: object) => Promise<CommandOutcome>;
  /** Drops the connection and opens it again, with the cookie the browser holds now (G-027). */
  reconnect: () => void;
}

// The room each view's snapshots must be for. The player view never uses a DM snapshot, even if
// one reached it, so nothing hidden could be drawn on the TV (D-105).
const EXPECTED: Record<LiveView, Room | undefined> = { player: 'players', dm: undefined };

/** Opens the connection. */
export function connectLive(view: LiveView, handlers: LiveHandlers): LiveConnection {
  const socket = socketFactory(view);
  const tracker = createVersionTracker();
  let closed = false;
  // Until the first connection succeeds nothing was lost: a failed attempt is still connecting.
  let everConnected = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const requestSnapshot = (): void => {
    clearTimeout(retry);
    if (closed || !socket.connected) return;
    socket.emit(SOCKET_CHANNELS.snapshot, () => clearTimeout(retry));
    retry = setTimeout(() => {
      if (tracker.awaiting) requestSnapshot();
    }, SNAPSHOT_RETRY_MS);
  };

  handlers.onStatus('connecting');
  socket.on('connect', () => {
    everConnected = true;
    handlers.onStatus('connected');
  });
  socket.on('connect_error', () => handlers.onStatus(everConnected ? 'reconnecting' : 'connecting'));
  socket.on('disconnect', (reason: string) => {
    clearTimeout(retry);
    tracker.reset();
    if (closed) return;
    handlers.onStatus('reconnecting');
    // Socket.io does not reconnect by itself when the server ended the socket: the session ended.
    if (reason === 'io server disconnect') socket.connect();
  });
  socket.on(SOCKET_CHANNELS.event, (event: EventEnvelope) => {
    if (event.type === 'scene.snapshot') {
      const expected = EXPECTED[view];
      if (expected !== undefined && (event.payload as SceneSnapshot).role !== expected) return;
      clearTimeout(retry);
      tracker.snapshot(event.version);
      handlers.onSnapshot(event.payload as SceneSnapshot, event.version);
      return;
    }
    const verdict = tracker.event(event.version);
    if (verdict === 'apply') handlers.onEvent(event);
    else if (verdict === 'gap') requestSnapshot();
  });

  const command = (type: CommandType, payload: object): Promise<CommandOutcome> =>
    new Promise((resolve) => {
      if (closed || !socket.connected) return resolve({ ok: false, code: 'network' });
      const timer = setTimeout(() => resolve({ ok: false, code: 'network' }), COMMAND_TIMEOUT_MS);
      socket.emit(SOCKET_CHANNELS.command, { type, payload }, (ack: CommandAck) => {
        clearTimeout(timer);
        resolve(
          'ok' in ack && ack.ok
            ? { ok: true }
            : { ok: false, code: 'error' in ack ? ack.error.code : 'internal_error' },
        );
      });
    });

  return {
    close: () => {
      closed = true;
      clearTimeout(retry);
      socket.disconnect();
    },
    command,
    reconnect: () => {
      if (closed) return;
      socket.disconnect();
      socket.connect();
    },
  };
}
