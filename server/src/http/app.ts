import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type Database from 'better-sqlite3';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { VIEW_PATHS } from '@emberglass/shared';
import type { Logger } from '../log/logger.js';
import { compileSchema } from '../validation.js';
import type { ScryptParams } from '../auth/pin-hash.js';
import { registerAssets } from './assets.js';
import { registerAuth, type Auth } from './auth.js';
import { registerCampaigns } from './campaigns.js';
import { registerTokens } from './tokens.js';
import { imageFileRemover, registerImages } from './images.js';
import { imagesDirOf, prepareImagesDir } from '../images/store.js';
import { createFailureLog, installErrorHandling, sendFailure, type RejectedLineLimits } from './errors.js';

// Where the client comes from: the production build, or Vite in middleware mode
// on the same port during development (D-014, D-033).
export type ClientSource = { kind: 'static'; dist: string } | { kind: 'dev'; root: string };

type SendIndex = (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;

export interface AppOptions {
  client: ClientSource;
  logger: Logger;
  /** The open database of the data directory, already migrated. */
  db: Database.Database;
  /** The data directory, whose images folder holds the image files (specs/09-operations.md §5). */
  dataDir: string;
  /** The lockout's clock, for tests. */
  now?: (() => number) | undefined;
  /** The cost of new PIN hashes; tests only lower it. */
  pinHashParams?: Readonly<ScryptParams> | undefined;
  /** Limits on rejected-request log lines (G-006); the defaults suit production. */
  rejectedLines?: RejectedLineLimits | undefined;
}

declare module 'fastify' {
  interface FastifyInstance {
    // LIV-01's WebSocket handshake checks the same sessions.
    auth: Auth;
    // Every route declared, HEAD routes included: the tests that check every
    // /api route read it, so a new route cannot escape them.
    declaredRoutes: readonly { method: string; url: string }[];
  }
}

// The REST conventions of FND-03 (specs/02-architecture.md §5, D-015, D-063, D-067):
// bodies are validated by the one strict validator against schemas from shared,
// and every error, an unknown path included, answers in the shared envelope.
// Every /api route but PIN entry and setup needs a DM session (SRV-02,
// specs/02-architecture.md §5). Fastify's request logging stays off (D-029);
// failures are logged by the error handler, without query strings, headers or
// bodies, and rejected requests at a bounded rate per client (G-006).
export async function buildApp({
  client,
  logger,
  db,
  dataDir,
  now,
  pinHashParams,
  rejectedLines,
}: AppOptions): Promise<FastifyInstance> {
  const failures = createFailureLog(logger, rejectedLines);
  const app = Fastify({
    logger: false,
    frameworkErrors: (error, request, reply) => {
      sendFailure(error, request, reply, failures);
    },
  });
  const declaredRoutes: { method: string; url: string }[] = [];
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) declaredRoutes.push({ method, url: route.url });
  });
  app.setValidatorCompiler(({ schema }) => compileSchema(schema));
  installErrorHandling(app, failures);
  const auth = registerAuth(app, { db, logger, now, pinHashParams });
  const imagesDir = imagesDirOf(dataDir);
  const { unreferenced, orphans } = prepareImagesDir(db, imagesDir);
  if (unreferenced.length > 0) {
    logger.info('images.unreferenced_removed', `Removed ${unreferenced.length} images that nothing references.`, {
      removed: unreferenced.length,
    });
  }
  if (orphans.length > 0) {
    logger.info('images.orphans_removed', `Removed ${orphans.length} image folders without a database row.`, {
      removed: orphans.length,
    });
  }
  const removeImages = imageFileRemover(imagesDir, logger);
  registerCampaigns(app, db, removeImages);
  registerAssets(app, db, removeImages);
  registerTokens(app, db);
  await registerImages(app, { db, imagesDir, auth });
  const sendIndex = client.kind === 'static' ? await serveBuild(app, client.dist) : await serveVite(app, client.root);

  // Both views come from one client build: the player view at /, the DM view at /dm.
  app.get(VIEW_PATHS.player, sendIndex);
  app.get(VIEW_PATHS.dm, sendIndex);
  app.get(`${VIEW_PATHS.dm}/*`, sendIndex);
  app.decorate('auth', auth);
  app.decorate('declaredRoutes', declaredRoutes);
  return app;
}

async function serveBuild(app: FastifyInstance, dist: string): Promise<SendIndex> {
  if (!existsSync(path.join(dist, 'index.html'))) {
    throw new Error(`No client build in ${dist}. Run \`npm run build\` (or \`npm start\`, which builds it).`);
  }
  // Only files that exist in the build get a route; nothing else touches the disk.
  await app.register(fastifyStatic, { root: dist, index: false, wildcard: false });
  return async (_request, reply) => reply.header('cache-control', 'no-cache').sendFile('index.html');
}

// Longest wait for each step of closing Vite in development; two steps stay
// under the 10 s hook timeout of the tests.
const VITE_CLOSE_STEP_MS = 4_000;

/** Run `work`, but stop waiting for it after `ms`; it keeps running unobserved. */
export async function within(ms: number, work: () => Promise<unknown>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  await Promise.race([work().catch(() => undefined), limit]);
  clearTimeout(timer);
}

async function serveVite(app: FastifyInstance, root: string): Promise<SendIndex> {
  const [{ createServer }, { default: middie }] = await Promise.all([import('vite'), import('@fastify/middie')]);
  const vite = await createServer({
    root,
    configFile: path.join(root, 'vite.config.ts'),
    appType: 'custom',
    server: { middlewareMode: true, hmr: { server: app.server } },
  });
  await app.register(middie);
  app.use(vite.middlewares);
  app.addHook('onClose', async () => {
    // Vite's close cancels a dependency optimization in progress, and requests
    // already waiting on it then never settle, so close waits for them forever.
    // On a slow machine the first optimization is still running when a short
    // session closes; let it finish first. Each step is bounded, so closing the
    // app, and a Ctrl-C of `make dev` (server.ts), always gets through.
    await within(VITE_CLOSE_STEP_MS, async () => {
      await vite.waitForRequestsIdle();
      const discovered = Object.values(vite.environments.client.depsOptimizer?.metadata.discovered ?? {});
      await Promise.allSettled(discovered.flatMap((dep) => (dep.processing ? [dep.processing] : [])));
    });
    await within(VITE_CLOSE_STEP_MS, () => vite.close());
  });
  return async (request, reply) => {
    const html = await readFile(path.join(root, 'index.html'), 'utf8');
    return reply.type('text/html').send(await vite.transformIndexHtml(request.url, html));
  };
}
