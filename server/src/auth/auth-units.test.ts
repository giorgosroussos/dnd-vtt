import { describe, expect, it } from 'vitest';
import { dmCookieValues } from '../http/auth.js';
import {
  createLockout,
  FAILURES_PER_LOCKOUT,
  isLoopback,
  lockoutDuration,
  MAX_TRACKED_ADDRESSES,
  normalizeAddress,
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
      expect(lockout.begin('a')).toEqual({ allowed: true, failures: n, lockedMs: null });
    expect(lockout.begin('a')).toEqual({ allowed: true, failures: 5, lockedMs: 60_000 });
    time = 30_000;
    expect(lockout.begin('a')).toEqual({ allowed: false, retryAfterMs: 30_000 });
    time = 60_000;
    expect(lockout.begin('a')).toEqual({ allowed: true, failures: 6, lockedMs: null });
  });

  it('bounds how many addresses it remembers', () => {
    const lockout = createLockout(() => 0);
    for (let n = 0; n < 5; n++) lockout.begin('first');
    expect(lockout.begin('first').allowed).toBe(false);
    for (let n = 0; n < MAX_TRACKED_ADDRESSES; n++) lockout.begin(`10.${n >> 16}.${(n >> 8) & 255}.${n & 255}`);
    // The oldest entry made room; memory stays bounded.
    expect(lockout.begin('first').allowed).toBe(true);
  });

  it.each([
    ['::ffff:192.168.1.5', '192.168.1.5'],
    ['::FFFF:127.0.0.1', '127.0.0.1'],
    ['FE80::1', 'fe80::1'],
    [undefined, 'unknown'],
  ])('spells %s as %s', (address, normal) => {
    expect(normalizeAddress(address)).toBe(normal);
  });

  it('knows the loopback addresses', () => {
    expect(['127.0.0.1', '127.255.0.9', '::1'].every(isLoopback)).toBe(true);
    expect(['128.0.0.1', '10.127.0.1', '::2', 'unknown', '127.0.0.1.evil'].some(isLoopback)).toBe(false);
  });
});

describe('DM sessions (specs/07-security-and-access.md §2)', () => {
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
