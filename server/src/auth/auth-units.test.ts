import { describe, expect, it } from 'vitest';
import { dmCookieValues } from '../http/auth.js';
import {
  createLockout,
  FAILURES_PER_LOCKOUT,
  GLOBAL_FAILURES_PER_PAUSE,
  GLOBAL_WINDOW_MS,
  isLoopback,
  lockoutDuration,
  lockoutKey,
  MAX_TRACKED_ADDRESSES,
  normalizeAddress,
  pauseDuration,
} from './lockout.js';
import { hashPin, SCRYPT_PARAMS, verifyPin } from './pin-hash.js';
import { createSessionStore, SESSION_ID_PATTERN } from './sessions.js';

describe('PIN hash (specs/07-security-and-access.md §1)', () => {
  it('salts every hash, so one PIN hashed twice gives two different values that both verify', async () => {
    const [first, second] = await Promise.all([hashPin('4821'), hashPin('4821')]);
    expect(first).not.toBe(second);
    expect(first.split('$').slice(0, 4)).toEqual(['scrypt', String(SCRYPT_PARAMS.N), '8', '1']);
    expect(await verifyPin('4821', first)).toBe(true);
    expect(await verifyPin('4821', second)).toBe(true);
    expect(await verifyPin('4822', first)).toBe(false);
  });

  it.each([
    ['', 'empty'],
    ['4821', 'the PIN itself'],
    [
      'scrypt$3$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'an N that is not a power of two',
    ],
    ['bcrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'another algorithm'],
  ])('never verifies against %j (%s)', async (stored) => {
    expect(await verifyPin('4821', stored)).toBe(false);
  });
});

describe('lockout (specs/07-security-and-access.md §6)', () => {
  it('doubles from one minute', () => {
    expect([1, 2, 3, 4].map(lockoutDuration)).toEqual([60_000, 120_000, 240_000, 480_000]);
    expect(Number.isFinite(lockoutDuration(10_000))).toBe(true);
    expect(lockoutDuration(10_000)).toBeGreaterThan(lockoutDuration(30));
  });

  it('locks on the fifth failure and refuses without counting while locked', () => {
    let time = 0;
    const lockout = createLockout(() => time);
    for (let n = 1; n < FAILURES_PER_LOCKOUT; n++)
      expect(lockout.begin('a')).toEqual({ allowed: true, failures: n, lockedMs: null, paused: null });
    expect(lockout.begin('a')).toEqual({ allowed: true, failures: 5, lockedMs: 60_000, paused: null });
    time = 30_000;
    expect(lockout.begin('a')).toEqual({ allowed: false, retryAfterMs: 30_000 });
    time = 60_000;
    expect(lockout.begin('a')).toEqual({ allowed: true, failures: 6, lockedMs: null, paused: null });
  });

  it('bounds how many addresses it remembers', () => {
    const lockout = createLockout(() => 0);
    // Loopback addresses, which the server-wide budget leaves out, so that only the per-address limit acts.
    for (let n = 0; n < 5; n++) lockout.begin('127.200.0.1');
    expect(lockout.begin('127.200.0.1').allowed).toBe(false);
    for (let n = 0; n < MAX_TRACKED_ADDRESSES; n++) lockout.begin(`127.${n >> 16}.${(n >> 8) & 255}.${n & 255}`);
    // The oldest entry made room; memory stays bounded.
    expect(lockout.begin('127.200.0.1').allowed).toBe(true);
  });

  it.each([
    ['::ffff:192.168.1.5', '192.168.1.5'],
    ['::FFFF:127.0.0.1', '127.0.0.1'],
    ['FE80::1', 'fe80::1'],
    [undefined, 'unknown'],
  ])('spells %s as %s', (address, normal) => {
    expect(normalizeAddress(address)).toBe(normal);
  });

  it('pauses every address but loopback after 20 failures from any addresses within 10 minutes (Q-097)', () => {
    let time = 0;
    const lockout = createLockout(() => time);
    // Four failures each from five addresses: none is locked on its own.
    for (let n = 0; n < GLOBAL_FAILURES_PER_PAUSE - 1; n++) {
      expect(lockout.begin(`10.0.0.${n % 5}`)).toMatchObject({ allowed: true, paused: null });
    }
    const last = lockout.begin('10.0.0.4');
    expect(last).toMatchObject({ allowed: true, lockedMs: null });
    expect(last.allowed && last.paused).toEqual({
      ms: 600_000,
      addresses: ['10.0.0.0', '10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4'],
    });
    time = 1_000;
    expect(lockout.begin('10.0.0.99')).toEqual({ allowed: false, retryAfterMs: 599_000 });
    expect(lockout.begin('127.0.0.1')).toMatchObject({ allowed: true, paused: null });
    expect(lockout.begin('::1')).toMatchObject({ allowed: true, paused: null });
    time = 600_000;
    expect(lockout.begin('10.0.0.99')).toMatchObject({ allowed: true, paused: null });
  });

  it('doubles the pause on each further run, and counts only failures within the window', () => {
    expect([1, 2, 3].map(pauseDuration)).toEqual([600_000, 1_200_000, 2_400_000]);
    let time = 0;
    const lockout = createLockout(() => time);
    const fail = (count: number): ReturnType<typeof lockout.begin>[] =>
      Array.from({ length: count }, (_, n) => lockout.begin(`10.1.${n >> 8}.${n & 255}`));
    fail(GLOBAL_FAILURES_PER_PAUSE - 1);
    // The first nineteen fall out of the window: no pause.
    time = GLOBAL_WINDOW_MS;
    expect(fail(GLOBAL_FAILURES_PER_PAUSE - 1).every((start) => start.allowed && start.paused === null)).toBe(true);
    const first = fail(1)[0]!;
    expect(first.allowed && first.paused?.ms).toBe(600_000);
    time += 600_000;
    const second = fail(GLOBAL_FAILURES_PER_PAUSE).at(-1)!;
    expect(second.allowed && second.paused?.ms).toBe(1_200_000);
  });

  it('never counts failures from loopback towards the pause', () => {
    const lockout = createLockout(() => 0);
    for (let n = 0; n < 100; n++) lockout.begin(`127.0.${n >> 8}.${n & 255}`);
    expect(lockout.begin('10.0.0.1')).toMatchObject({ allowed: true, paused: null });
  });

  it('takes a correct PIN out of the budget', () => {
    const lockout = createLockout(() => 0);
    for (let n = 0; n < GLOBAL_FAILURES_PER_PAUSE - 1; n++) {
      lockout.begin(`10.2.0.${n}`);
      lockout.succeeded(`10.2.0.${n}`);
    }
    expect(lockout.begin('10.2.0.200')).toMatchObject({ allowed: true, paused: null });
  });

  it('forgives only the correct attempt: the other failures stay counted and the doubling is kept', () => {
    let time = 0;
    const lockout = createLockout(() => time);
    for (let n = 0; n < GLOBAL_FAILURES_PER_PAUSE - 2; n++) lockout.begin(`10.3.0.${n % 5}`);
    lockout.begin('10.3.0.50');
    lockout.succeeded('10.3.0.50');
    // Eighteen failures still counted: the nineteenth pauses nothing, the twentieth does.
    expect(lockout.begin('10.3.0.60')).toMatchObject({ allowed: true, paused: null });
    const next = lockout.begin('10.3.0.61');
    expect(next.allowed && next.paused?.ms).toBe(600_000);
    // A correct PIN after the pause resets nothing of the doubling.
    time = 600_000;
    lockout.begin('10.3.0.70');
    lockout.succeeded('10.3.0.70');
    let last: ReturnType<typeof lockout.begin> | undefined;
    for (let n = 0; n < GLOBAL_FAILURES_PER_PAUSE; n++) last = lockout.begin(`10.4.0.${n}`);
    expect(last!.allowed && last!.paused?.ms).toBe(1_200_000);
  });

  it('answers the longer wait when an address is locked for longer than the pause lasts', () => {
    let time = 0;
    const lockout = createLockout(() => time);
    const fiveFrom = (address: string) => {
      for (let n = 0; n < FAILURES_PER_LOCKOUT; n++) lockout.begin(address);
    };
    // Five lockouts of one address, 60 s to 960 s, spread so that the budget never fills.
    for (const [at, locked] of [
      [0, 60],
      [61, 120],
      [700, 240],
      [950, 480],
      [1_440, 960],
    ] as const) {
      time = at * 1000;
      fiveFrom('10.5.0.1');
      expect(lockout.begin('10.5.0.1')).toEqual({ allowed: false, retryAfterMs: locked * 1000 });
    }
    // Ten failures in the window from it; ten more from others open a 600 s pause.
    for (let n = 0; n < 10; n++) lockout.begin(`10.5.1.${n}`);
    expect(lockout.begin('10.5.2.1')).toEqual({ allowed: false, retryAfterMs: 600_000 });
    expect(lockout.begin('10.5.0.1')).toEqual({ allowed: false, retryAfterMs: 960_000 });
  });

  it('forgives a whole IPv6 /64 when a correct PIN comes from any address of it', () => {
    const lockout = createLockout(() => 0);
    for (let n = 1; n < FAILURES_PER_LOCKOUT; n++) lockout.begin(`2001:db8:9:9::${n}`);
    lockout.begin('2001:db8:9:9::aa');
    lockout.succeeded('2001:db8:9:9::aa');
    for (let n = 1; n < FAILURES_PER_LOCKOUT; n++) {
      expect(lockout.begin(`2001:db8:9:9::b${n}`)).toMatchObject({ allowed: true, lockedMs: null });
    }
  });

  it.each([
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
    ['2001:0DB8:0001:0002:ffff::1', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['fe80::1%eth0', 'fe80:0:0:0::/64'],
    ['64:ff9b::192.0.2.1', '64:ff9b:0:0::/64'],
    ['::1', '::1'],
    ['192.168.1.5', '192.168.1.5'],
    ['2001:db8:::1', '2001:db8:::1'],
    ['unknown', 'unknown'],
  ])('counts %s as %s', (address, key) => {
    expect(lockoutKey(address)).toBe(key);
  });

  it('locks a whole IPv6 /64 as one client (Q-097)', () => {
    const lockout = createLockout(() => 0);
    for (let n = 1; n <= FAILURES_PER_LOCKOUT; n++) lockout.begin(`2001:db8:1:2::${n.toString(16)}`);
    expect(lockout.begin('2001:db8:1:2:ffff::9').allowed).toBe(false);
    expect(lockout.begin('2001:db8:1:3::1').allowed).toBe(true);
  });

  it('knows the loopback addresses', () => {
    expect(['127.0.0.1', '127.255.0.9', '::1'].every(isLoopback)).toBe(true);
    expect(['128.0.0.1', '10.127.0.1', '::2', 'unknown', '127.0.0.1.evil'].some(isLoopback)).toBe(false);
  });
});

describe('DM sessions (specs/07-security-and-access.md §2)', () => {
  it('tells its listeners which sessions ended, so their sockets can be dropped (G-011)', () => {
    const store = createSessionStore();
    const [a, b, c] = [store.create(), store.create(), store.create()];
    const told: string[][] = [];
    const stop = store.onEnded((ids) => told.push([...ids]));
    store.end(a);
    store.end(a); // already ended: nothing to tell
    store.end('f'.repeat(64)); // never existed
    store.endAllExcept(c);
    store.endAllExcept(c); // nothing left to end
    expect(told).toEqual([[a], [b]]);
    stop();
    store.endAllExcept(undefined);
    expect(told).toEqual([[a], [b]]);
    expect(store.size).toBe(0);
  });

  it('issues distinct 256-bit identifiers and ends them one at a time or all but one', () => {
    const store = createSessionStore();
    const ids = [store.create(), store.create(), store.create()];
    for (const id of ids) expect(id).toMatch(SESSION_ID_PATTERN);
    expect(new Set(ids).size).toBe(3);
    store.end(ids[0]);
    expect(store.has(ids[0])).toBe(false);
    expect(store.endAllExcept(ids[1])).toBe(1);
    expect([store.has(ids[1]), store.has(ids[2]), store.size]).toEqual([true, false, 1]);
    expect(store.has(undefined)).toBe(false);
  });

  it('reads every DM cookie of a Cookie header and nothing else', () => {
    expect(dmCookieValues(undefined)).toEqual([]);
    expect(dmCookieValues('theme=dark; emberglass_dm=abc ; x_emberglass_dm=no; emberglass_dm=def')).toEqual([
      'abc',
      'def',
    ]);
    expect(dmCookieValues('emberglass_dm')).toEqual([]);
  });
});
