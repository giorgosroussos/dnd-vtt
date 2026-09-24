import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ErrorEnvelope } from '@emberglass/shared';
import { CLIENT_ROOT } from '../paths.js';
import { buildApp, within } from './app.js';
import { buildTestApp, createTestData, INDEX, quiet, setUpPin, type TestData } from './testing/app.js';

describe('buildApp serving a client build', () => {
  let data: TestData;
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    data = createTestData();
    app = await buildTestApp(data);
    cookie = await setUpPin(app, '2468');
  });

  afterAll(async () => {
    await app.close();
    data.remove();
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

  // Nothing under /api is reachable without a DM session, and with one an
  // unknown path is a 404 (specs/02-architecture.md §5).
  it.each(['/api', '/api/health', '/api/campaigns', '/api/scenes/x'])(
    'answers 401 at %s without a DM session and 404 with one, in the error envelope',
    async (url) => {
      for (const method of ['GET', 'POST'] as const) {
        const refused = await app.inject({ method, url });
        expect(refused.statusCode).toBe(401);
        expect(refused.json<ErrorEnvelope>()).toEqual({
          error: { code: 'unauthorized', message: 'A DM session is required.' },
        });
        const response = await app.inject({ method, url, headers: { cookie } });
        expect(response.statusCode).toBe(404);
        expect(response.json<ErrorEnvelope>()).toEqual({ error: { code: 'not_found', message: 'No such resource.' } });
      }
    },
  );

  it('answers 404 in the error envelope for a path outside the two views and the build, including traversal attempts', async () => {
    for (const url of ['/dmx', '/assets/missing.js', '/../package.json', '/%2e%2e/package.json', '/assets/../../x']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(404);
      expect(response.json<ErrorEnvelope>().error.code).toBe('not_found');
    }
  });

  it('refuses to start without a build, and says how to make one', async () => {
    const empty = mkdtempSync(path.join(os.tmpdir(), 'emberglass-nodist-'));
    try {
      await expect(buildApp({ client: { kind: 'static', dist: empty }, logger: quiet, db: data.db })).rejects.toThrow(
        /npm run build/,
      );
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('buildApp in development', () => {
  let data: TestData;
  let app: FastifyInstance;

  beforeAll(async () => {
    data = createTestData();
    app = await buildApp({ client: { kind: 'dev', root: CLIENT_ROOT }, logger: quiet, db: data.db });
  });

  afterAll(async () => {
    await app.close();
    data.remove();
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
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorEnvelope>().error.code).toBe('unauthorized');
    const cookie = await setUpPin(app, '2468');
    const signedIn = await app.inject({ method: 'GET', url: '/api/health', headers: { cookie } });
    expect(signedIn.statusCode).toBe(404);
    expect(signedIn.json<ErrorEnvelope>().error.code).toBe('not_found');
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
