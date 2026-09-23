import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLIENT_ROOT } from '../paths.js';
import { buildApp, within } from './app.js';

const INDEX =
  '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>';

describe('buildApp serving a client build', () => {
  let dist: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    dist = mkdtempSync(path.join(os.tmpdir(), 'emberglass-dist-'));
    mkdirSync(path.join(dist, 'assets'));
    writeFileSync(path.join(dist, 'index.html'), INDEX);
    writeFileSync(path.join(dist, 'assets', 'app.js'), 'export {};');
    app = await buildApp({ kind: 'static', dist });
  });

  afterAll(async () => {
    await app.close();
    rmSync(dist, { recursive: true, force: true });
  });

  it.each(['/', '/dm', '/dm/anything'])('serves the client shell at %s', async (url) => {
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.body).toBe(INDEX);
  });

  it('serves the files of the build', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('export {};');
  });

  // No REST resource exists yet, so no /api path answers: nothing is reachable
  // without a DM session (specs/02-architecture.md §5).
  it.each(['/api', '/api/health', '/api/campaigns', '/api/scenes/x'])('answers 404 at %s', async (url) => {
    for (const method of ['GET', 'POST'] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain('id="root"');
    }
  });

  it('answers 404 for a path outside the two views and the build, including traversal attempts', async () => {
    for (const url of ['/dmx', '/assets/missing.js', '/../package.json', '/%2e%2e/package.json', '/assets/../../x']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
  });

  it('refuses to start without a build, and says how to make one', async () => {
    const empty = mkdtempSync(path.join(os.tmpdir(), 'emberglass-nodist-'));
    try {
      await expect(buildApp({ kind: 'static', dist: empty })).rejects.toThrow(/npm run build/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('buildApp in development', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ kind: 'dev', root: CLIENT_ROOT });
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['/', '/dm'])('serves the client shell through Vite at %s', async (url) => {
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('/@vite/client');
    expect(response.body).toContain('id="root"');
  });

  it('serves the client entry module through Vite', async () => {
    const response = await app.inject({ method: 'GET', url: '/src/main.tsx' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/javascript/);
  });

  it('does not let Vite answer under /api', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(404);
  });
});

describe('within', () => {
  it('stops waiting for work that never settles once the limit passes', async () => {
    const started = Date.now();
    await within(50, () => new Promise(() => {}));
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
  });

  it('returns as soon as the work settles, and swallows its failure', async () => {
    const started = Date.now();
    await within(5_000, () => Promise.reject(new Error('closed already')));
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
