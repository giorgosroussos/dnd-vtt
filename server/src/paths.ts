import { fileURLToPath } from 'node:url';

// Set to true by the package build's esbuild `define` (scripts/package/build.mjs, PKG-01, D-164);
// undefined when the server runs from source (server/src) or from its tsc build (server/dist).
declare const __EMBERGLASS_BUNDLE__: boolean | undefined;

export interface ServerPaths {
  migrations: string;
  clientRoot: string;
  clientDist: string;
}

/**
 * Where the migrations and the client are, from the URL of the module that asks. From source and
 * from the tsc build the module sits one level below the server workspace (server/src, server/dist),
 * beside `migrations/` and below the repository's `client/`. In the Windows package the bundle is
 * `app/server.mjs`, with `app/migrations/` and `app/client/dist/` beside it (D-164).
 */
export function serverPaths(moduleUrl: string, bundled: boolean): ServerPaths {
  const migrations = bundled ? new URL('./migrations/', moduleUrl) : new URL('../migrations/', moduleUrl);
  const clientRoot = bundled ? new URL('./client/', moduleUrl) : new URL('../../client/', moduleUrl);
  return {
    migrations: fileURLToPath(migrations),
    clientRoot: fileURLToPath(clientRoot),
    clientDist: fileURLToPath(new URL('dist/', clientRoot)),
  };
}

const paths = serverPaths(import.meta.url, typeof __EMBERGLASS_BUNDLE__ !== 'undefined' && __EMBERGLASS_BUNDLE__);

export const MIGRATIONS_DIR = paths.migrations;
export const CLIENT_ROOT = paths.clientRoot;
export const CLIENT_DIST = paths.clientDist;
