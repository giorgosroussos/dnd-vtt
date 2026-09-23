import { loadConfig } from './config.js';
import { migrateDataDirectory } from './db/migrate.js';
import { buildApp } from './http/app.js';
import { CLIENT_DIST, CLIENT_ROOT, MIGRATIONS_DIR } from './paths.js';

// One process: the built client (or Vite in development), the REST API and,
// from LIV-01, the WebSocket (specs/02-architecture.md §2).
export async function start({ dev }: { dev: boolean }): Promise<void> {
  const config = loadConfig();

  // Migrations run before the server accepts connections (specs/09-operations.md §2).
  const migration = migrateDataDirectory(config.dataDir, MIGRATIONS_DIR);
  if (migration.backup) console.log(`Database backed up to ${migration.backup}`);

  const app = await buildApp(dev ? { kind: 'dev', root: CLIENT_ROOT } : { kind: 'static', dist: CLIENT_DIST });
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`Emberglass is running on port ${config.port}${dev ? ' (development)' : ''}.`);

  const stop = (): void => {
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
