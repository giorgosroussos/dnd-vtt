import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type TestInfo } from '@playwright/test';

// What the acceptance journeys of specs/10-testing-acceptance.md §5 share (REL-02, D-127): the
// locators of both views, what the TV draws, names unique to each browser of the matrix, this PC's
// LAN address, and a server of a journey's own.

export const player = (page: Page) => page.locator('main[data-view="player"]');
export const tvCanvas = (page: Page) => page.locator('main[data-view="player"] .eg-canvas--player');
export const panel = (page: Page) => page.locator('main.eg-scene');
export const liveBar = (page: Page) => page.getByRole('region', { name: 'Live scene' });
export const status = (page: Page) => page.locator('main [role="status"]');

export interface DrawnOnTv {
  id: string;
  label: string;
  x: number;
  y: number;
}

/** The tokens the player view draws, as its canvas reports them. */
export async function tvTokens(page: Page): Promise<DrawnOnTv[]> {
  const raw = await tvCanvas(page).getAttribute('data-tokens');
  return raw ? (JSON.parse(raw) as DrawnOnTv[]) : [];
}

/** Every frame a page's WebSockets receive, as text. */
export function framesOf(page: Page): string[] {
  const frames: string[] = [];
  page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => frames.push(String(payload))));
  return frames;
}

/** A name no other browser of the matrix, and no earlier run on this server, has used. */
export function unique(info: TestInfo, name: string): string {
  return `${name} ${info.project.name} ${Date.now()}`;
}

/**
 * The wait allowed for a view opened from this PC's LAN address to load and show its first screen.
 * Firefox on the Windows runner took 9 s and then 26 s to load from 10.1.0.x where every other
 * browser took about a second (CI runs 36558406339, 36564824322); the cause is not known (G-040,
 * D-132). Only there is the wait longer, 45 s; everywhere else the defaults apply, so a slowdown
 * elsewhere still fails (review T-L2). Every assertion stands; only the wait changes.
 */
export const SLOW_LAN_LOAD_MS = 45_000;
export function lanWait(info: TestInfo): { timeout: number } | Record<string, never> {
  return process.platform === 'win32' && info.project.name === 'firefox' ? { timeout: SLOW_LAN_LOAD_MS } : {};
}

/** Records how long a load from the LAN address took, so a drift shows in the report (review T-L2). */
export async function timedLanLoad(info: TestInfo, what: string, load: () => Promise<unknown>): Promise<void> {
  const started = Date.now();
  await load();
  info.annotations.push({ type: 'LAN load', description: `${what}: ${Date.now() - started} ms` });
}

/** This PC's first non-internal IPv4 address: how a LAN device reaches the server. */
export function lanAddress(): string {
  const found = Object.values(os.networkInterfaces())
    .flat()
    .find((entry) => entry?.family === 'IPv4' && !entry.internal);
  if (!found) throw new Error('This machine has no LAN address, so a LAN browser cannot be simulated.');
  return found.address;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '0.0.0.0', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

export interface OwnServer {
  port: number;
  /** Everything the server printed so far. */
  output: () => string;
  stop: () => Promise<void>;
}

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Starts the built server the way a DM does (`npm start` runs scripts/start.mjs), on a fresh data
 * directory and a port of its own, under the offline guard like the suite's own server.
 */
export async function startOwnServer(): Promise<OwnServer> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'emberglass-journey-'));
  let printed = '';
  const child: ChildProcess = spawn(process.execPath, ['--import', './e2e/offline/guard.mjs', 'scripts/start.mjs'], {
    cwd: repoRoot,
    env: { ...process.env, EMBERGLASS_PORT: String(port), EMBERGLASS_DATA_DIR: dataDir, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout!.on('data', (chunk: Buffer) => (printed += chunk.toString('utf8')));
  child.stderr!.on('data', (chunk: Buffer) => (printed += chunk.toString('utf8')));
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  const stop = async () => {
    if (child.exitCode === null) child.kill();
    await exited;
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
  try {
    await expect
      .poll(
        async () => {
          if (child.exitCode !== null) throw new Error(`the server exited:\n${printed}`);
          return fetch(`http://127.0.0.1:${port}/api/setup`).then(
            (response) => response.status,
            () => 0,
          );
        },
        { timeout: 30_000 },
      )
      .toBe(200);
  } catch (error) {
    await stop();
    throw error;
  }
  return { port, output: () => printed, stop };
}

/**
 * Deletes a campaign with its confirmation, as a journey's last step: the keyboard walk
 * (keyboard.spec.ts) visits every control of the tree, so journeys leave no campaign behind.
 */
export async function deleteCampaign(page: Page, campaignId: string): Promise<void> {
  const summary = await page.request.get(`/api/campaigns/${campaignId}/deletion`);
  if (!summary.ok()) return;
  await page.request.delete(`/api/campaigns/${campaignId}`, { data: { confirm: (await summary.json()) as object } });
}

/**
 * Deletes a journey's assets once its campaign is gone, so no asset in use remains: the keyboard walk
 * visits the library too, and other specs search it by name.
 */
export async function deleteAssets(page: Page, assetIds: string[]): Promise<void> {
  for (const id of assetIds) await page.request.delete(`/api/assets/${id}`);
}
