// The package's launcher entry (`app/launcher.mjs`, run by `Emberglass.cmd`; PKG-01, D-164, D-166).
import { assertSupportedNode } from './node-version.js';

assertSupportedNode(process.versions.node);

declare const __EMBERGLASS_BUNDLE__: boolean | undefined;

const { loadConfig } = await import('./config.js');
const { isEmberglassAnswering, launch, openInBrowser, PortInUseError, portInUseAdvice } = await import('./launcher.js');

// The server's entry is beside this one: `server.mjs` in the package, `main.js` in server/dist. The
// specifier is computed so that the package build keeps the two bundles apart.
const serverEntry =
  typeof __EMBERGLASS_BUNDLE__ !== 'undefined' && __EMBERGLASS_BUNDLE__ ? './server.mjs' : './main.js';

// The window's exit: 0 closes it; 1 and 2 make Emberglass.cmd pause so that the DM can read why (a failure,
// or a DM view that no browser opened). A running server keeps the process, and the window, open.
try {
  const { outcome, opened } = await launch({
    port: loadConfig().port,
    isAnswering: (port) => isEmberglassAnswering(port),
    startServer: async () => {
      await import(new URL(serverEntry, import.meta.url).href);
    },
    open: (url) => openInBrowser(url),
    print: (line) => console.log(line),
  });
  if (outcome === 'opened-running') process.exit(opened ? 0 : 2);
} catch (error) {
  if (error instanceof PortInUseError)
    for (const line of portInUseAdvice(error.port, process.platform)) console.error(line);
  else console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
