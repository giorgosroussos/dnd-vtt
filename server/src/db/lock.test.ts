import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DataDirectoryInUseError, LOCK_FILE, lockDataDirectory } from './lock.js';

// One server per data directory (PKG-01, D-173), against real files.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const dataDir = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'emberglass-lock-'));
  dirs.push(dir);
  return path.join(dir, 'data');
};

describe('lockDataDirectory', () => {
  it('takes a data directory, creating it, and refuses it to a second taker until released', () => {
    const dir = dataDir();
    const first = lockDataDirectory(dir);
    expect(existsSync(path.join(dir, LOCK_FILE))).toBe(true);
    expect(() => lockDataDirectory(dir)).toThrow(DataDirectoryInUseError);
    expect(() => lockDataDirectory(dir)).toThrow(dir);
    first.release();
    const second = lockDataDirectory(dir);
    second.release();
    second.release();
  });

  it('leaves other data directories free', () => {
    const one = lockDataDirectory(dataDir());
    const two = lockDataDirectory(dataDir());
    one.release();
    two.release();
  });

  it('refuses at once, with no wait for the holder to let go', () => {
    expect.assertions(3);
    const dir = dataDir();
    const first = lockDataDirectory(dir);
    const asked = Date.now();
    try {
      lockDataDirectory(dir);
    } catch (error) {
      expect(error).toBeInstanceOf(DataDirectoryInUseError);
      expect((error as DataDirectoryInUseError).code).toBe('EMBERGLASS_DATA_DIR_IN_USE');
    }
    expect(Date.now() - asked).toBeLessThan(500);
    first.release();
  });

  it('makes again a lock file a copy or a sync tool damaged: it holds no data', () => {
    const dir = dataDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, LOCK_FILE), 'not a database, half of a copied file');
    const lock = lockDataDirectory(dir);
    expect(() => lockDataDirectory(dir)).toThrow(DataDirectoryInUseError);
    lock.release();
  });
});
