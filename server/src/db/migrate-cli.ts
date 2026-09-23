// `make migrate` / `npm run migrate`: apply pending migrations to the configured data directory.
import { assertSupportedNode } from '../node-version.js';

assertSupportedNode(process.versions.node);

const { loadConfig } = await import('../config.js');
const { MIGRATIONS_DIR } = await import('../paths.js');
const { migrateDataDirectory } = await import('./migrate.js');

const result = migrateDataDirectory(loadConfig().dataDir, MIGRATIONS_DIR);
if (result.backup) console.log(`Backup written to ${result.backup}`);
console.log(
  `${result.database}: schema version ${result.from} -> ${result.to}` +
    (result.applied.length > 0 ? ` (applied ${result.applied.join(', ')})` : ' (nothing to apply)'),
);
