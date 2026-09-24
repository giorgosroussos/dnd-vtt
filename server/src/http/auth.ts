import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  API_PATHS,
  AuthStateSchema,
  PinBodySchema,
  PinChangeBodySchema,
  PUBLIC_API_ROUTES,
  SettingsSchema,
  SetupStateSchema,
  type AuthState,
  type PinBody,
  type PinChangeBody,
  type Settings,
  type SetupState,
} from '@emberglass/shared';
import { createLockout, isLoopback, normalizeAddress, type Lockout } from '../auth/lockout.js';
import { hashPin, SCRYPT_PARAMS, verifyPin, type ScryptParams } from '../auth/pin-hash.js';
import { createSessionStore, SESSION_ID_PATTERN, type SessionStore } from '../auth/sessions.js';
import { readPinHash, readSettings, replacePinHash, setFirstPinHash } from '../db/settings.js';
import type { Logger } from '../log/logger.js';
import { ApiFailure } from './errors.js';

// The PIN, DM sessions and the checks every /api request passes
// (specs/07-security-and-access.md §1, §2, §6, §7, specs/02-architecture.md §5,
// D-027, D-028, D-048, D-076).
//
// One onRequest hook, which runs before a body is parsed and also for paths no
// route matches, answers every /api request without a DM session the same way,
// except PIN entry and setup, so that a browser without the PIN cannot tell a
// real route from an unknown one or learn what a body should look like (G-005).
// It also refuses a REST write whose Origin is not this server (Q-043).

export const DM_COOKIE = 'emberglass_dm';
// The server ends a session at restart; the cookie itself outlives a closed
// browser, so that the session lasts until the server restarts (Q-008).
// 400 days is the longest lifetime browsers keep.
export const DM_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const PUBLIC = new Set<string>(PUBLIC_API_ROUTES.map(({ method, url }) => `${method} ${url}`));

export interface AuthOptions {
  db: Database.Database;
  logger: Logger;
  /** Milliseconds since the epoch; the lockout's clock. */
  now?: (() => number) | undefined;
  /** The cost of new PIN hashes; tests only lower it. */
  pinHashParams?: Readonly<ScryptParams> | undefined;
}

export interface Auth {
  sessions: SessionStore;
  lockout: Lockout;
  /** The DM session the request carries, if it carries a valid one. */
  sessionOf(request: FastifyRequest): string | undefined;
}

export function clientAddress(request: FastifyRequest): string {
  return normalizeAddress(request.socket.remoteAddress);
}

/** The values of the DM cookie in a Cookie header; a browser may send more than one. */
export function dmCookieValues(header: string | undefined): string[] {
  if (!header) return [];
  const values: string[] = [];
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === DM_COOKIE) values.push(part.slice(eq + 1).trim());
  }
  return values;
}

/** An unsafe method's Origin, when present, must be this server as the browser addressed it. */
export function isSameOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  const host = request.headers.host;
  if (typeof origin !== 'string' || !host) return false;
  try {
    const from = new URL(origin);
    return from.protocol === 'http:' && from.host === new URL(`http://${host}`).host;
  } catch {
    // `Origin: null` (a sandboxed or privacy-sensitive context) and anything unparsable.
    return false;
  }
}

const underApi = (path: string): boolean => path === '/api' || path.startsWith('/api/');

/**
 * A path as a server that decodes it might read it: dot segments resolved,
 * percent-escapes decoded, repeated slashes collapsed. Null if it cannot be decoded.
 */
export function normalizedPath(raw: string): string | null {
  try {
    return decodeURIComponent(new URL(`http://host${raw}`).pathname).replace(/\/{2,}/g, '/');
  } catch {
    return null;
  }
}

// A matched route decides by its pattern. An unmatched path is an API request if
// it is under /api as sent or as normalised: otherwise `/%61pi/settings` (a real
// route, 401) and `/%61pi/nope` (404) would tell routes apart without a session.
function isApiRequest(request: FastifyRequest): boolean {
  const route = request.routeOptions.url;
  if (route !== undefined) return underApi(route);
  const raw = request.url.split('?', 1)[0] ?? '';
  const normal = normalizedPath(raw);
  return underApi(raw) || (normal !== null && underApi(normal));
}

/**
 * The server machine itself, both by its address and by the name the browser
 * used for it. The name matters for setup: a web page whose own host name was
 * re-pointed at 127.0.0.1 (DNS rebinding) sends a loopback address and a
 * matching Origin, but its Host is its own name.
 */
export function isServerMachine(request: FastifyRequest): boolean {
  if (!isLoopback(clientAddress(request))) return false;
  const host = request.headers.host;
  if (!host) return false;
  try {
    const name = new URL(`http://${host}`).hostname;
    return name === 'localhost' || name === '[::1]' || isLoopback(name);
  } catch {
    return false;
  }
}

const setCookie = (reply: FastifyReply, id: string): FastifyReply =>
  reply.header('set-cookie', `${DM_COOKIE}=${id}; Path=/; Max-Age=${DM_COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Strict`);
const clearCookie = (reply: FastifyReply): FastifyReply =>
  reply.header('set-cookie', `${DM_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`);

const lockedOut = (retryAfterMs: number): ApiFailure =>
  new ApiFailure(429, 'locked_out', 'PIN entry from this address is locked for a while.', {
    headers: { 'retry-after': String(Math.ceil(retryAfterMs / 1000)) },
  });
const pinIncorrect = (): ApiFailure => new ApiFailure(401, 'pin_incorrect', 'The PIN is not correct.', { quiet: true });
const pinNotSet = (): ApiFailure => new ApiFailure(409, 'pin_not_set', 'No PIN is set yet.');
const pinAlreadySet = (): ApiFailure => new ApiFailure(409, 'pin_already_set', 'A PIN is already set.');

export function registerAuth(
  app: FastifyInstance,
  { db, logger, now = Date.now, pinHashParams = SCRYPT_PARAMS }: AuthOptions,
): Auth {
  const sessions = createSessionStore();
  const lockout = createLockout(now);
  const sessionOf = (request: FastifyRequest): string | undefined =>
    dmCookieValues(request.headers.cookie).find((value) => SESSION_ID_PATTERN.test(value) && sessions.has(value));

  app.addHook('onRequest', async (request, reply) => {
    if (!isApiRequest(request)) return;
    // Nothing under /api is for a cache: the answers depend on the session.
    reply.header('cache-control', 'no-store');
    if (!SAFE_METHODS.has(request.method) && !isSameOrigin(request)) {
      throw new ApiFailure(403, 'forbidden', 'The request does not come from this server.');
    }
    const route = request.routeOptions.url;
    if (route !== undefined && PUBLIC.has(`${request.method} ${route}`)) return;
    // The role comes from the session and from nothing the client declares (Q-046).
    if (sessionOf(request) === undefined) throw new ApiFailure(401, 'unauthorized', 'A DM session is required.');
  });

  /** Counts the attempt, checks `pin` against the stored hash, logs a failure; throws unless right. */
  const checkPin = async (request: FastifyRequest, pin: string, stored: string): Promise<void> => {
    const address = clientAddress(request);
    const attempt = lockout.begin(address);
    if (!attempt.allowed) throw lockedOut(attempt.retryAfterMs);
    if (await verifyPin(pin, stored)) {
      lockout.succeeded(address);
      return;
    }
    logger.warn('pin.failed', `Wrong PIN from ${address}.`, { address, failures: attempt.failures });
    if (attempt.lockedMs !== null) {
      const seconds = attempt.lockedMs / 1000;
      logger.warn('pin.locked', `PIN entry from ${address} is locked for ${seconds} s.`, { address, seconds });
    }
    throw pinIncorrect();
  };

  const signIn = (request: FastifyRequest, reply: FastifyReply): AuthState => {
    // A fresh identifier every time, never the one the browser brought.
    sessions.end(sessionOf(request));
    setCookie(reply, sessions.create());
    return { dm: true };
  };

  app.get(API_PATHS.auth, { schema: { response: { 200: AuthStateSchema } } }, async (request, reply) => {
    const dm = sessionOf(request) !== undefined;
    if (!dm && dmCookieValues(request.headers.cookie).length > 0) clearCookie(reply);
    return { dm } satisfies AuthState;
  });

  app.post<{ Body: PinBody }>(
    API_PATHS.auth,
    { schema: { body: PinBodySchema, response: { 200: AuthStateSchema } } },
    async (request, reply) => {
      const stored = readPinHash(db);
      if (stored === null) throw pinNotSet();
      await checkPin(request, request.body.pin, stored);
      // The PIN may have changed (or been reset and set again) while this one was
      // being hashed. Checked after the hash, in the same synchronous step that
      // creates the session, so a session made with the old PIN can never outlive
      // the change that was meant to end it (Q-033).
      if (readPinHash(db) !== stored) throw new ApiFailure(401, 'pin_incorrect', 'The PIN is not correct.');
      logger.info('auth.signed_in', 'A browser signed in to the DM view.', { address: clientAddress(request) });
      return signIn(request, reply);
    },
  );

  app.delete(API_PATHS.auth, async (request, reply) => {
    const session = sessionOf(request);
    if (session !== undefined) {
      sessions.end(session);
      logger.info('auth.signed_out', 'A browser signed out of the DM view.', { address: clientAddress(request) });
    }
    return clearCookie(reply).code(204).send();
  });

  app.get(API_PATHS.setup, { schema: { response: { 200: SetupStateSchema } } }, (request, reply) => {
    return reply.send({
      pin_set: readPinHash(db) !== null,
      local: isServerMachine(request),
    } satisfies SetupState);
  });

  app.post<{ Body: PinBody }>(
    API_PATHS.setup,
    {
      schema: { body: PinBodySchema, response: { 200: AuthStateSchema } },
      // Before the body is parsed: a browser on the LAN learns nothing about the body.
      onRequest: (request, _reply, done) => {
        if (isServerMachine(request)) done();
        else done(new ApiFailure(403, 'forbidden', 'The PIN is set from the server machine only.'));
      },
    },
    async (request, reply) => {
      if (readPinHash(db) !== null) throw pinAlreadySet();
      const hash = await hashPin(request.body.pin, pinHashParams);
      if (!setFirstPinHash(db, hash)) throw pinAlreadySet();
      // After `npm run reset-pin` sessions of the old PIN may still be open: a new PIN ends them.
      const ended = sessions.endAllExcept(undefined);
      logger.info('pin.set', 'The DM PIN was set on the server machine.', { address: clientAddress(request), ended });
      return signIn(request, reply);
    },
  );

  // The settings a DM route returns never include the PIN hash: the columns are
  // listed and the response is serialised through the strict schema (G-008).
  app.get(API_PATHS.settings, { schema: { response: { 200: SettingsSchema } } }, (_request, reply) => {
    return reply.send(readSettings(db) satisfies Settings);
  });

  app.put<{ Body: PinChangeBody }>(API_PATHS.pin, { schema: { body: PinChangeBodySchema } }, async (request, reply) => {
    const keep = sessionOf(request);
    const stored = readPinHash(db);
    if (stored === null) throw pinNotSet();
    await checkPin(request, request.body.current_pin, stored);
    const hash = await hashPin(request.body.new_pin, pinHashParams);
    // Changed by another device while this one was hashing: its current PIN is no longer current.
    if (!replacePinHash(db, stored, hash)) throw new ApiFailure(401, 'pin_incorrect', 'The PIN is not correct.');
    const ended = sessions.endAllExcept(keep);
    logger.info('pin.changed', `The DM PIN was changed; ${ended} other DM sessions ended.`, {
      address: clientAddress(request),
      ended,
    });
    return reply.code(204).send();
  });

  return { sessions, lockout, sessionOf };
}
