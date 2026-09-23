// Server entry point: `npm start` runs the build of this file, `npm run dev` runs it with `--dev`.
import { assertSupportedNode } from './node-version.js';

assertSupportedNode(process.versions.node);

const { start } = await import('./server.js');
await start({ dev: process.argv.includes('--dev') });
