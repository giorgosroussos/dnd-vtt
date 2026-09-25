import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import {
  errorEnvelope,
  SOCKET_CHANNELS,
  SOCKET_PATH,
  type CommandAck,
  type CommandEnvelope,
  type Room,
  type SnapshotAck,
  type SnapshotEvent,
} from '@emberglass/shared';
import { normalizeAddress } from '../auth/lockout.js';
import { dispatchCommand, validateCommand, type CommandValidator } from '../domain/commands.js';
import { liveVersion, type VersionCounter } from '../domain/version.js';
import { isSameOriginHeaders, type Auth } from '../http/auth.js';
import type { Logger } from '../log/logger.js';
import { readSnapshot } from './snapshot.js';

// The WebSocket of the live scene (LIV-01; specs/04-live-sync.md §1, §2, §5, §6,
// specs/07-security-and-access.md §2, §3, §7, §8; D-064, D-104).
//
// Socket.io shares the HTTP server's port, at SOCKET_PATH, over WebSocket only. The
// handshake is refused when its Origin is not this server as the browser addressed it
// (Q-043). A socket whose Cookie header carries a valid DM session joins `dm`, every
// other socket joins `players`; nothing the client sends decides it (Q-046). Each
// socket receives the snapshot of its room on connection, and again whenever it asks
// on the `snapshot` channel after seeing a gap. When a session ends (sign-out, a PIN
// change, a new first PIN) its sockets are disconnected at once (G-011); a browser
// reconnecting afterwards joins `players`. A command from any socket outside `dm` is
// refused in the error envelope before it is even validated, and changes nothing.
//
// Versions (D-017, Q-056, D-104): the process counter takes version 1 for the state at
// start-up; a snapshot sent to one socket carries the version of the state it shows and
// takes none, so another client never sees a gap because a screen connected. Events that
// change the live scene take the next version (LIV-02 onward).

export interface LiveSocketOptions {
  db: Database.Database;
  logger: Logger;
  auth: Auth;
  /** The process's version counter; tests pass their own. */
  version?: VersionCounter | undefined;
  /** Command validation and the step that applies a valid command (LIV-02 onward). */
  commands?: { validate: CommandValidator; apply: (command: CommandEnvelope) => void } | undefined;
}

export interface LiveSocket {
  io: Server;
  /** The sockets in each room now, for the tests and the log. */
  count(room: Room): number;
}

// A command or a snapshot request is small; nothing a DM sends comes near this.
const MAX_MESSAGE_BYTES = 64 * 1024;

// No payload schema is registered before LIV-02, so the validator refuses every
// command and this is never reached; LIV-02 replaces it with the live commands.
const applyNothing = (): void => {};

export function attachLiveSocket(
  app: FastifyInstance,
  {
    db,
    logger,
    auth,
    version = liveVersion,
    commands = { validate: validateCommand, apply: applyNothing },
  }: LiveSocketOptions,
): LiveSocket {
  if (version.current() === 0) version.next();

  const io = new Server(app.server, {
    path: SOCKET_PATH,
    serveClient: false,
    transports: ['websocket'],
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
    // Vite's hot reload shares the HTTP server in development: its upgrades are not ours to end.
    destroyUpgrade: false,
    allowRequest: (request, callback) => {
      callback(null, isSameOriginHeaders(request.headers));
    },
  });

  // Every socket of a DM session, so that ending the session drops them.
  const bySession = new Map<string, Set<Socket>>();
  const unsubscribe = auth.sessions.onEnded((ids) => {
    for (const id of ids) {
      const sockets = bySession.get(id);
      if (!sockets) continue;
      bySession.delete(id);
      for (const socket of sockets) socket.disconnect(true);
    }
  });

  const sendSnapshot = (socket: Socket, role: Room): void => {
    const event: SnapshotEvent = {
      type: 'scene.snapshot',
      version: version.current(),
      payload: readSnapshot(db, role),
    };
    socket.emit(SOCKET_CHANNELS.event, event);
  };

  io.on('connection', (socket) => {
    const session = auth.sessionOfCookie(socket.request.headers.cookie);
    const role: Room = session === undefined ? 'players' : 'dm';
    const address = normalizeAddress(socket.request.socket.remoteAddress);
    void socket.join(role);
    if (session !== undefined) {
      const sockets = bySession.get(session) ?? new Set<Socket>();
      sockets.add(socket);
      bySession.set(session, sockets);
    }
    // The role and the address; never the session or the cookie (specs/07-security-and-access.md §8).
    logger.info('ws.connected', `A ${role === 'dm' ? 'DM view' : 'player view'} connected from ${address}.`, {
      role,
      address,
    });

    sendSnapshot(socket, role);

    socket.on(SOCKET_CHANNELS.command, (...args: unknown[]) => {
      const reply = acknowledgement<CommandAck>(args);
      // Read again for every command: a session ended a moment ago commands nothing, even
      // before its socket is gone.
      if (role !== 'dm' || session === undefined || !auth.sessions.has(session)) {
        reply(errorEnvelope('forbidden', 'Commands are accepted from the DM view only.'));
        return;
      }
      reply(dispatchCommand(typeof args[0] === 'function' ? undefined : args[0], commands.validate, commands.apply));
    });

    socket.on(SOCKET_CHANNELS.snapshot, (...args: unknown[]) => {
      sendSnapshot(socket, role);
      acknowledgement<SnapshotAck>(args)({ ok: true });
    });

    socket.on('disconnect', () => {
      if (session !== undefined) {
        const sockets = bySession.get(session);
        sockets?.delete(socket);
        if (sockets?.size === 0) bySession.delete(session);
      }
      logger.info('ws.disconnected', `A ${role === 'dm' ? 'DM view' : 'player view'} disconnected (${address}).`, {
        role,
        address,
      });
    });
  });

  // Before Fastify closes the HTTP server: open WebSockets would keep it waiting.
  app.addHook('preClose', (done) => {
    unsubscribe();
    io.disconnectSockets(true);
    io.engine.close();
    done();
  });

  return { io, count: (room) => io.sockets.adapter.rooms.get(room)?.size ?? 0 };
}

/** The acknowledgement a client passed as the last argument, or a no-op when it passed none. */
function acknowledgement<T>(args: unknown[]): (answer: T) => void {
  const last = args.at(-1);
  return typeof last === 'function' ? (last as (answer: T) => void) : () => {};
}
