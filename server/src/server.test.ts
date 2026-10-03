import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DATABASE_FILE } from './db/database.js';
import { DataDirectoryInUseError, lockDataDirectory } from './db/lock.js';
import { migrateDataDirectory } from './db/migrate.js';
import { MIGRATIONS_DIR } from './paths.js';
import { start } from './server.js';

// One server per data directory (D-173, PKG-02 review T-H2, T-M3, T-M4), against real files, a real port
// and a second real process: the lock is taken before start-up migrates or cleans anything, refused across
// processes, and released when the server closes or fails to start.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const roots: string[] = [];
const children: ChildProcess[] = [];
const env = { ...process.env };
afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  process.env = { ...env };
});

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

/** A data directory at schema version 8, an upload in flight and an image nothing references. */
async function olderData() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'emberglass-start-'));
  roots.push(root);
  const dataDir = path.join(root, 'data');
  migrateDataDirectory(dataDir, MIGRATIONS_DIR, new Date(), 8);
  const incoming = path.join(dataDir, 'images', '.incoming', 'upload-in-flight');
  mkdirSync(path.dirname(incoming), { recursive: true });
  writeFileSync(incoming, 'half an upload');
  const unreferenced = path.join(dataDir, 'images', 'a'.repeat(64));
  mkdirSync(unreferenced, { recursive: true });
  writeFileSync(path.join(unreferenced, 'original.png'), 'just uploaded');
  const dist = path.join(root, 'dist');
  mkdirSync(dist);
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
  process.env.EMBERGLASS_DATA_DIR = dataDir;
  process.env.EMBERGLASS_PORT = String(await freePort());
  return { dataDir, incoming, unreferenced, dist };
}

const version = (dataDir: string) => {
  const db = new Database(path.join(dataDir, DATABASE_FILE), { readonly: true });
  try {
    return db.pragma('user_version', { simple: true }) as number;
  } finally {
    db.close();
  }
};
const backups = (dataDir: string) => readdirSync(dataDir).filter((name) => name.startsWith('emberglass-backup-'));

/** Another process holding the data directory through lockDataDirectory, as a second server would. */
function holder(dataDir: string): Promise<ChildProcess> {
  const lock = pathToFileURL(path.resolve(import.meta.dirname, 'db', 'lock.ts')).href;
  const child = spawn(
    process.execPath,
    [
      '--expose-gc',
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `const { lockDataDirectory } = await import(${JSON.stringify(lock)}); lockDataDirectory(${JSON.stringify(dataDir)}); globalThis.gc?.(); console.log('held'); setInterval(() => {}, 1000);`,
    ],
    { cwd: path.resolve(import.meta.dirname, '..'), stdio: ['ignore', 'pipe', 'inherit'] },
  );
  children.push(child);
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('held')) resolve(child);
    });
    child.once('exit', (code) => reject(new Error(`the holder exited with ${code} before holding the lock`)));
  });
}

describe('start() and the data directory lock', () => {
  it('refuses a data directory another process holds before it migrates or cleans anything', async () => {
    const { dataDir, incoming, unreferenced, dist } = await olderData();
    const other = await holder(dataDir);

    await expect(start({ dev: false, clientDist: dist })).rejects.toBeInstanceOf(DataDirectoryInUseError);
    // Nothing touched: the upload in flight, the image not yet given to an asset, the schema, no backup.
    expect(existsSync(incoming)).toBe(true);
    expect(existsSync(unreferenced)).toBe(true);
    expect(version(dataDir)).toBe(8);
    expect(backups(dataDir)).toEqual([]);

    // Once the other process is gone, however it went, the server starts and does its start-up work.
    const gone = new Promise((resolve) => other.once('exit', resolve));
    other.kill('SIGKILL');
    await gone;
    const running = await start({ dev: false, clientDist: dist });
    try {
      expect(version(dataDir)).toBeGreaterThan(8);
      expect(backups(dataDir)).toHaveLength(1);
      expect(existsSync(incoming)).toBe(false);
      expect(existsSync(unreferenced)).toBe(false);
      // While it runs, nobody else gets the directory.
      expect(() => lockDataDirectory(dataDir)).toThrow(DataDirectoryInUseError);
    } finally {
      await running.close();
    }
    // Closing it releases the directory.
    lockDataDirectory(dataDir).release();
  });

  it('releases the data directory when it fails to start', async () => {
    const { dataDir, dist } = await olderData();
    const db = new Database(path.join(dataDir, DATABASE_FILE));
    db.pragma('user_version = 9999');
    db.close();
    await expect(start({ dev: false, clientDist: dist })).rejects.toThrow(/newer than this code/);
    lockDataDirectory(dataDir).release();
  });
});
