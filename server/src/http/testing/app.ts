import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { ScryptParams } from '../../auth/pin-hash.js';
import { openDatabase } from '../../db/database.js';
import { migrateDataDirectory } from '../../db/migrate.js';
import type { Logger } from '../../log/logger.js';
import { MIGRATIONS_DIR } from '../../paths.js';
import { buildApp, type AppOptions } from '../app.js';
import { DM_COOKIE } from '../auth.js';

// A server against a real SQLite file in a temporary data directory (specs/10-testing-acceptance.md §2).

// A cheap PIN hash for tests in which the cost is not under test: real scrypt at
// the production cost is 32 MiB and 0.1 s a hash, and dozens of them in parallel
// starve the other test files on a two-core CI runner. Tests of the stored
// format, of parallel guesses and of races pass SCRYPT_PARAMS themselves.
export const TEST_PIN_HASH_PARAMS: Readonly<ScryptParams> = { N: 2 ** 10, r: 8, p: 1 };

export const quiet: Logger = { info: () => {}, warn: () => {}, error: () => {} };

export const INDEX =
  '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>';

export interface TestData {
  root: string;
  dataDir: string;
  dist: string;
  db: Database.Database;
  /** Opens the data directory again, as a restarted server would. */
  reopen(): Database.Database;
  remove(): void;
}

export function createTestData(prefix = 'emberglass-app-'): TestData {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  const dataDir = path.join(root, 'data');
  const dist = path.join(root, 'dist');
  mkdirSync(path.join(dist, 'assets'), { recursive: true });
  writeFileSync(path.join(dist, 'index.html'), INDEX);
  writeFileSync(path.join(dist, 'assets', 'app.js'), 'export {};');
  migrateDataDirectory(dataDir, MIGRATIONS_DIR);
  const opened: Database.Database[] = [];
  const reopen = (): Database.Database => {
    const db = openDatabase(dataDir);
    opened.push(db);
    return db;
  };
  return {
    root,
    dataDir,
    dist,
    db: reopen(),
    reopen,
    remove() {
      for (const db of opened) if (db.open) db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function buildTestApp(
  data: TestData,
  options: Partial<Omit<AppOptions, 'client'>> = {},
): Promise<FastifyInstance> {
  return buildApp({
    client: { kind: 'static', dist: data.dist },
    logger: quiet,
    db: data.db,
    dataDir: data.dataDir,
    pinHashParams: TEST_PIN_HASH_PARAMS,
    ...options,
  });
}

/** The `name=value` of the DM cookie a response set, ready for a Cookie header. */
export function dmCookie(response: LightMyRequestResponse): string {
  const header = [response.headers['set-cookie'] ?? []].flat().find((value) => value.startsWith(`${DM_COOKIE}=`));
  if (!header) throw new Error(`no ${DM_COOKIE} cookie in the response (${response.statusCode} ${response.body})`);
  return header.split(';', 1)[0]!;
}

/** Sets the first PIN from the server machine, returning the DM cookie it gave. */
export async function setUpPin(app: FastifyInstance, pin: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/setup', payload: { pin } });
  if (response.statusCode !== 200) throw new Error(`setup answered ${response.statusCode}: ${response.body}`);
  return dmCookie(response);
}
