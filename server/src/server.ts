import { loadConfig } from './config.js';
import { migrateDataDirectory } from './db/migrate.js';
import { buildApp } from './http/app.js';
import { createLogger } from './log/logger.js';
import { CLIENT_DIST, CLIENT_ROOT, MIGRATIONS_DIR } from './paths.js';

// One process: the built client (or Vite in development), the REST API and,
// from LIV-01, the WebSocket (specs/02-architecture.md §2).
export async function start({ dev }: { dev: boolean }): Promise<void> {
  const config = loadConfig();
  // Console and logs/emberglass.log in the data directory (specs/09-operations.md §6, D-035).
  const logger = createLogger({ dataDir: config.dataDir });

  try {
    // Migrations run before the server accepts connections (specs/09-operations.md §2).
    const migration = migrateDataDirectory(config.dataDir, MIGRATIONS_DIR);
    if (migration.backup) logger.info('db.backup', `Database backed up to ${migration.backup}`);

    const app = await buildApp({
      client: dev ? { kind: 'dev', root: CLIENT_ROOT } : { kind: 'static', dist: CLIENT_DIST },
      logger,
    });
    await app.listen({ port: config.port, host: '0.0.0.0' });
    logger.info('server.started', `Emberglass is running on port ${config.port}${dev ? ' (development)' : ''}.`, {
      port: config.port,
      dataDir: config.dataDir,
    });

    const stop = (): void => {
      app.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    logger.error('server.failed', 'Emberglass could not start.', { error });
    throw error;
  }
}
