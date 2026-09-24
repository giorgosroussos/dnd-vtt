import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// The PIN is stored only as a salted scrypt hash (specs/07-security-and-access.md §1,
// Q-042, D-027). The stored text carries its own parameters, so a later change of
// cost still verifies the hashes written before it:
//
//   scrypt$<N>$<r>$<p>$<salt, base64url>$<key, base64url>
//
// N = 2^15 costs about 0.1 s and 32 MiB per hash on a desktop, on libuv's thread
// pool, so a verification never blocks the event loop.

export const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
// scrypt needs 128 * N * r bytes; Node's default ceiling is exactly 32 MiB, one byte short.
const maxmemFor = (N: number, r: number): number => 256 * N * r;

const FORMAT = /^scrypt\$(\d{1,8})\$(\d{1,3})\$(\d{1,3})\$([A-Za-z0-9_-]{16,128})\$([A-Za-z0-9_-]{16,128})$/;

function derive(pin: string, salt: Buffer, length: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pin, salt, length, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPin(pin: string): Promise<string> {
  const { N, r, p } = SCRYPT_PARAMS;
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(pin, salt, KEY_BYTES, { N, r, p, maxmem: maxmemFor(N, r) });
  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/** Whether `pin` is the PIN `stored` was made from. A stored value in any other format never verifies. */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const match = FORMAT.exec(stored);
  if (!match) return false;
  const [N, r, p] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const salt = Buffer.from(match[4]!, 'base64url');
  const expected = Buffer.from(match[5]!, 'base64url');
  try {
    const key = await derive(pin, salt, expected.length, { N, r, p, maxmem: maxmemFor(N, r) });
    return timingSafeEqual(key, expected);
  } catch {
    // Parameters scrypt refuses (N not a power of two, too much memory): not a hash we wrote.
    return false;
  }
}
