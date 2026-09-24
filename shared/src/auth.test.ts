import { describe, expect, it } from 'vitest';
import { API_PATHS, PIN_PATTERN, PUBLIC_API_ROUTES } from './index.js';

describe('auth contract (specs/07-security-and-access.md §6, specs/02-architecture.md §5)', () => {
  it('accepts 4 to 8 ASCII digits as a PIN and nothing else', () => {
    const pin = new RegExp(PIN_PATTERN);
    expect(['1234', '00000000', '5918'].every((value) => pin.test(value))).toBe(true);
    expect(['123', '123456789', '12a4', ' 1234', '1234\n', '１２３４', ''].some((value) => pin.test(value))).toBe(
      false,
    );
  });

  it('leaves only PIN entry, sign-out, current role and setup reachable without a DM session', () => {
    expect(PUBLIC_API_ROUTES.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'GET /api/auth',
      'POST /api/auth',
      'DELETE /api/auth',
      'GET /api/setup',
      'POST /api/setup',
    ]);
    expect(PUBLIC_API_ROUTES.every(({ url }) => url === API_PATHS.auth || url === API_PATHS.setup)).toBe(true);
  });
});
