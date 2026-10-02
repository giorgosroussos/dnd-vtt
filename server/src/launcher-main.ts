// The package's launcher entry (`app/launcher.mjs`, run by `Emberglass.cmd`; PKG-01, D-164, D-166).
import { assertSupportedNode } from './node-version.js';

assertSupportedNode(process.versions.node);

declare const __EMBERGLASS_BUNDLE__: boolean | undefined;

const { loadConfig } = await import('./config.js');
const { isEmberglassAnswering, launch, openInBrowser } = await import('./launcher.js');

// The server's entry is beside this one: `server.mjs` in the package, `main.js` in server/dist. The
// specifier is computed so that the package build keeps the two bundles apart.
const serverEntry =
  typeof __EMBERGLASS_BUNDLE__ !== 'undefined' && __EMBERGLASS_BUNDLE__ ? './server.mjs' : './main.js';

try {
  await launch({
    port: loadConfig().port,
    isAnswering: (port) => isEmberglassAnswering(port),
    startServer: async () => {
      await import(new URL(serverEntry, import.meta.url).href);
    },
    open: (url) => openInBrowser(url),
    print: (line) => console.log(line),
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
