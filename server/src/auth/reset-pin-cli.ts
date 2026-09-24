// `npm run reset-pin`: clear the DM PIN of the configured data directory (D-028).
import { assertSupportedNode } from '../node-version.js';

assertSupportedNode(process.versions.node);

const { loadConfig } = await import('../config.js');
const { databasePath } = await import('../db/database.js');
const { createLogger } = await import('../log/logger.js');
const { MIGRATIONS_DIR } = await import('../paths.js');
const { resetPin } = await import('./reset-pin.js');

const config = loadConfig();
const database = databasePath(config.dataDir);
const result = resetPin(config.dataDir, MIGRATIONS_DIR);
if (result === 'no-database') {
  console.error(`No Emberglass database at ${database}; nothing to reset. Is EMBERGLASS_DATA_DIR right?`);
  process.exit(1);
}
const logger = createLogger({ dataDir: config.dataDir });
const setup = `Open http://localhost:${config.port}/dm in a browser on this PC to set a new one.`;
if (result === 'cleared') logger.info('pin.reset', `The DM PIN was cleared in ${database}. ${setup}`);
else logger.info('pin.reset', `No DM PIN was set in ${database}. ${setup}`);
