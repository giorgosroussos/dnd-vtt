// `npm start`: build the client and server if no build exists, then start the
// server, which applies pending migrations first (specs/09-operations.md §1, D-033).
//
// Written in syntax an old Node can still parse, so that the version check below
// is what a DM on an old Node sees, not a syntax error (D-012).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MINIMUM_NODE_MAJOR = 24;
const major = parseInt(process.versions.node.split('.')[0], 10);
if (!(major >= MINIMUM_NODE_MAJOR)) {
  console.error(
    'Emberglass needs Node.js ' +
      MINIMUM_NODE_MAJOR +
      ' or newer; this is Node.js ' +
      process.versions.node +
      '. ' +
      'Install the version named in .nvmrc and start again.',
  );
  process.exit(1);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const built = ['server/dist/main.js', 'shared/dist/index.js', 'client/dist/index.html'].every((file) =>
  existsSync(new URL('../' + file, import.meta.url)),
);

if (!built) {
  console.log('No build found: building Emberglass first.');
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status === null ? 1 : result.status);
}

import(new URL('../server/dist/main.js', import.meta.url).href).catch((error) => {
  console.error(error);
  process.exit(1);
});
