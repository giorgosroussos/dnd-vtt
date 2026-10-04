import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLIENT_DIST, MIGRATIONS_DIR, serverPaths } from './paths.js';

describe('serverPaths', () => {
  const root = path.resolve('/srv/emberglass');

  it('finds the migrations and the client from server/src and server/dist', () => {
    for (const folder of ['src', 'dist']) {
      const moduleUrl = pathToFileURL(path.join(root, 'server', folder, 'paths.js')).href;
      expect(serverPaths(moduleUrl, false)).toEqual({
        migrations: path.join(root, 'server', 'migrations') + path.sep,
        clientRoot: path.join(root, 'client') + path.sep,
        clientDist: path.join(root, 'client', 'dist') + path.sep,
      });
    }
  });

  it('finds them beside the bundle in the package (PKG-01, D-164)', () => {
    const moduleUrl = pathToFileURL(path.join(root, 'Emberglass', 'app', 'server.mjs')).href;
    expect(serverPaths(moduleUrl, true)).toEqual({
      migrations: path.join(root, 'Emberglass', 'app', 'migrations') + path.sep,
      clientRoot: path.join(root, 'Emberglass', 'app', 'client') + path.sep,
      clientDist: path.join(root, 'Emberglass', 'app', 'client', 'dist') + path.sep,
    });
  });

  it('points this checkout at its own migrations and client', () => {
    expect(MIGRATIONS_DIR).toBe(path.resolve(import.meta.dirname, '..', 'migrations') + path.sep);
    expect(CLIENT_DIST).toBe(path.resolve(import.meta.dirname, '..', '..', 'client', 'dist') + path.sep);
  });
});
