import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices, type Project } from '@playwright/test';

// End-to-end tests drive a DM view and a player view against a running server
// (specs/10-testing-acceptance.md §2): the production build, started the way a
// DM starts it, on its own port and an empty temporary data directory.
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const port = process.env.EMBERGLASS_E2E_PORT ?? '3107';
// The config is evaluated again in every worker; they inherit these variables, so
// all of them agree on the directory the server was started with and on the log below.
process.env.EMBERGLASS_E2E_DATA_DIR ??= mkdtempSync(path.join(os.tmpdir(), 'emberglass-e2e-'));
process.env.EMBERGLASS_E2E_OUTBOUND_LOG ??= path.join(
  mkdtempSync(path.join(os.tmpdir(), 'emberglass-e2e-offline-')),
  'outbound.jsonl',
);
process.env.EMBERGLASS_E2E_BLACKHOLE_PORT ??= String(Number(port) + 2);

// The offline run (specs/10-testing-acceptance.md §6, D-127): every browser goes through the
// blackhole proxy of offline/blackhole.ts except for this machine's own addresses, and the
// server runs with offline/guard.mjs, so nothing reaches beyond the local host and every attempt
// is recorded for offline.spec.ts.
const ownAddresses = [
  ...new Set(
    Object.values(os.networkInterfaces())
      .flat()
      .filter((entry) => entry?.family === 'IPv4')
      .map((entry) => entry.address),
  ),
];
const proxy = {
  server: `http://127.0.0.1:${process.env.EMBERGLASS_E2E_BLACKHOLE_PORT}`,
  bypass: ['localhost', '127.0.0.1', '[::1]', ...ownAddresses].join(','),
};

// The browser matrix of specs/10-testing-acceptance.md §4 (D-127): Chromium runs every spec;
// the other browsers named in EMBERGLASS_E2E_BROWSERS run the acceptance journeys of
// tests/journeys/. CI names Firefox and WebKit on both runners and Edge on Windows.
const BROWSERS: Record<string, Project['use']> = {
  firefox: { ...devices['Desktop Firefox'] },
  webkit: { ...devices['Desktop Safari'] },
  msedge: { ...devices['Desktop Edge'], channel: 'msedge' },
};
const others = (process.env.EMBERGLASS_E2E_BROWSERS ?? 'chromium')
  .split(',')
  .map((name) => name.trim())
  .filter((name) => name !== '' && name !== 'chromium');
for (const name of others) {
  if (!(name in BROWSERS)) throw new Error(`EMBERGLASS_E2E_BROWSERS: unknown browser "${name}"`);
}
const chromium = devices['Desktop Chrome'];

export default defineConfig({
  testDir: 'tests',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  forbidOnly: true,
  retries: 0,
  // Every test shares the one server and its data directory, so they run one at
  // a time, in a known order (D-086).
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${port}`, proxy },
  // The First run journey needs the fresh data directory, before any other test
  // sets the PIN; the rest depend on it (D-086). The offline check runs after all.
  projects: [
    { name: 'first-run', testMatch: /(?<!journeys\/)first-run\.spec\.ts$/, use: chromium },
    {
      name: 'chromium',
      testIgnore: [/(?<!journeys\/)first-run\.spec\.ts$/, /offline\.spec\.ts$/],
      dependencies: ['first-run'],
      use: chromium,
    },
    ...others.map((name) => ({
      name,
      testMatch: /journeys\/.+\.spec\.ts$/,
      dependencies: ['first-run'],
      use: BROWSERS[name]!,
    })),
    {
      name: 'offline',
      testMatch: /offline\.spec\.ts$/,
      dependencies: ['chromium', ...others],
      use: chromium,
    },
  ],
  webServer: {
    // `npm start` runs scripts/start.mjs; the guard is loaded into that same process.
    command: 'npm run build && node --import ./e2e/offline/guard.mjs scripts/start.mjs',
    cwd: repoRoot,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    env: {
      EMBERGLASS_PORT: port,
      EMBERGLASS_DATA_DIR: process.env.EMBERGLASS_E2E_DATA_DIR,
      EMBERGLASS_E2E_OUTBOUND_LOG: process.env.EMBERGLASS_E2E_OUTBOUND_LOG,
    },
  },
});
