import { loadConfig } from './config.js';
import { connectBanner, connectInfo, systemInterfaces } from './connect.js';
import { openDatabase } from './db/database.js';
import { migrateDataDirectory } from './db/migrate.js';
import { readPinHash } from './db/settings.js';
import { buildApp } from './http/app.js';
import { createLogger } from './log/logger.js';
import { CLIENT_DIST, CLIENT_ROOT, MIGRATIONS_DIR } from './paths.js';

// One process: the built client (or Vite in development), the REST API and the
// WebSocket of the live scene, all on one port (specs/02-architecture.md §2).
export async function start({ dev }: { dev: boolean }): Promise<void> {
  const config = loadConfig();
  // Console and logs/emberglass.log in the data directory (specs/09-operations.md §6, D-035).
  const logger = createLogger({ dataDir: config.dataDir });

  try {
    // Migrations run before the server accepts connections (specs/09-operations.md §2).
    const migration = migrateDataDirectory(config.dataDir, MIGRATIONS_DIR);
    if (migration.backup) logger.info('db.backup', `Database backed up to ${migration.backup}`);

    const db = openDatabase(config.dataDir);
    const app = await buildApp({
      client: dev ? { kind: 'dev', root: CLIENT_ROOT } : { kind: 'static', dist: CLIENT_DIST },
      logger,
      db,
      dataDir: config.dataDir,
    });
    app.addHook('onClose', () => db.close());
    await app.listen({ port: config.port, host: '0.0.0.0' });
    logger.info('server.started', `Emberglass is running on port ${config.port}${dev ? ' (development)' : ''}.`, {
      port: config.port,
      dataDir: config.dataDir,
    });
    // The player view's URL and QR code for the TV, straight to the console: a QR code is not a
    // log line (specs/09-operations.md §2, §4, specs/08-ux-journeys.md §5); the URLs are logged too.
    const connect = connectInfo(systemInterfaces(), config.port);
    logger.info(
      'server.addresses',
      `Player view: ${connect.addresses.map((entry) => entry.url).join(' ') || 'no network address'}`,
      {
        urls: connect.addresses.map((entry) => entry.url),
      },
    );
    process.stdout.write(connectBanner(connect, process.platform));
    const hint = pinSetupHint(readPinHash(db), config.port);
    if (hint) logger.info('pin.unset', hint);

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

/** The console hint when no PIN is set (specs/09-operations.md §2); null once one is. */
export function pinSetupHint(pinHash: string | null, port: number): string | null {
  if (pinHash !== null) return null;
  return `No DM PIN is set yet. Open http://localhost:${port}/dm in a browser on this PC to set it.`;
}
