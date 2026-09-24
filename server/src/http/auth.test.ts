import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthStateSchema,
  ErrorEnvelopeSchema,
  PUBLIC_API_ROUTES,
  SettingsSchema,
  SetupStateSchema,
  type ErrorEnvelope,
} from '@emberglass/shared';
import { SCRYPT_PARAMS, verifyPin } from '../auth/pin-hash.js';
import { resetPin } from '../auth/reset-pin.js';
import { readPinHash, readSettings } from '../db/settings.js';
import { createLogger, logFilePath, type TextSink } from '../log/logger.js';
import { MIGRATIONS_DIR } from '../paths.js';
import { pinSetupHint } from '../server.js';
import { compileSchema } from '../validation.js';
import { DM_COOKIE, normalizedPath } from './auth.js';
import { buildTestApp, createTestData, dmCookie, setUpPin, type TestData } from './testing/app.js';

// SRV-02: the PIN, the DM session and guessing protection, against a real SQLite
// file (specs/07-security-and-access.md §1, §2, §6, §7, §8, specs/02-architecture.md §5,
// specs/09-operations.md §2). PINs are six to eight digits where a log is read,
// so that no timestamp or count can contain one by chance.

// Each PIN check is a real scrypt hash (about 0.1 s alone, more beside other
// test workers), and some tests here make twenty.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const LAN = '192.168.1.20';
const OTHER_LAN = '192.168.1.21';
const PIN = '73019264';
const NEW_PIN = '591837';
const WRONG = '000000';
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const isEnvelope = compileSchema<ErrorEnvelope>(ErrorEnvelopeSchema);
const isSettings = compileSchema(SettingsSchema);
const isAuthState = compileSchema(AuthStateSchema);
const isSetupState = compileSchema(SetupStateSchema);

class Capture implements TextSink {
  text = '';
  write(chunk: string): boolean {
    this.text += chunk;
    return true;
  }
}

function expectFailure(response: LightMyRequestResponse, status: number, code: ErrorEnvelope['error']['code']): void {
  expect(response.statusCode, response.body).toBe(status);
  const body: unknown = response.json();
  expect(isEnvelope(body), JSON.stringify(isEnvelope.errors)).toBe(true);
  expect((body as ErrorEnvelope).error.code).toBe(code);
}

function setCookies(response: LightMyRequestResponse): string[] {
  return [response.headers['set-cookie'] ?? []].flat();
}

let data: TestData;
let app: FastifyInstance;
let clock: number;
let stdout: Capture;
let stderr: Capture;

async function start(options: Parameters<typeof buildTestApp>[1] = {}): Promise<FastifyInstance> {
  return buildTestApp(data, {
    logger: createLogger({ dataDir: data.dataDir, stdout, stderr }),
    now: () => clock,
    ...options,
  });
}

beforeEach(async () => {
  data = createTestData('emberglass-auth-');
  clock = Date.parse('2026-09-24T12:00:00Z');
  stdout = new Capture();
  stderr = new Capture();
  app = await start();
});

afterEach(async () => {
  await app.close();
  data.remove();
});

const inject = (options: InjectOptions) => app.inject(options);
const enter = (pin: string, remoteAddress = LAN, headers: Record<string, string> = {}) =>
  inject({ method: 'POST', url: '/api/auth', payload: { pin }, remoteAddress, headers });
const settings = (cookie?: string, remoteAddress = LAN) =>
  inject({ method: 'GET', url: '/api/settings', remoteAddress, headers: cookie ? { cookie } : {} });
const changePin = (cookie: string, current_pin: string, new_pin: string, remoteAddress = LAN) =>
  inject({
    method: 'PUT',
    url: '/api/settings/pin',
    payload: { current_pin, new_pin },
    remoteAddress,
    headers: { cookie },
  });
const signInFrom = async (remoteAddress: string, pin = PIN): Promise<string> => {
  const response = await enter(pin, remoteAddress);
  expect(response.statusCode, response.body).toBe(200);
  return dmCookie(response);
};

describe('first-run PIN setup (specs/07-security-and-access.md §1)', () => {
  it('tells a browser whether a PIN is set and whether it is on the server machine', async () => {
    for (const [remoteAddress, local] of [
      ['127.0.0.1', true],
      [LAN, false],
    ] as const) {
      const response = await inject({ method: 'GET', url: '/api/setup', remoteAddress });
      expect(response.statusCode).toBe(200);
      expect(isSetupState(response.json())).toBe(true);
      expect(response.json()).toEqual({ pin_set: false, local });
    }
    await setUpPin(app, PIN);
    const after = await inject({ method: 'GET', url: '/api/setup', remoteAddress: LAN });
    expect(after.json()).toEqual({ pin_set: true, local: false });
  });

  it('succeeds from a loopback address, stores a salted scrypt hash and never the PIN, and signs that browser in', async () => {
    // At the production cost: the stored format is what is under test.
    await app.close();
    app = await start({ pinHashParams: SCRYPT_PARAMS });
    const response = await inject({ method: 'POST', url: '/api/setup', payload: { pin: PIN } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ dm: true });
    const stored = readPinHash(data.db)!;
    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(stored).not.toContain(PIN);
    expect(await verifyPin(PIN, stored)).toBe(true);
    expect(await verifyPin(WRONG, stored)).toBe(false);
    // The database file holds the hash, not the PIN.
    data.db.pragma('wal_checkpoint(TRUNCATE)');
    expect(readFileSync(path.join(data.dataDir, 'emberglass.db')).includes(PIN)).toBe(false);
    expect((await settings(dmCookie(response))).statusCode).toBe(200);
  });

  it.each(['127.0.0.1', '127.8.9.10', '::1', '::ffff:127.0.0.1'])(
    'accepts setup from the loopback address %s',
    async (remoteAddress) => {
      const response = await inject({ method: 'POST', url: '/api/setup', payload: { pin: PIN }, remoteAddress });
      expect(response.statusCode, response.body).toBe(200);
    },
  );

  it.each([LAN, '10.0.0.7', 'fe80::1', '::ffff:192.168.1.20', '128.0.0.1'])(
    'refuses setup from the LAN address %s before reading the body, and stores nothing',
    async (remoteAddress) => {
      for (const payload of [JSON.stringify({ pin: PIN }), '{"pin":', '<pin/>']) {
        const response = await inject({
          method: 'POST',
          url: '/api/setup',
          payload,
          remoteAddress,
          headers: { 'content-type': payload.startsWith('<') ? 'application/xml' : 'application/json' },
        });
        expectFailure(response, 403, 'forbidden');
        expect(setCookies(response)).toEqual([]);
      }
      expect(readPinHash(data.db)).toBeNull();
    },
  );

  it.each(['evil.example:3000', 'evil.example', '192.168.1.5:3000', 'localhost.evil.example'])(
    'refuses setup from a loopback address whose Host is %s (DNS rebinding), with a matching Origin, and stores nothing',
    async (host) => {
      const headers = { host, origin: `http://${host}` };
      const state = await inject({ method: 'GET', url: '/api/setup', headers });
      expect(state.json()).toEqual({ pin_set: false, local: false });
      expectFailure(
        await inject({ method: 'POST', url: '/api/setup', payload: { pin: PIN }, headers }),
        403,
        'forbidden',
      );
      expect(readPinHash(data.db)).toBeNull();
    },
  );

  it.each(['localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'LOCALHOST'])(
    'accepts setup from a loopback address whose Host is %s',
    async (host) => {
      const headers = { host, origin: `http://${host}` };
      expect((await inject({ method: 'GET', url: '/api/setup', headers })).json()).toEqual({
        pin_set: false,
        local: true,
      });
      expect((await inject({ method: 'POST', url: '/api/setup', payload: { pin: PIN }, headers })).statusCode).toBe(
        200,
      );
    },
  );

  // light-my-request always sends a Host, so the missing case is covered by one
  // that cannot be parsed, which takes the same refusal.
  it('refuses setup from a loopback address whose Host cannot be parsed', async () => {
    const response = await inject({
      method: 'POST',
      url: '/api/setup',
      payload: { pin: PIN },
      headers: { host: 'bad host:x' },
    });
    expectFailure(response, 403, 'forbidden');
    expect(readPinHash(data.db)).toBeNull();
  });

  it('refuses setup once a PIN is set, from the server machine too, and keeps the hash', async () => {
    await setUpPin(app, PIN);
    const stored = readPinHash(data.db);
    expectFailure(
      await inject({ method: 'POST', url: '/api/setup', payload: { pin: NEW_PIN } }),
      409,
      'pin_already_set',
    );
    expectFailure(
      await inject({ method: 'POST', url: '/api/setup', payload: { pin: NEW_PIN }, remoteAddress: LAN }),
      403,
      'forbidden',
    );
    expect(readPinHash(data.db)).toBe(stored);
  });

  it('lets exactly one of two setups at the same moment win', async () => {
    const answers = await Promise.all(
      ['1111', '2222'].map((pin) => inject({ method: 'POST', url: '/api/setup', payload: { pin } })),
    );
    expect(answers.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const winner = answers.find((response) => response.statusCode === 200)!;
    const stored = readPinHash(data.db)!;
    const pins = await Promise.all(['1111', '2222'].map((pin) => verifyPin(pin, stored)));
    expect(pins.filter(Boolean)).toHaveLength(1);
    expect((await settings(dmCookie(winner))).statusCode).toBe(200);
  });

  it.each([
    ['three digits', '123'],
    ['nine digits', '123456789'],
    ['a letter', '12a4'],
    ['a space', ' 1234'],
    ['a trailing newline', '1234\n'],
    ['full-width digits', '１２３４'],
    ['Arabic-Indic digits', '١٢٣٤'],
    ['the empty string', ''],
    ['a number, not a string', 1234],
  ])('refuses a PIN with %s and stores nothing', async (_case, pin) => {
    const response = await inject({ method: 'POST', url: '/api/setup', payload: { pin } });
    expectFailure(response, 400, 'validation_failed');
    // The refusal names the field, never the value.
    if (String(pin).trim() !== '') expect(response.body).not.toContain(String(pin).trim());
    expect(readPinHash(data.db)).toBeNull();
  });

  it.each(['1234', '12345678'])('accepts the PIN %s at the edge of 4 to 8 digits', async (pin) => {
    await setUpPin(app, pin);
    expect(await verifyPin(pin, readPinHash(data.db)!)).toBe(true);
  });
});

describe('PIN entry and the DM session (specs/07-security-and-access.md §2)', () => {
  beforeEach(async () => {
    await setUpPin(app, PIN);
  });

  it('gives a correct PIN an HttpOnly, SameSite=Strict cookie carrying a random 256-bit identifier', async () => {
    const first = await enter(PIN);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ dm: true });
    const [cookie] = setCookies(first);
    expect(cookie).toMatch(new RegExp(`^${DM_COOKIE}=[0-9a-f]{64}; `));
    const attributes = cookie!.split(';').map((part) => part.trim().toLowerCase());
    expect(attributes).toEqual(expect.arrayContaining(['httponly', 'samesite=strict', 'path=/']));
    const second = dmCookie(await enter(PIN));
    expect(second).not.toBe(dmCookie(first));
    for (const session of [dmCookie(first), second]) expect((await settings(session)).statusCode).toBe(200);
  });

  it('answers a wrong PIN with 401 pin_incorrect and no cookie', async () => {
    const response = await enter(WRONG);
    expectFailure(response, 401, 'pin_incorrect');
    expect(setCookies(response)).toEqual([]);
  });

  it('refuses PIN entry while no PIN is set', async () => {
    const fresh = createTestData('emberglass-auth-nopin-');
    const other = await buildTestApp(fresh);
    try {
      expectFailure(
        await other.inject({ method: 'POST', url: '/api/auth', payload: { pin: PIN } }),
        409,
        'pin_not_set',
      );
    } finally {
      await other.close();
      fresh.remove();
    }
  });

  it('tells a browser only whether it itself holds a DM session', async () => {
    const cookie = await signInFrom(OTHER_LAN);
    const without = await inject({ method: 'GET', url: '/api/auth', remoteAddress: LAN });
    expect(without.statusCode).toBe(200);
    expect(without.json()).toEqual({ dm: false });
    const withSession = await inject({ method: 'GET', url: '/api/auth', headers: { cookie } });
    expect(withSession.json()).toEqual({ dm: true });
    for (const response of [without, withSession]) expect(isAuthState(response.json())).toBe(true);
  });

  it('clears a cookie that no longer names a session', async () => {
    const stale = `${DM_COOKIE}=${'ab'.repeat(32)}`;
    const response = await inject({ method: 'GET', url: '/api/auth', headers: { cookie: stale } });
    expect(response.json()).toEqual({ dm: false });
    expect(setCookies(response)).toEqual([expect.stringMatching(new RegExp(`^${DM_COOKIE}=; .*Max-Age=0`))]);
  });

  it('replaces the session a browser already had when it enters the PIN again', async () => {
    const before = await signInFrom(LAN);
    const again = await enter(PIN, LAN, { cookie: before });
    const after = dmCookie(again);
    expect(after).not.toBe(before);
    expectFailure(await settings(before), 401, 'unauthorized');
    expect((await settings(after)).statusCode).toBe(200);
  });

  it('derives the role only from the session, never from anything the client declares', async () => {
    const real = (await signInFrom(LAN)).split('=')[1]!;
    for (const headers of [
      { 'x-role': 'dm', 'x-dm': 'true' },
      { cookie: `role=dm; dm=true` },
      { cookie: `session=${real}` },
      { cookie: `${DM_COOKIE}=${real.toUpperCase()}` },
      { cookie: `${DM_COOKIE}=${real}0` },
      { cookie: `${DM_COOKIE}=${'0'.repeat(64)}` },
      { authorization: `Bearer ${real}` },
    ]) {
      expectFailure(
        await inject({ method: 'GET', url: '/api/settings?role=dm&dm=true', headers }),
        401,
        'unauthorized',
      );
    }
  });

  it('ends that browser session only when it signs out', async () => {
    const leaving = await signInFrom(LAN);
    const staying = await signInFrom(OTHER_LAN);
    const response = await inject({ method: 'DELETE', url: '/api/auth', headers: { cookie: leaving } });
    expect(response.statusCode).toBe(204);
    expect(setCookies(response)).toEqual([expect.stringMatching(new RegExp(`^${DM_COOKIE}=; .*Max-Age=0`))]);
    expectFailure(await settings(leaving), 401, 'unauthorized');
    expect((await inject({ method: 'GET', url: '/api/auth', headers: { cookie: leaving } })).json()).toEqual({
      dm: false,
    });
    expect((await settings(staying)).statusCode).toBe(200);
    // Signing out without a session is harmless.
    expect((await inject({ method: 'DELETE', url: '/api/auth' })).statusCode).toBe(204);
  });

  it('ends every session at a restart, keeps the PIN, and never writes a session to disk', async () => {
    const cookies = [await signInFrom(LAN), await signInFrom(OTHER_LAN)];
    await app.close();
    const ids = cookies.map((cookie) => cookie.split('=')[1]!);
    data.db.pragma('wal_checkpoint(TRUNCATE)');
    const files = readdirSync(data.dataDir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) for (const id of ids) expect(readFileSync(file).includes(id), file).toBe(false);

    app = await start({ db: data.reopen() });
    for (const cookie of cookies) {
      expectFailure(await settings(cookie), 401, 'unauthorized');
      expect((await inject({ method: 'GET', url: '/api/auth', headers: { cookie } })).json()).toEqual({ dm: false });
    }
    expect((await settings(await signInFrom(LAN))).statusCode).toBe(200);
  });
});

describe('guessing protection (specs/07-security-and-access.md §6)', () => {
  beforeEach(async () => {
    await setUpPin(app, PIN);
  });

  const failFiveTimes = async (remoteAddress = LAN): Promise<void> => {
    for (let attempt = 0; attempt < 5; attempt++)
      expectFailure(await enter(WRONG, remoteAddress), 401, 'pin_incorrect');
  };
  const expectLocked = async (seconds: number, remoteAddress = LAN): Promise<void> => {
    const response = await enter(PIN, remoteAddress);
    expectFailure(response, 429, 'locked_out');
    expect(response.headers['retry-after']).toBe(String(seconds));
    expect(setCookies(response)).toEqual([]);
  };

  it('locks one address for 1 minute after 5 failures, even for the right PIN, and leaves another address alone', async () => {
    await failFiveTimes();
    await expectLocked(60);
    expect((await enter(PIN, OTHER_LAN)).statusCode).toBe(200);
    clock += 59_000;
    await expectLocked(1);
    clock += 1_000;
    expect((await enter(PIN)).statusCode).toBe(200);
  });

  it('doubles the lockout on each further run of 5 failures', async () => {
    let expected = 60;
    for (let run = 0; run < 4; run++) {
      await failFiveTimes();
      await expectLocked(expected);
      clock += expected * 1000 - 1;
      await expectLocked(1);
      clock += 1;
      expected *= 2;
    }
    expect(expected).toBe(960);
  });

  it('forgives earlier failures once the right PIN is entered', async () => {
    for (let attempt = 0; attempt < 4; attempt++) await enter(WRONG);
    expect((await enter(PIN)).statusCode).toBe(200);
    for (let attempt = 0; attempt < 4; attempt++) expectFailure(await enter(WRONG), 401, 'pin_incorrect');
    expect((await enter(PIN)).statusCode).toBe(200);
  });

  it('checks no more than 5 PINs from one address when guesses arrive all at once', async () => {
    // At the production cost, so that the guesses really overlap the hashing.
    await app.close();
    data.remove();
    data = createTestData('emberglass-auth-');
    app = await start({ pinHashParams: SCRYPT_PARAMS });
    await setUpPin(app, PIN);
    const answers = await Promise.all(Array.from({ length: 20 }, () => enter(WRONG)));
    const statuses = answers.map((response) => response.statusCode);
    expect(statuses.filter((status) => status === 401)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(15);
  });

  it('counts a wrong current PIN in a PIN change towards the same lockout', async () => {
    const cookie = await signInFrom(LAN);
    for (let attempt = 0; attempt < 5; attempt++) {
      expectFailure(await changePin(cookie, WRONG, NEW_PIN), 401, 'pin_incorrect');
    }
    expectFailure(await changePin(cookie, PIN, NEW_PIN), 429, 'locked_out');
    await expectLocked(60);
    expect(await verifyPin(PIN, readPinHash(data.db)!)).toBe(true);
  });

  it('logs each failed attempt and each lockout with the client address', async () => {
    await failFiveTimes();
    const lines = readFileSync(logFilePath(data.dataDir), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const failed = lines.filter((line) => line.event === 'pin.failed');
    expect(failed.map((line) => [line.address, line.failures])).toEqual([1, 2, 3, 4, 5].map((n) => [LAN, n]));
    expect(lines.filter((line) => line.event === 'pin.locked')).toEqual([
      expect.objectContaining({ level: 'warn', address: LAN, seconds: 60 }),
    ]);
  });
});

describe('PIN change (specs/07-security-and-access.md §1, §2)', () => {
  beforeEach(async () => {
    await setUpPin(app, PIN);
  });

  it('lets no session made with the old PIN outlive a change, even one whose PIN check was still running', async () => {
    // At the production cost, so that sign-ins with the old PIN are still being
    // hashed when the change lands. One every 10 ms from its own address (so the
    // lockout never refuses them) covers the whole change.
    await app.close();
    data.remove();
    data = createTestData('emberglass-auth-');
    app = await start({ pinHashParams: SCRYPT_PARAMS });
    const changer = await setUpPin(app, PIN);
    const signIns: Promise<LightMyRequestResponse>[] = [];
    let done = false;
    const change = changePin(changer, PIN, NEW_PIN).finally(() => (done = true));
    for (let n = 0; !done && n < 200; n++) {
      signIns.push(enter(PIN, `10.1.${n >> 8}.${n & 255}`));
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect((await change).statusCode).toBe(204);
    const answers = await Promise.all(signIns);
    expect(answers.length).toBeGreaterThan(5);
    const granted = answers.filter((response) => response.statusCode === 200);
    // Some old-PIN sign-ins finished before the change and were granted, then ended by it.
    expect(granted.length).toBeGreaterThan(0);
    for (const response of granted) expectFailure(await settings(dmCookie(response)), 401, 'unauthorized');
    for (const response of answers) expect([200, 401]).toContain(response.statusCode);
    expect((await settings(changer)).statusCode).toBe(200);
  });

  it('lets exactly one of two PIN changes at the same moment win, and ends the other device', async () => {
    const first = await signInFrom(LAN);
    const second = await signInFrom(OTHER_LAN);
    const [a, b] = await Promise.all([
      changePin(first, PIN, '11112222', LAN),
      changePin(second, PIN, '33334444', OTHER_LAN),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([204, 401]);
    const stored = readPinHash(data.db)!;
    const [firstWon, secondWon] = await Promise.all([verifyPin('11112222', stored), verifyPin('33334444', stored)]);
    expect(firstWon).toBe(a.statusCode === 204);
    expect(secondWon).toBe(b.statusCode === 204);
    const [winner, loser] = firstWon ? [first, second] : [second, first];
    expect((await settings(winner)).statusCode).toBe(200);
    expectFailure(await settings(loser), 401, 'unauthorized');
  });

  it('ends every other session at once and keeps the device that changed it', async () => {
    const changer = await signInFrom(LAN);
    const others = [await signInFrom(OTHER_LAN), await signInFrom('192.168.1.22')];
    const response = await changePin(changer, PIN, NEW_PIN);
    expect(response.statusCode, response.body).toBe(204);
    expect((await settings(changer)).statusCode).toBe(200);
    for (const cookie of others) expectFailure(await settings(cookie), 401, 'unauthorized');
    expectFailure(await enter(PIN, OTHER_LAN), 401, 'pin_incorrect');
    expect((await enter(NEW_PIN, OTHER_LAN)).statusCode).toBe(200);
    const stored = readPinHash(data.db)!;
    expect(stored).not.toContain(NEW_PIN);
    expect(await verifyPin(NEW_PIN, stored)).toBe(true);
  });

  it('refuses a wrong current PIN and changes nothing', async () => {
    const changer = await signInFrom(LAN);
    const other = await signInFrom(OTHER_LAN);
    const stored = readPinHash(data.db);
    expectFailure(await changePin(changer, WRONG, NEW_PIN), 401, 'pin_incorrect');
    expect(readPinHash(data.db)).toBe(stored);
    for (const cookie of [changer, other]) expect((await settings(cookie)).statusCode).toBe(200);
  });

  it('refuses a change without a DM session, even with the right current PIN', async () => {
    const stored = readPinHash(data.db);
    expectFailure(
      await inject({ method: 'PUT', url: '/api/settings/pin', payload: { current_pin: PIN, new_pin: NEW_PIN } }),
      401,
      'unauthorized',
    );
    expect(readPinHash(data.db)).toBe(stored);
  });

  it.each(['123', '123456789', 'abcd'])('refuses the new PIN %s', async (newPin) => {
    const changer = await signInFrom(LAN);
    const stored = readPinHash(data.db);
    expectFailure(await changePin(changer, PIN, newPin), 400, 'validation_failed');
    expect(readPinHash(data.db)).toBe(stored);
  });
});

describe('npm run reset-pin (specs/07-security-and-access.md §1, D-028)', () => {
  it('clears the hash, so that setup runs again from localhost only and ends the old sessions', async () => {
    await setUpPin(app, PIN);
    const old = await signInFrom(LAN);
    expect(resetPin(data.dataDir, MIGRATIONS_DIR)).toBe('cleared');
    expect(readPinHash(data.db)).toBeNull();
    // The running server sees it at once.
    expect((await inject({ method: 'GET', url: '/api/setup' })).json()).toEqual({ pin_set: false, local: true });
    expectFailure(await enter(PIN), 409, 'pin_not_set');
    expectFailure(
      await inject({ method: 'POST', url: '/api/setup', payload: { pin: NEW_PIN }, remoteAddress: LAN }),
      403,
      'forbidden',
    );
    const fresh = await setUpPin(app, NEW_PIN);
    expectFailure(await settings(old), 401, 'unauthorized');
    expect((await settings(fresh)).statusCode).toBe(200);
    expect(resetPin(data.dataDir, MIGRATIONS_DIR)).toBe('cleared');
    expect(resetPin(data.dataDir, MIGRATIONS_DIR)).toBe('no-pin');
  });

  it('creates no database in a data directory that has none', () => {
    const missing = path.join(data.root, 'elsewhere');
    expect(resetPin(missing, MIGRATIONS_DIR)).toBe('no-database');
    expect(existsSync(missing)).toBe(false);
  });

  it('is the command npm run reset-pin', async () => {
    await setUpPin(app, PIN);
    // One command line through the shell, which is how npm is found on Windows too.
    const run = spawnSync('npm run --silent reset-pin', {
      cwd: REPO_ROOT,
      env: { ...process.env, EMBERGLASS_DATA_DIR: data.dataDir, EMBERGLASS_PORT: '3999' },
      encoding: 'utf8',
      shell: true,
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('The DM PIN was cleared');
    expect(run.stdout).toContain('http://localhost:3999/dm');
    expect(readPinHash(data.db)).toBeNull();
    const lines = readFileSync(logFilePath(data.dataDir), 'utf8');
    expect(lines).toContain('"event":"pin.reset"');
  }, 60_000);
});

describe('the DM session guards every /api route but PIN entry and setup (specs/02-architecture.md §5, G-005)', () => {
  // Every route the server declares, with a value in place of each parameter.
  const concrete = (url: string): string =>
    url.replace(/:[^/]+/g, '0b7a4c52-9d1e-4f3a-8b6c-2e5d7f9a1c3b').replace(/\*/g, 'x');
  const isPublic = (method: string, url: string): boolean =>
    PUBLIC_API_ROUTES.some((route) => route.method === method && route.url === url);
  const protectedRoutes = () =>
    app.declaredRoutes.filter(
      ({ method, url }) => (url === '/api' || url.startsWith('/api/')) && !isPublic(method, url),
    );

  // Shapes of request that a body parser or schema would answer differently.
  const shapes: { name: string; headers: Record<string, string>; payload: string }[] = [
    { name: 'no body', headers: {}, payload: '' },
    { name: 'malformed JSON', headers: { 'content-type': 'application/json' }, payload: '{"pin":' },
    { name: 'a valid-looking body', headers: { 'content-type': 'application/json' }, payload: '{"pin":"1234"}' },
    { name: 'an unknown field', headers: { 'content-type': 'application/json' }, payload: '{"zzz":1}' },
    { name: 'an unsupported media type', headers: { 'content-type': 'application/xml' }, payload: '<a/>' },
    {
      name: 'a body over the limit',
      headers: { 'content-type': 'application/json' },
      payload: `"${'x'.repeat(1_100_000)}"`,
    },
    { name: 'a stale cookie', headers: { cookie: `${DM_COOKIE}=${'cd'.repeat(32)}` }, payload: '' },
  ];

  // Node's HTTP server sends no body in answer to HEAD; light-my-request keeps
  // whatever the handler wrote, so a HEAD answer is compared without it.
  const comparable = (response: LightMyRequestResponse, method: string) => {
    const headers: Record<string, unknown> = { ...response.headers };
    delete headers.date;
    return { status: response.statusCode, headers, body: method === 'HEAD' ? '' : response.body };
  };

  it('declares the SRV-02 routes, so the checks below cover them', () => {
    const routes = protectedRoutes().map(({ method, url }) => `${method} ${url}`);
    expect(routes).toEqual(
      expect.arrayContaining(['GET /api/settings', 'HEAD /api/settings', 'PUT /api/settings/pin']),
    );
  });

  it('answers every protected route and every unknown /api path identically without a session, before parsing the body', async () => {
    await setUpPin(app, PIN);
    const unknown = [
      '/api',
      '/api/',
      '/api/nope',
      '/api/campaigns/0b7a4c52-9d1e-4f3a-8b6c-2e5d7f9a1c3b',
      '/api/auth/',
      '/api/settings/pin/x',
      // Spellings a decoding server could read as /api paths (M-1 of the review).
      '/%61pi/settings',
      '/%61pi/nope',
      '/api/%73ettingz',
      '//api/settings',
      '//api/nope',
      '/./api/nope',
      '/x/../api/nope',
      '/%2e/api/nope',
    ];
    for (const shape of shapes) {
      for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
        const reference = comparable(
          await inject({
            method,
            url: '/api/definitely-not-a-route',
            headers: shape.headers,
            payload: shape.payload,
            remoteAddress: LAN,
          }),
          method,
        );
        expect(reference.status).toBe(401);
        const targets = [
          ...unknown.map((url) => ({ method, url })),
          ...protectedRoutes()
            .filter((route) => route.method === method)
            .map((route) => ({ method, url: concrete(route.url) })),
        ];
        for (const target of targets) {
          const response = await inject({
            ...target,
            headers: shape.headers,
            payload: shape.payload,
            remoteAddress: LAN,
          });
          expect(comparable(response, method), `${target.method} ${target.url} with ${shape.name}`).toEqual(reference);
        }
      }
    }
  });

  it('answers the public routes without a session', async () => {
    for (const route of PUBLIC_API_ROUTES) {
      const response = await inject({
        method: route.method,
        url: route.url,
        ...(route.method === 'POST' ? { payload: { pin: PIN } } : {}),
      });
      expect(response.statusCode, `${route.method} ${route.url}`).not.toBe(401);
    }
  });
});

describe('Origin checks on REST writes (specs/07-security-and-access.md §2)', () => {
  const foreign = [
    'http://evil.example',
    'http://localhost:8080',
    'https://localhost',
    'null',
    'http://localhost.evil.example',
    'not a url',
  ];

  it.each(foreign)('refuses setup from the server machine with Origin %s and stores nothing', async (origin) => {
    const response = await inject({ method: 'POST', url: '/api/setup', payload: { pin: PIN }, headers: { origin } });
    expectFailure(response, 403, 'forbidden');
    expect(readPinHash(data.db)).toBeNull();
  });

  it('refuses PIN entry, a PIN change and a sign-out with a foreign Origin, and counts no attempt', async () => {
    const cookie = await setUpPin(app, PIN);
    const origin = 'http://evil.example';
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await enter(WRONG, LAN, { origin });
      expectFailure(response, 403, 'forbidden');
    }
    expectFailure(await enter(PIN, LAN, { origin }), 403, 'forbidden');
    const stored = readPinHash(data.db);
    expectFailure(
      await inject({
        method: 'PUT',
        url: '/api/settings/pin',
        payload: { current_pin: PIN, new_pin: NEW_PIN },
        headers: { cookie, origin },
      }),
      403,
      'forbidden',
    );
    expectFailure(await inject({ method: 'DELETE', url: '/api/auth', headers: { cookie, origin } }), 403, 'forbidden');
    expect(readPinHash(data.db)).toBe(stored);
    expect((await settings(cookie)).statusCode).toBe(200);
    // None of the refused entries counted towards a lockout.
    expect((await enter(PIN)).statusCode).toBe(200);
  });

  it('accepts a write whose Origin is the host the browser addressed, and one without an Origin', async () => {
    const cookie = await setUpPin(app, PIN);
    for (const [host, origin] of [
      ['localhost:3000', 'http://localhost:3000'],
      ['192.168.1.5:3000', 'http://192.168.1.5:3000'],
      ['Emberglass.local', 'http://emberglass.local'],
      ['[fe80::1]:3000', 'http://[fe80::1]:3000'],
    ]) {
      const response = await enter(PIN, LAN, { host: host!, origin: origin! });
      expect(response.statusCode, `${host} ${origin}`).toBe(200);
    }
    expect((await enter(PIN, LAN)).statusCode).toBe(200);
    expect(
      (await inject({ method: 'GET', url: '/api/settings', headers: { cookie, origin: 'http://evil.example' } }))
        .statusCode,
    ).toBe(200);
  });
});

describe('the PIN hash never leaves the server (G-008)', () => {
  it('answers GET /api/settings with the strict settings and nothing else', async () => {
    const cookie = await setUpPin(app, PIN);
    const response = await settings(cookie);
    expect(response.statusCode).toBe(200);
    const body: unknown = response.json();
    expect(isSettings(body), JSON.stringify(isSettings.errors)).toBe(true);
    expect(body).toEqual(readSettings(data.db));
    expect(Object.keys(body as object).sort()).toEqual(Object.keys(SettingsSchema.properties).sort());
  });

  it('carries the hash in no /api response', async () => {
    const cookie = await setUpPin(app, PIN);
    const stored = readPinHash(data.db)!;
    const parts = stored.split('$').slice(4);
    const responses: LightMyRequestResponse[] = [];
    for (const route of app.declaredRoutes) {
      if (!(route.url === '/api' || route.url.startsWith('/api/')) || route.method !== 'GET') continue;
      for (const headers of [{ cookie }, {}]) responses.push(await inject({ method: 'GET', url: route.url, headers }));
    }
    responses.push(await enter(PIN), await enter(WRONG), await changePin(cookie, WRONG, NEW_PIN));
    expect(responses.length).toBeGreaterThan(6);
    for (const response of responses) {
      const text = JSON.stringify(response.headers) + response.body;
      expect(text).not.toContain('pin_hash');
      expect(text).not.toContain('scrypt');
      for (const part of parts) expect(text).not.toContain(part);
    }
  });

  it('reads settings through explicit column lists only: no server source selects every column', () => {
    const sources = readdirSync(path.join(REPO_ROOT, 'server', 'src'), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
      .map((entry) => path.join(entry.parentPath, entry.name))
      .filter((file) => !file.includes(`${path.sep}testing${path.sep}`));
    expect(sources.length).toBeGreaterThan(10);
    for (const file of sources) expect(readFileSync(file, 'utf8'), file).not.toMatch(/SELECT\s+(\w+\.)?\*/i);
  });
});

describe('logs keep failed PIN attempts and never a credential (specs/07-security-and-access.md §8, G-006)', () => {
  const retained = (): string =>
    ['', '.1', '.2', '.3']
      .map((suffix) => `${logFilePath(data.dataDir)}${suffix}`)
      .filter((file) => existsSync(file))
      .map((file) => readFileSync(file, 'utf8'))
      .join('');

  const flood = async (lines: { perAddress: number; total: number }): Promise<void> => {
    await app.close();
    // Small files, so that a flood the limit does not stop would rotate the start away.
    const logger = createLogger({ dataDir: data.dataDir, stdout, stderr, maxBytes: 16 * 1024 });
    const scheduled: (() => void)[] = [];
    app = await buildTestApp(data, {
      logger,
      now: () => clock,
      rejectedLines: { ...lines, now: () => clock, schedule: (run) => scheduled.push(run) },
    });
    await setUpPin(app, PIN);
    for (let attempt = 0; attempt < 3; attempt++) await enter(WRONG);
    for (let request = 0; request < 3_000; request++) {
      await inject({ method: 'GET', url: `/api/settings`, remoteAddress: LAN });
    }
    for (const run of scheduled) run();
  };

  it('leaves the earlier failed-PIN lines in the retained files after a flood of rejected requests from one address', async () => {
    await flood({ perAddress: 20, total: 100 });
    const text = retained();
    const failed = text.split('\n').filter((line) => line.includes('"event":"pin.failed"'));
    expect(failed).toHaveLength(3);
    const rejected = text.split('\n').filter((line) => line.includes('"event":"http.rejected"') && line.includes(LAN));
    expect(rejected.length).toBeLessThanOrEqual(20);
    const summary = text.split('\n').find((line) => line.includes('"event":"http.rejected.dropped"'));
    expect(JSON.parse(summary!)).toMatchObject({ dropped: 3_000 - rejected.length, addresses: [{ address: LAN }] });
    // Another address is still heard.
    await inject({ method: 'GET', url: '/api/settings', remoteAddress: OTHER_LAN });
    expect(readFileSync(logFilePath(data.dataDir), 'utf8')).toContain(`"address":"${OTHER_LAN}"`);
  });

  it('would lose them without the limit, so the test above can fail', async () => {
    await flood({ perAddress: Number.MAX_SAFE_INTEGER, total: Number.MAX_SAFE_INTEGER });
    expect(retained()).not.toContain('"event":"pin.failed"');
  });

  it('never writes a PIN, a session identifier or the cookie to the log file or the console', async () => {
    const pins = [PIN, NEW_PIN, '48213579'];
    const setup = await inject({ method: 'POST', url: '/api/setup', payload: { pin: PIN } });
    const cookies = [dmCookie(setup)];
    cookies.push(dmCookie(await enter(PIN)));
    await enter('48213579');
    await enter(PIN, LAN, { origin: 'http://evil.example' });
    await changePin(cookies[1]!, '48213579', NEW_PIN);
    expect((await changePin(cookies[1]!, PIN, NEW_PIN)).statusCode).toBe(204);
    await inject({ method: 'GET', url: `/api/nope?pin=${PIN}`, headers: { cookie: cookies[0]! } });
    await inject({
      method: 'POST',
      url: '/api/auth',
      payload: `{"pin":"${PIN}"`,
      headers: { 'content-type': 'application/json' },
    });
    await inject({ method: 'DELETE', url: '/api/auth', headers: { cookie: cookies[1]! } });
    const signedIn = await enter(NEW_PIN);
    cookies.push(dmCookie(signedIn));

    const file = readFileSync(logFilePath(data.dataDir), 'utf8');
    const consoleText = stdout.text + stderr.text;
    for (const event of [
      'pin.set',
      'auth.signed_in',
      'pin.failed',
      'pin.changed',
      'auth.signed_out',
      'http.rejected',
    ]) {
      expect(file).toContain(`"event":"${event}"`);
    }
    for (const output of [file, consoleText]) {
      for (const pin of pins) expect(output).not.toContain(pin);
      for (const cookie of cookies) {
        expect(output).not.toContain(cookie);
        expect(output).not.toContain(cookie.split('=')[1]!);
      }
      expect(output).not.toContain(DM_COOKIE);
    }
  });
});

describe('start-up hint (specs/09-operations.md §2)', () => {
  it('tells the DM to open the DM view on the server PC while no PIN is set, and says nothing once one is', async () => {
    expect(pinSetupHint(readPinHash(data.db), 3000)).toBe(
      'No DM PIN is set yet. Open http://localhost:3000/dm in a browser on this PC to set it.',
    );
    await setUpPin(app, PIN);
    expect(pinSetupHint(readPinHash(data.db), 3000)).toBeNull();
  });
});

describe('normalizedPath', () => {
  it.each([
    ['/%61pi/settings', '/api/settings'],
    ['//api//nope', '/api/nope'],
    ['/x/../api/nope', '/api/nope'],
    ['/%2e/api', '/api'],
    ['/dm', '/dm'],
    ['/api/%E0%A4%A', null],
  ])('reads %s as %s', (raw, normal) => {
    expect(normalizedPath(raw)).toBe(normal);
  });
});
