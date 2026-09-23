import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { VIEW_PATHS } from '@emberglass/shared';

// Where the client comes from: the production build, or Vite in middleware mode
// on the same port during development (D-014, D-033).
export type ClientSource = { kind: 'static'; dist: string } | { kind: 'dev'; root: string };

type SendIndex = (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;

// The REST API arrives under /api with FND-03 and later packages. Until then no
// /api route exists, so every /api path is a 404 and nothing is reachable
// without a DM session (specs/02-architecture.md §5).
export async function buildApp(client: ClientSource): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const sendIndex = client.kind === 'static' ? await serveBuild(app, client.dist) : await serveVite(app, client.root);

  // Both views come from one client build: the player view at /, the DM view at /dm.
  app.get(VIEW_PATHS.player, sendIndex);
  app.get(VIEW_PATHS.dm, sendIndex);
  app.get(`${VIEW_PATHS.dm}/*`, sendIndex);
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
    // session closes; let it finish first.
    await vite.waitForRequestsIdle();
    const discovered = Object.values(vite.environments.client.depsOptimizer?.metadata.discovered ?? {});
    await Promise.allSettled(discovered.flatMap((dep) => (dep.processing ? [dep.processing] : [])));
    await vite.close();
  });
  return async (request, reply) => {
    const html = await readFile(path.join(root, 'index.html'), 'utf8');
    return reply.type('text/html').send(await vite.transformIndexHtml(request.url, html));
  };
}
