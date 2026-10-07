import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import {
  errorEnvelope,
  PLAYER_VIEW_AUTH,
  ROOMS,
  samePlayerEncounter,
  SOCKET_CHANNELS,
  SOCKET_PATH,
  SOCKET_REFUSALS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  ScreenSchema,
  type CommandAck,
  type CommandEnvelope,
  type Room,
  type SnapshotAck,
  type Screen,
  type SnapshotEvent,
  type UndoState,
  type ViewportAck,
  type NotesUpdatedPayload,
} from '@emberglass/shared';
import { isLoopback, lockoutKey, normalizeAddress } from '../auth/lockout.js';
import { readScene } from '../db/campaigns.js';
import { readSettings } from '../db/settings.js';
import { listMapNotes } from '../db/mapNotes.js';
import { PlayerCameraState, ScreenRegistry, sameScreen } from '../domain/camera.js';
import { dispatchCommand, validateCommand, type CommandValidator } from '../domain/commands.js';
import { createLiveCommands, type LiveEffect, type LiveResult } from '../domain/live.js';
import { RulerState } from '../domain/ruler.js';
import { UndoHistory } from '../domain/undo.js';
import { liveVersions, type VersionCounters } from '../domain/version.js';
import { isSameOriginHeaders, type Auth } from '../http/auth.js';
import { createLineLimiter, type LineLimiterOptions } from '../log/limiter.js';
import type { Logger } from '../log/logger.js';
import { project } from './projection.js';
import { compileSchema, formatAjvErrors } from '../validation.js';
import { livePlayerEncounter, readSnapshot, type LiveMemory } from './snapshot.js';

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
// events of its own command reach it before the answer does. `undo` (LIV-05) is one more command:
// the inverse it applies is projected and emitted as the command it stands for (D-040).
//
// REST changes (LIV-04): a route that can change what a room sees of the live scene runs its change
// through `refresh`, which sends each room a fresh snapshot of the live scene when its view changed,
// or the idle state when the change cleared it (specs/04-live-sync.md §10, specs/03-domain-model.md §7).
// A change of the live scene's notes or one of its tokens' (DMT-04) is told to the DM room alone, as
// `notes.updated` from `notesChanged`, never as a snapshot: the players room hears nothing and keeps its version.
// A change of the live scene's map notes (UXR-08) likewise reaches the DM room alone, as `mapNotes.updated`.
//
// Versions (Q-056, Q-093, D-104, D-108): each room has its own counter, which takes version 1
// for the state at start-up; a snapshot sent to one socket carries its room's current version
// and takes none, so another client never sees a gap because a screen connected. An event
// takes the next version of each room it is sent to, so players, who receive nothing about
// hidden tokens, see no hole either.
//
// Cameras (LIV-06; specs/04-live-sync.md §9, Q-038, D-018, D-119): the player camera lives in memory
// beside the live commands, and both rooms' snapshots carry it. A players socket may report its
// viewport on SOCKET_CHANNELS.viewport, which is not a command and changes nothing players receive:
// the DM room is told, as `camera.player` with the camera unchanged, when the shape of the screen
// connected longest changes while a scene is live, since the TV frame follows it. Reports are
// validated like any command and served at most one per snapshot interval per socket, the latest
// winning. A REST change that gives the live scene another world (a new map, or a first map for a
// map-less scene) fits the camera again, since the old frame was of a world that is gone.
//
// The ruler (LIV-07; specs/04-live-sync.md §11, Q-027, Q-086, D-121): the measurement shown on the TV
// lives in memory beside the camera, both rooms' snapshots carry it, and the same new world takes it
// off. A DM socket that goes takes off the measurement it drew, if still shown, so a DM laptop that
// sleeps or a session that ends leaves no line on the TV.
//
// Abuse limits (LIV-01 review, D-106): an HTTP upgrade to any other path is answered 404 and
// closed at once, as Fastify answered it before there was a WebSocket, except Vite's own in
// development; a socket's snapshot requests are served at most one per interval, the rest
// merged into the next; a socket whose outgoing packets pile up unread is dropped; and the
// connection lines are limited per address like rejected requests (G-006). One LAN address holds
// at most MAX_PLAYER_SOCKETS_PER_ADDRESS player sockets at once, an IPv6 one by its /64 as the PIN
// limits count it, so a device opening hundreds cannot make every broadcast cost that many
// encodings (G-029); a socket past the cap is refused in the handshake, before it joins a room or
// hears anything. The server PC itself is not capped, nor is a DM view.
//
// The undo state (UIX-01, specs/04-live-sync.md §8): whether undo and redo would find anything, sent to the
// DM room as `history.changed` after a command or a REST change that altered it, read before and after in
// the same synchronous step; a change that sends the DM room a snapshot or `scene.cleared` needs none, since
// the snapshot carries the state and nothing is live after a clear. Players never hear it.

export interface LiveSocketOptions {
  db: Database.Database;
  logger: Logger;
  auth: Auth;
  /** The process's version counters, one per room; tests pass their own. */
  versions?: VersionCounters | undefined;
  /** The player camera and the screens that reported; tests pass their own. */
  camera?: PlayerCameraState | undefined;
  screens?: ScreenRegistry | undefined;
  /** The measurement shown on the TV (LIV-07); tests pass their own. */
  ruler?: RulerState | undefined;
  /** The undo history (LIV-05, UIX-01); tests pass their own. */
  history?: UndoHistory | undefined;
  /** Command validation and the step that applies a valid command; tests only replace them. */
  commands?:
    | {
        validate: CommandValidator;
        apply: (command: CommandEnvelope, sender?: string) => LiveResult | void;
        /** What a DM socket going takes off the TV. */
        release?: (sender: string) => readonly LiveEffect[];
      }
    | undefined;
  /** Upgrades on other paths that belong to someone else: Vite's hot reload in development. */
  foreignUpgrade?: ((request: IncomingMessage) => boolean) | undefined;
  /** At most one requested snapshot per socket per this many milliseconds. */
  snapshotIntervalMs?: number | undefined;
  /** Outgoing packets a socket may leave unread before it is dropped. */
  maxPendingPackets?: number | undefined;
  /** Limits on connection log lines; the defaults suit production. */
  connectionLines?: Omit<LineLimiterOptions, 'onDropped'> | undefined;
  /** Player sockets one address may hold at once (G-029); tests pass a small one. */
  maxPlayerSocketsPerAddress?: number | undefined;
  /** A handshake's client address; tests pass one that reads a header, since theirs is loopback. */
  clientAddress?: ((request: IncomingMessage) => string | undefined) | undefined;
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
  /**
   * Tells the DM room of a change of notes (DMT-04, specs/04-live-sync.md §3, §16), when they are the live scene's or
   * one of its tokens': the players room never hears of notes, and a scene not live reaches no client.
   */
  notesChanged: (payload: NotesUpdatedPayload) => void;
  /**
   * Tells the DM room of a change of a scene's map notes (UXR-08, specs/04-live-sync.md §3, §16), when it is the
   * live scene: `mapNotes.updated` with all of them. The players room never hears of map notes.
   */
  mapNotesChanged: (sceneId: string) => void;
}

// A command or a snapshot request is small; nothing a DM sends comes near this.
const MAX_MESSAGE_BYTES = 64 * 1024;
export const SNAPSHOT_INTERVAL_MS = 1_000;
export const MAX_PENDING_PACKETS = 256;
// A TV, a spare screen and a few tabs, with room for sockets a sleeping device left behind until the
// heartbeat drops them.
export const MAX_PLAYER_SOCKETS_PER_ADDRESS = 16;

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
    // One player camera per server process, in memory only (specs/04-live-sync.md §9, Q-038).
    camera = new PlayerCameraState(),
    screens = new ScreenRegistry(),
    // One measurement per server process, in memory only (specs/04-live-sync.md §11).
    ruler = new RulerState(),
    // One undo history per server process, in memory only (specs/04-live-sync.md §8, Q-005).
    history = new UndoHistory(),
    commands = { validate: validateCommand, ...createLiveCommands(db, history, camera, ruler) },
    foreignUpgrade = () => false,
    snapshotIntervalMs = SNAPSHOT_INTERVAL_MS,
    maxPendingPackets = MAX_PENDING_PACKETS,
    connectionLines = {},
    maxPlayerSocketsPerAddress = MAX_PLAYER_SOCKETS_PER_ADDRESS,
    clientAddress = (request) => request.socket.remoteAddress,
  }: LiveSocketOptions,
): LiveSocket {
  for (const counter of Object.values(versions)) if (counter.current() === 0) counter.next();
  const memory: LiveMemory = { camera, screens, ruler, history };

  const io = new Server(app.server, {
    path: SOCKET_PATH,
    serveClient: false,
    transports: ['websocket'],
    pingInterval: HEARTBEAT_INTERVAL_MS,
    pingTimeout: HEARTBEAT_TIMEOUT_MS,
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
      address: normalizeAddress(clientAddress(socket.request)),
    });
    socket.disconnect(true);
    return true;
  };

  const sendSnapshot = (socket: Socket, role: Room): void => {
    if (overloaded(socket)) return;
    const event: SnapshotEvent = {
      type: 'scene.snapshot',
      version: versions[role].current(),
      payload: readSnapshot(db, role, memory),
    };
    socket.emit(SOCKET_CHANNELS.event, event);
  };

  // The screen shape the DM room was last told, in a snapshot or a `camera.player` (LIV-06).
  let toldScreen: Screen | null = null;

  // One event to every socket of a room, each version taken once for the room. A socket that left
  // too much unread is dropped rather than buffered for, as for snapshots.
  const broadcast = (room: Room, event: { type: string; payload: object }): void => {
    const versioned = { ...event, version: versions[room].next() };
    // What the DM room was last told of the screen the frame follows, so a shape it already has is not
    // sent again (review S-M1).
    if (room === 'dm' && event.type === 'scene.snapshot') {
      const payload = event.payload as { scene: { screen: Screen | null } | null };
      if (payload.scene) toldScreen = payload.scene.screen;
    }
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
    const undoBefore = undoState();
    const before = { dm: readSnapshot(db, 'dm', memory), players: readSnapshot(db, 'players', memory) };
    const world = liveWorld(db);
    const result = work();
    // Another world for the same live scene: the camera fits it again (LIV-06, D-119).
    const now = liveWorld(db);
    if (world !== undefined && now !== undefined && world !== now) {
      camera.reset();
      // A measurement between squares of a map that is gone means nothing on the new one (D-121).
      ruler.clear();
    }
    const after = { dm: readSnapshot(db, 'dm', memory), players: readSnapshot(db, 'players', memory) };
    if (before.dm.scene !== null && after.dm.scene === null) {
      publish([{ type: 'cleared' }]);
      return result;
    }
    let snapshotToDm = false;
    for (const room of ROOMS) {
      if (JSON.stringify(before[room]) !== JSON.stringify(after[room])) {
        broadcast(room, { type: 'scene.snapshot', payload: after[room] });
        if (room === 'dm') snapshotToDm = true;
      }
    }
    if (!snapshotToDm) tellHistory(undoBefore);
    return result;
  };

  // Whether undo and redo would find anything on the live scene now, or null while nothing is live.
  const undoState = (): UndoState | null => {
    const live = readSettings(db).live_scene_id;
    return live === null ? null : history.stateFor(live);
  };
  // The DM room is told the undo state when it differs from `before`, with the same scene live.
  const tellHistory = (before: UndoState | null): void => {
    const now = undoState();
    if (now === null || before === null) return;
    if (before.can_undo === now.can_undo && before.can_redo === now.can_redo) return;
    broadcast('dm', { type: 'history.changed', payload: { ...now } });
  };

  // What players see of the live scene's encounter (TBL-06), or undefined while nothing is live.
  const playersEncounter = () => {
    const live = readSettings(db).live_scene_id;
    return live === null ? undefined : { live, encounter: livePlayerEncounter(db, live) };
  };
  // Players are told their projection of the encounter when it differs from `before`, with the same scene
  // live: whatever command changed it, a token's reveal, move or Dead as much as an encounter command, and
  // never when it did not, so nothing they receive depends on a token they cannot see (specs/04-live-sync.md §14).
  const tellEncounter = (before: ReturnType<typeof playersEncounter>): void => {
    const now = playersEncounter();
    if (now === undefined || before === undefined || now.live !== before.live) return;
    if (samePlayerEncounter(before.encounter, now.encounter)) return;
    broadcast('players', { type: 'encounter.updated', payload: { encounter: now.encounter } });
  };

  const publish = (effects: readonly LiveEffect[]): void => {
    for (const effect of effects) {
      const events = project(db, effect, memory);
      for (const room of ROOMS) {
        const event = events[room];
        if (event) broadcast(room, event);
      }
    }
  };

  // The DM room hears of a new shape for the TV frame while a scene is live; otherwise the next
  // activation's snapshot carries it. Players never hear of screens. However many player sockets report
  // or leave, the DM room is told at most once per interval, with the shape chosen by then, so no number
  // of LAN browsers can flood it (LIV-06 review S-M1).
  let lastShapeTold = -Infinity;
  let shapeTimer: NodeJS.Timeout | undefined;
  const tellShape = (): void => {
    shapeTimer = undefined;
    lastShapeTold = Date.now();
    const live = readSettings(db).live_scene_id;
    const chosen = screens.chosen();
    if (live === null || sameScreen(chosen, toldScreen)) return;
    toldScreen = chosen;
    broadcast('dm', { type: 'camera.player', payload: { camera: { ...camera.of(live) }, screen: chosen } });
  };
  // Nothing is scheduled once the server is closing: the sockets it drops then must not wake a timer
  // after the database has closed.
  let closing = false;
  const screenChanged = (): void => {
    if (shapeTimer || closing) return;
    const wait = lastShapeTold + snapshotIntervalMs - Date.now();
    if (wait <= 0) tellShape();
    else shapeTimer = setTimeout(tellShape, wait);
  };

  // Player sockets held per address key, loopback left out (G-029).
  const playersByAddress = new Map<string, number>();
  // The role, from the DM session alone (Q-046); a player view's socket holds no session at all, so it
  // can neither command nor stay a DM.
  const sessionOfSocket = (socket: Socket): string | undefined =>
    (socket.handshake.auth as { view?: unknown }).view === PLAYER_VIEW_AUTH.view
      ? undefined
      : auth.sessionOfCookie(socket.request.headers.cookie);

  // The cap on player sockets per address (G-029) is applied in the handshake, so a socket past it is
  // refused before it connects: the client hears a refusal, not a connection that ends, and retries
  // after a pause instead of at once (review H1). The count is released when the socket goes, with
  // the listener registered here, so no later step can leave it counted (review C-L3).
  io.use((socket, next) => {
    if (sessionOfSocket(socket) !== undefined) return next();
    const address = normalizeAddress(clientAddress(socket.request));
    if (isLoopback(address)) return next();
    const key = lockoutKey(address);
    const held = playersByAddress.get(key) ?? 0;
    if (held >= maxPlayerSocketsPerAddress) {
      if (lines.admit(address)) {
        logger.warn('ws.too_many', `Too many player views from ${address}; one more was refused.`, {
          address,
          limit: maxPlayerSocketsPerAddress,
        });
      }
      return next(new Error(SOCKET_REFUSALS.tooManyViews));
    }
    playersByAddress.set(key, held + 1);
    socket.on('disconnect', () => {
      const left = (playersByAddress.get(key) ?? 1) - 1;
      if (left > 0) playersByAddress.set(key, left);
      else playersByAddress.delete(key);
    });
    next();
  });

  io.on('connection', (socket) => {
    const session = sessionOfSocket(socket);
    const role: Room = session === undefined ? 'players' : 'dm';
    const address = normalizeAddress(clientAddress(socket.request));
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

    if (role === 'players') screens.connected(socket.id);
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
        const liveBefore = readSettings(db).live_scene_id;
        const undoBefore = undoState();
        const encounterBefore = playersEncounter();
        const ack = dispatchCommand(
          typeof args[0] === 'function' ? undefined : args[0],
          commands.validate,
          (command) => {
            const result = commands.apply(command, socket.id);
            if (Array.isArray(result)) effects = result;
            else return result;
          },
        );
        publish(effects);
        // An activation's snapshot carries the new scene's state; a clear leaves nothing live.
        if (readSettings(db).live_scene_id === liveBefore) {
          tellEncounter(encounterBefore);
          tellHistory(undoBefore);
        }
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

    // Viewport reports (LIV-06): a players socket only, validated, at most one per interval, the
    // latest winning; any more meanwhile are merged into it.
    let lastReported = -Infinity;
    let reportTimer: NodeJS.Timeout | undefined;
    let reported: Screen | undefined;
    const takeReport = (): void => {
      reportTimer = undefined;
      lastReported = Date.now();
      if (reported === undefined) return;
      screens.report(socket.id, reported);
      reported = undefined;
      screenChanged();
    };
    socket.on(SOCKET_CHANNELS.viewport, (...args: unknown[]) => {
      if (overloaded(socket)) return;
      const reply = acknowledgement<ViewportAck>(args);
      if (role !== 'players') {
        reply(errorEnvelope('forbidden', 'Only a player view reports its viewport.'));
        return;
      }
      const raw = typeof args[0] === 'function' ? undefined : args[0];
      if (!validateScreen(raw)) {
        reply(
          errorEnvelope(
            'validation_failed',
            'The viewport does not match its schema.',
            formatAjvErrors(validateScreen.errors),
          ),
        );
        return;
      }
      reported = { width: raw.width, height: raw.height };
      reply({ ok: true });
      if (reportTimer) return;
      const wait = lastReported + snapshotIntervalMs - Date.now();
      if (wait <= 0) takeReport();
      else reportTimer = setTimeout(takeReport, wait);
    });

    socket.on('disconnect', () => {
      clearTimeout(scheduled);
      clearTimeout(reportTimer);
      if (role === 'players') {
        screens.disconnected(socket.id);
        screenChanged();
      }
      if (session !== undefined) {
        const sockets = bySession.get(session);
        sockets?.delete(socket);
        if (sockets?.size === 0) bySession.delete(session);
      }
      // The measurement this DM socket drew leaves the TV with it (D-121); not once the server is closing.
      if (role === 'dm' && !closing) {
        try {
          publish(commands.release?.(socket.id) ?? []);
        } catch (error) {
          logger.error('ws.release_failed', 'Taking a measurement off the TV failed.', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
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
    closing = true;
    clearTimeout(shapeTimer);
    app.server.off('upgrade', onUpgrade);
    lines.flush();
    io.disconnectSockets(true);
    io.engine.close();
    done();
  });

  // Notes (DMT-04): the DM room's only, and only the live scene's; nothing else changes, so nothing else is sent.
  const notesChanged = (payload: NotesUpdatedPayload): void => {
    if (readSettings(db).live_scene_id !== payload.scene_id) return;
    broadcast('dm', { type: 'notes.updated', payload: { ...payload } });
  };

  // Map notes (UXR-08): likewise the DM room's only, the live scene's whole list after each change.
  const mapNotesChanged = (sceneId: string): void => {
    if (readSettings(db).live_scene_id !== sceneId) return;
    broadcast('dm', {
      type: 'mapNotes.updated',
      payload: { scene_id: sceneId, map_notes: listMapNotes(db, sceneId) ?? [] },
    });
  };

  return {
    io,
    count: (room) => io.sockets.adapter.rooms.get(room)?.size ?? 0,
    refresh,
    notesChanged,
    mapNotesChanged,
  };
}

const validateScreen = compileSchema<Screen>(ScreenSchema);

/**
 * What the live scene's world is, its map, or none; undefined while nothing is live. A map-less
 * scene's extent cannot change while it has no map (`calibration_needs_map`), so its map is all.
 */
function liveWorld(db: Database.Database): string | undefined {
  const id = readSettings(db).live_scene_id;
  const scene = id === null ? undefined : readScene(db, id);
  if (!scene) return undefined;
  return `${scene.id}:${scene.map_image_id ?? 'none'}`;
}

/** The acknowledgement a client passed as the last argument, or a no-op when it passed none. */
function acknowledgement<T>(args: unknown[]): (answer: T) => void {
  const last = args.at(-1);
  return typeof last === 'function' ? (last as (answer: T) => void) : () => {};
}
