import { io } from 'socket.io-client';
import { SOCKET_CHANNELS, SOCKET_PATH, type EventEnvelope, type SceneSnapshot } from '@emberglass/shared';
import { createVersionTracker } from './versions.js';

// The live connection both views keep (LIV-01; specs/04-live-sync.md §5, §6, D-104). The server
// decides the room from the DM session cookie the browser sends with the handshake; the client
// declares nothing. Socket.io reconnects by itself after sleep or a network loss, and every
// connection starts with a fresh snapshot, so a reconnected client is in step again without
// asking. The server also drops the sockets of a session that ended; the client then connects
// again at once and the server puts it in `players`, which the DM view reads as signed out.

export type LiveStatus = 'connecting' | 'connected' | 'reconnecting';

/** What the connection needs of a Socket.io client socket; the component tests pass a fake. */
export interface LiveSocketLike {
  readonly connected: boolean;
  on(event: string, listener: (...args: never[]) => void): unknown;
  emit(event: string, ...args: unknown[]): unknown;
  connect(): unknown;
  disconnect(): unknown;
}

export type SocketFactory = () => LiveSocketLike;

const realSocket: SocketFactory = () =>
  io({
    path: SOCKET_PATH,
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

/** Opens the connection; the returned function closes it for good. */
export function connectLive(handlers: LiveHandlers): () => void {
  const socket = socketFactory();
  const tracker = createVersionTracker();
  let closed = false;
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
  socket.on('connect', () => handlers.onStatus('connected'));
  socket.on('connect_error', () => handlers.onStatus('reconnecting'));
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
      clearTimeout(retry);
      tracker.snapshot(event.version);
      handlers.onSnapshot(event.payload as SceneSnapshot, event.version);
      return;
    }
    const verdict = tracker.event(event.version);
    if (verdict === 'apply') handlers.onEvent(event);
    else if (verdict === 'gap') requestSnapshot();
  });

  return () => {
    closed = true;
    clearTimeout(retry);
    socket.disconnect();
  };
}
