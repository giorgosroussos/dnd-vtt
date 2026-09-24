import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// End-to-end tests drive a DM view and a player view against a running server
// (specs/10-testing-acceptance.md §2): the production build, started the way a
// DM starts it, on its own port and an empty temporary data directory.
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const port = process.env.EMBERGLASS_E2E_PORT ?? '3107';
// The config is evaluated again in every worker; they inherit this variable, so
// all of them agree on the one directory the server was started with.
process.env.EMBERGLASS_E2E_DATA_DIR ??= mkdtempSync(path.join(os.tmpdir(), 'emberglass-e2e-'));

export default defineConfig({
  testDir: 'tests',
  globalTeardown: './global-teardown.ts',
  forbidOnly: true,
  retries: 0,
  // Every test shares the one server and its data directory, so they run one at
  // a time, in a known order (D-086).
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${port}` },
  // The First run journey needs the fresh data directory, before any other test
  // sets the PIN; the rest depend on it (D-086).
  projects: [
    { name: 'first-run', testMatch: /first-run\.spec\.ts$/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'chromium',
      testIgnore: /first-run\.spec\.ts$/,
      dependencies: ['first-run'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run build && npm start',
    cwd: repoRoot,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    env: { EMBERGLASS_PORT: port, EMBERGLASS_DATA_DIR: process.env.EMBERGLASS_E2E_DATA_DIR },
  },
});
