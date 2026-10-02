import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
    try {
      lockDataDirectory(dir);
    } catch (error) {
      expect((error as DataDirectoryInUseError).code).toBe('EMBERGLASS_DATA_DIR_IN_USE');
      expect((error as Error).message).toContain(dir);
    }
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

  it('is released by the operating system when the process holding it ends, however it ends', () => {
    const dir = dataDir();
    // A process that takes the lock and exits without releasing it, as a crash would.
    const script = `const D = require('better-sqlite3'); require('node:fs').mkdirSync(${JSON.stringify(dir)}, { recursive: true }); const db = new D(require('node:path').join(${JSON.stringify(dir)}, '${LOCK_FILE}')); db.exec('BEGIN EXCLUSIVE'); process.exit(3);`;
    const crashed = spawnSync(process.execPath, ['-e', script], { cwd: path.resolve(import.meta.dirname, '..', '..') });
    expect(crashed.status).toBe(3);
    const after = lockDataDirectory(dir);
    after.release();
  });
});
