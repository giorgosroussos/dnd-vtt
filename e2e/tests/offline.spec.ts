import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// The offline acceptance of specs/10-testing-acceptance.md §6 (specs/02-architecture.md §6, Q-020,
// D-127). Every other spec of this run has already run, each browser behind the blackhole proxy and
// the server under the guard, so nothing could leave the local host; this test, run last (the
// `offline` project), fails if anything tried. It then shows the block is real: a request from a
// view and one from a Node process under the guard both fail and both are recorded, so an empty
// log means nothing was attempted, not that nothing was watched.

interface Attempt {
  from: 'browser' | 'server';
  kind: string;
  target: string;
}

const log = process.env.EMBERGLASS_E2E_OUTBOUND_LOG!;
const guard = fileURLToPath(new URL('../offline/guard.mjs', import.meta.url));
const attempts = (file: string): Attempt[] =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Attempt)
    : [];

// A documentation address (RFC 5737): never a real host, on any network.
const OUTSIDE = '198.51.100.7';

test('@gate:offline-e2e the end-to-end run sent nothing beyond the local host, and the block it ran under holds', async ({
  page,
}) => {
  // 1. Nothing was attempted by any view or by the server during the whole run.
  expect(attempts(log)).toEqual([]);

  // 2. A view's request beyond the local host fails and reaches the log.
  await page.goto('/');
  await expect(page.locator('main[data-view="player"]')).toHaveAttribute('data-scene', /idle|live/);
  const outcome = await page.evaluate(
    (url) =>
      new Promise<string>((resolve) => {
        const image = new Image();
        image.onload = () => resolve('loaded');
        image.onerror = () => resolve('failed');
        image.src = url;
      }),
    `http://${OUTSIDE}/map.png`,
  );
  expect(outcome).toBe('failed');
  await expect
    .poll(() => attempts(log).map((each) => `${each.from} ${each.target}`))
    .toEqual([`browser GET http://${OUTSIDE}/map.png`]);

  // 3. So does a Node process's, under the guard the server runs with: a connection and a lookup.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'emberglass-guard-'));
  try {
    const probe = path.join(dir, 'outbound.jsonl');
    const run = spawnSync(
      process.execPath,
      [
        '--import',
        guard,
        '-e',
        `fetch('http://${OUTSIDE}/').then(() => process.exit(0), (e) => { console.log(e.cause?.code); ` +
          `return require('node:dns').promises.lookup('example.org').catch((l) => { console.log(l.code); process.exit(3); }); })`,
      ],
      { encoding: 'utf8', env: { ...process.env, EMBERGLASS_E2E_OUTBOUND_LOG: probe } },
    );
    expect(run.status, run.stderr).toBe(3);
    expect(run.stdout.trim().split(/\s+/)).toEqual(['ECONNREFUSED', 'ENOTFOUND']);
    expect(attempts(probe).map((each) => `${each.kind} ${each.target}`)).toEqual([
      `connect ${OUTSIDE}:80`,
      'lookup example.org',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
