import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import {
  errorEnvelope,
  PLAYER_VIEW_AUTH,
  ROOMS,
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
import { applyLiveCommand, type LiveEffect, type LiveResult } from '../domain/live.js';
import { liveVersions, type VersionCounters } from '../domain/version.js';
import { isSameOriginHeaders, type Auth } from '../http/auth.js';
import { createLineLimiter, type LineLimiterOptions } from '../log/limiter.js';
import type { Logger } from '../log/logger.js';
import { project } from './projection.js';
import { readSnapshot } from './snapshot.js';

// The WebSocket of the live scene (LIV-01; specs/04-live-sync.md §1, §2, §5, §6,
// specs/07-security-and-access.md §2, §3, §7, §8; D-064, D-104).
//
// Socket.io shares the HTTP server's port, at SOCKET_PATH, over WebSocket only. The
// handshake is refused when its Origin is not this server as the browser addressed it
// (Q-043). A socket whose Cookie header carries a valid DM session joins `dm`, every
// other socket joins `players`; nothing the client sends can raise it to `dm` (Q-046). The
// player view's hint (PLAYER_VIEW_AUTH) only lowers: its socket joins `players` even from a
// browser holding a DM session, so a TV driven by the DM's laptop receives only what players
// may see, and that socket carries no DM rights (D-105). Each
// socket receives the snapshot of its room on connection, and again whenever it asks
// on the `snapshot` channel after seeing a gap. When a session ends (sign-out, a PIN
// change, a new first PIN) its sockets are disconnected at once (G-011); a browser
// reconnecting afterwards joins `players`. A command from any socket outside `dm` is
// refused in the error envelope before it is even validated, and changes nothing.
//
// Commands (LIV-02): a DM command is validated against its payload schema and applied to the
// database (`server/src/domain/live.ts`); each effect is projected into what each room receives
// (`projection.ts`) and emitted to the room, and only then is the sender acknowledged, so the
// events of its own command reach it before the answer does.
//
// REST changes (LIV-04): a route that can change what a room sees of the live scene runs its change
// through `refresh`, which sends each room a fresh snapshot of the live scene when its view changed,
// or the idle state when the change cleared it (specs/04-live-sync.md §10, specs/03-domain-model.md §7).
//
// Versions (Q-056, Q-093, D-104, D-108): each room has its own counter, which takes version 1
// for the state at start-up; a snapshot sent to one socket carries its room's current version
// and takes none, so another client never sees a gap because a screen connected. An event
// takes the next version of each room it is sent to, so players, who receive nothing about
// hidden tokens, see no hole either.
//
// Abuse limits (LIV-01 review, D-106): an HTTP upgrade to any other path is answered 404 and
// closed at once, as Fastify answered it before there was a WebSocket, except Vite's own in
// development; a socket's snapshot requests are served at most one per interval, the rest
// merged into the next; a socket whose outgoing packets pile up unread is dropped; and the
// connection lines are limited per address like rejected requests (G-006).

export interface LiveSocketOptions {
  db: Database.Database;
  logger: Logger;
  auth: Auth;
  /** The process's version counters, one per room; tests pass their own. */
  versions?: VersionCounters | undefined;
  /** Command validation and the step that applies a valid command; tests only replace them. */
  commands?: { validate: CommandValidator; apply: (command: CommandEnvelope) => LiveResult | void } | undefined;
  /** Upgrades on other paths that belong to someone else: Vite's hot reload in development. */
  foreignUpgrade?: ((request: IncomingMessage) => boolean) | undefined;
  /** At most one requested snapshot per socket per this many milliseconds. */
  snapshotIntervalMs?: number | undefined;
  /** Outgoing packets a socket may leave unread before it is dropped. */
  maxPendingPackets?: number | undefined;
  /** Limits on connection log lines; the defaults suit production. */
  connectionLines?: Omit<LineLimiterOptions, 'onDropped'> | undefined;
}

export interface LiveSocket {
  io: Server;
  /** The sockets in each room now, for the tests and the log. */
  count(room: Room): number;
  /**
   * Runs a REST change and tells each room what it changed of the live scene (LIV-04): the idle
   * state to both rooms when it cleared the live scene, otherwise a fresh snapshot to each room whose
   * snapshot it changed, and nothing to a room whose view of the live scene stayed the same.
   */
  refresh: <T>(work: () => T) => T;
}

// A command or a snapshot request is small; nothing a DM sends comes near this.
const MAX_MESSAGE_BYTES = 64 * 1024;
export const SNAPSHOT_INTERVAL_MS = 1_000;
export const MAX_PENDING_PACKETS = 256;

const NOT_FOUND = 'HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n';
const isSocketPath = (url: string | undefined): boolean => (url ?? '').split('?', 1)[0]!.startsWith(`${SOCKET_PATH}/`);

/** Vite's hot-reload WebSocket, which shares the HTTP server in development. */
export const isViteUpgrade = (request: IncomingMessage): boolean =>
  /\bvite-(?:hmr|ping)\b/.test(String(request.headers['sec-websocket-protocol'] ?? ''));

export function attachLiveSocket(
  app: FastifyInstance,
  {
    db,
    logger,
    auth,
    versions = liveVersions,
    commands = { validate: validateCommand, apply: (command) => applyLiveCommand(db, command) },
    foreignUpgrade = () => false,
    snapshotIntervalMs = SNAPSHOT_INTERVAL_MS,
    maxPendingPackets = MAX_PENDING_PACKETS,
    connectionLines = {},
  }: LiveSocketOptions,
): LiveSocket {
  for (const counter of Object.values(versions)) if (counter.current() === 0) counter.next();

  const io = new Server(app.server, {
    path: SOCKET_PATH,
    serveClient: false,
    transports: ['websocket'],
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
    // Other paths' upgrades are ended below, at once, not after the engine's delay.
    destroyUpgrade: false,
    allowRequest: (request, callback) => {
      callback(null, isSameOriginHeaders(request.headers));
    },
  });

  // Nothing else answers an upgrade: without this a stray one would hold its socket forever and
  // keep the server from closing (review F1).
  const onUpgrade = (request: IncomingMessage, stream: Duplex): void => {
    if (isSocketPath(request.url) || foreignUpgrade(request)) return;
    stream.end(NOT_FOUND);
    setTimeout(() => stream.destroy(), 1_000).unref();
  };
  app.server.on('upgrade', onUpgrade);

  const lines = createLineLimiter({
    ...connectionLines,
    onDropped: (dropped, addresses) =>
      logger.warn('ws.lines_dropped', `${dropped} connection lines were not logged.`, { dropped, addresses }),
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

  // A client that does not read what it asked for is dropped rather than buffered for.
  const overloaded = (socket: Socket): boolean => {
    // engine.io queues packets here while the transport is still sending earlier ones; its
    // typings mark the queue private, but it is the only measure of what the client left unread.
    const pending = (socket.conn as unknown as { writeBuffer: readonly unknown[] }).writeBuffer.length;
    if (pending <= maxPendingPackets) return false;
    logger.warn('ws.overloaded', 'A socket left too many messages unread and was disconnected.', {
      address: normalizeAddress(socket.request.socket.remoteAddress),
    });
    socket.disconnect(true);
    return true;
  };

  const sendSnapshot = (socket: Socket, role: Room): void => {
    if (overloaded(socket)) return;
    const event: SnapshotEvent = {
      type: 'scene.snapshot',
      version: versions[role].current(),
      payload: readSnapshot(db, role),
    };
    socket.emit(SOCKET_CHANNELS.event, event);
  };

  // One event to every socket of a room, each version taken once for the room. A socket that left
  // too much unread is dropped rather than buffered for, as for snapshots.
  const broadcast = (room: Room, event: { type: string; payload: object }): void => {
    const versioned = { ...event, version: versions[room].next() };
    for (const id of io.sockets.adapter.rooms.get(room) ?? []) {
      const socket = io.sockets.sockets.get(id);
      if (socket && !overloaded(socket)) socket.emit(SOCKET_CHANNELS.event, versioned);
    }
  };

  // A REST change to the live scene's setup, to an asset a live token uses, or a deletion of the
  // live scene or an ancestor (LIV-04; specs/04-live-sync.md §10, specs/03-domain-model.md §7,
  // specs/05-assets-and-images.md §5, Q-015, Q-031). Each room's snapshot is read before and after,
  // in the same synchronous step as the change, so no command can come between them; a room is told
  // only when what it sees changed. Players therefore learn nothing of a change that touched only a
  // hidden token (a renamed or re-imaged asset whose live tokens are all hidden): the DM's room gets
  // its snapshot, theirs stays silent and keeps its version (specs/04-live-sync.md §4, §5, Q-093).
  const refresh = <T>(work: () => T): T => {
    const before = { dm: readSnapshot(db, 'dm'), players: readSnapshot(db, 'players') };
    const result = work();
    const after = { dm: readSnapshot(db, 'dm'), players: readSnapshot(db, 'players') };
    if (before.dm.scene !== null && after.dm.scene === null) {
      publish([{ type: 'cleared' }]);
      return result;
    }
    for (const room of ROOMS) {
      if (JSON.stringify(before[room]) !== JSON.stringify(after[room])) {
        broadcast(room, { type: 'scene.snapshot', payload: after[room] });
      }
    }
    return result;
  };

  const publish = (effects: readonly LiveEffect[]): void => {
    for (const effect of effects) {
      const events = project(db, effect);
      for (const room of ROOMS) {
        const event = events[room];
        if (event) broadcast(room, event);
      }
    }
  };

  io.on('connection', (socket) => {
    const playerView = (socket.handshake.auth as { view?: unknown }).view === PLAYER_VIEW_AUTH.view;
    // A player view's socket holds no session at all: it can neither command nor stay a DM.
    const session = playerView ? undefined : auth.sessionOfCookie(socket.request.headers.cookie);
    const role: Room = session === undefined ? 'players' : 'dm';
    const address = normalizeAddress(socket.request.socket.remoteAddress);
    void socket.join(role);
    if (session !== undefined) {
      const sockets = bySession.get(session) ?? new Set<Socket>();
      sockets.add(socket);
      bySession.set(session, sockets);
    }
    // The role and the address; never the session or the cookie (specs/07-security-and-access.md §8).
    if (lines.admit(address)) {
      logger.info('ws.connected', `A ${role === 'dm' ? 'DM view' : 'player view'} connected from ${address}.`, {
        role,
        address,
      });
    }

    sendSnapshot(socket, role);

    socket.on(SOCKET_CHANNELS.command, (...args: unknown[]) => {
      if (overloaded(socket)) return;
      const reply = acknowledgement<CommandAck>(args);
      // Read again for every command: a session ended a moment ago commands nothing, even
      // before its socket is gone.
      if (role !== 'dm' || session === undefined || !auth.sessions.has(session)) {
        reply(errorEnvelope('forbidden', 'Commands are accepted from the DM view only.'));
        return;
      }
      // A failure while applying or projecting answers the sender and is logged, without the payload;
      // Socket.io calls this listener outside any promise, so a throw would end the whole process and
      // blank every screen (review L2). A failed apply changed nothing: its transaction rolled back.
      try {
        let effects: readonly LiveEffect[] = [];
        const ack = dispatchCommand(
          typeof args[0] === 'function' ? undefined : args[0],
          commands.validate,
          (command) => {
            const result = commands.apply(command);
            if (Array.isArray(result)) effects = result;
            else return result;
          },
        );
        publish(effects);
        reply(ack);
      } catch (error) {
        logger.error('ws.command_failed', 'A live command failed.', {
          error: error instanceof Error ? error.message : String(error),
        });
        reply(errorEnvelope('internal_error', 'The command failed on the server.'));
      }
    });

    // One requested snapshot per interval: a request inside it is served when it ends, and any
    // more meanwhile are merged into that one, unanswered (the client asks again if it must).
    let lastRequested = -Infinity;
    let scheduled: NodeJS.Timeout | undefined;
    let pendingAck: ((answer: SnapshotAck) => void) | undefined;
    const serve = (): void => {
      scheduled = undefined;
      lastRequested = Date.now();
      sendSnapshot(socket, role);
      const ack = pendingAck;
      pendingAck = undefined;
      if (socket.connected) ack?.({ ok: true });
    };
    socket.on(SOCKET_CHANNELS.snapshot, (...args: unknown[]) => {
      if (scheduled) return;
      pendingAck = acknowledgement<SnapshotAck>(args);
      const wait = lastRequested + snapshotIntervalMs - Date.now();
      if (wait <= 0) serve();
      else scheduled = setTimeout(serve, wait);
    });

    socket.on('disconnect', () => {
      clearTimeout(scheduled);
      if (session !== undefined) {
        const sockets = bySession.get(session);
        sockets?.delete(socket);
        if (sockets?.size === 0) bySession.delete(session);
      }
      if (lines.admit(address)) {
        logger.info('ws.disconnected', `A ${role === 'dm' ? 'DM view' : 'player view'} disconnected (${address}).`, {
          role,
          address,
        });
      }
    });
  });

  // Before Fastify closes the HTTP server: open WebSockets would keep it waiting.
  app.addHook('preClose', (done) => {
    unsubscribe();
    app.server.off('upgrade', onUpgrade);
    lines.flush();
    io.disconnectSockets(true);
    io.engine.close();
    done();
  });

  return { io, count: (room) => io.sockets.adapter.rooms.get(room)?.size ?? 0, refresh };
}

/** The acknowledgement a client passed as the last argument, or a no-op when it passed none. */
function acknowledgement<T>(args: unknown[]): (answer: T) => void {
  const last = args.at(-1);
  return typeof last === 'function' ? (last as (answer: T) => void) : () => {};
}
