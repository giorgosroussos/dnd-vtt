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
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${port}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
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
