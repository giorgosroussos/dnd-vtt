import { readFileSync } from 'node:fs';
import { inflateRawSync, crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createIco, createZip, nameOfKey, packageDirOf, productionClosure, resolveLockKey, runsOn } from './lib.mjs';

// The helpers of the Windows package build (PKG-01, D-164, D-166). `make package` runs the build
// and its acceptance check on the real package; these pin the parts whose mistakes would ship
// quietly: a missing or extra module, an unreadable zip.

const windows = { platform: 'win32', arch: 'x64', libc: null };
const glibc = { platform: 'linux', arch: 'x64', libc: 'glibc' };

describe('runsOn', () => {
  it('admits a package with no os, cpu or libc on every target', () => {
    expect(runsOn({}, windows)).toBe(true);
    expect(runsOn({}, glibc)).toBe(true);
  });

  it('follows os, cpu and libc, with ! as an exclusion', () => {
    expect(runsOn({ os: ['win32'], cpu: ['x64'] }, windows)).toBe(true);
    expect(runsOn({ os: ['win32'], cpu: ['arm64'] }, windows)).toBe(false);
    expect(runsOn({ os: ['linux'] }, windows)).toBe(false);
    expect(runsOn({ os: ['!win32'] }, windows)).toBe(false);
    expect(runsOn({ os: ['!win32'] }, glibc)).toBe(true);
    expect(runsOn({ os: ['linux'], libc: ['musl'] }, glibc)).toBe(false);
    expect(runsOn({ os: ['linux'], libc: ['glibc'] }, glibc)).toBe(true);
    // Off Linux there is no libc to match.
    expect(runsOn({ libc: ['glibc'] }, windows)).toBe(true);
  });
});

describe('resolveLockKey and nameOfKey', () => {
  const packages = {
    '': {},
    server: {},
    'node_modules/a': {},
    'node_modules/a/node_modules/b': {},
    'node_modules/b': {},
    'node_modules/@s/c': {},
    'server/node_modules/d': {},
  };

  it('finds the nearest copy, walking up the node_modules folders as Node does', () => {
    expect(resolveLockKey(packages, 'node_modules/a', 'b')).toBe('node_modules/a/node_modules/b');
    expect(resolveLockKey(packages, 'node_modules/a/node_modules/b', 'a')).toBe('node_modules/a');
    expect(resolveLockKey(packages, 'node_modules/@s/c', 'b')).toBe('node_modules/b');
    expect(resolveLockKey(packages, 'server', 'd')).toBe('server/node_modules/d');
    expect(resolveLockKey(packages, 'server', 'a')).toBe('node_modules/a');
    expect(resolveLockKey(packages, '', 'missing')).toBeNull();
  });

  it('names a key by what follows its last node_modules/', () => {
    expect(nameOfKey('node_modules/a/node_modules/b')).toBe('b');
    expect(nameOfKey('node_modules/@s/c')).toBe('@s/c');
  });
});

describe('productionClosure', () => {
  const lock = {
    packages: {
      '': { workspaces: ['server', 'shared'] },
      server: { dependencies: { '@x/shared': '1', native: '1' }, devDependencies: { tool: '1' } },
      shared: { dependencies: { schema: '1' } },
      'node_modules/@x/shared': { link: true, resolved: 'shared' },
      'node_modules/native': {
        dependencies: { helper: '1' },
        optionalDependencies: { 'native-win32-x64': '1', 'native-linux-x64': '1', 'native-linux-x64-musl': '1' },
        peerDependencies: { host: '1', optionalpeer: '1' },
        peerDependenciesMeta: { optionalpeer: { optional: true } },
      },
      'node_modules/native/node_modules/helper': { dependencies: { leaf: '1' } },
      'node_modules/helper': {},
      'node_modules/leaf': {},
      'node_modules/host': {},
      'node_modules/optionalpeer': {},
      'node_modules/native-win32-x64': { os: ['win32'], cpu: ['x64'], optional: true },
      'node_modules/native-linux-x64': { os: ['linux'], cpu: ['x64'], optional: true },
      'node_modules/native-linux-x64-musl': { os: ['linux'], cpu: ['x64'], optional: true },
      'node_modules/schema': {},
      'node_modules/tool': { dev: true },
    },
  };
  const all = () => true;

  it('follows dependencies, workspace links and required peers, never devDependencies', () => {
    expect(productionClosure(lock, ['server'], windows, all)).toEqual([
      'node_modules/host',
      'node_modules/leaf',
      'node_modules/native',
      'node_modules/native-win32-x64',
      'node_modules/native/node_modules/helper',
      'node_modules/schema',
    ]);
  });

  it("keeps only the optional packages for the target, read from the installed manifest's libc", () => {
    const manifest = (key) => (key === 'node_modules/native-linux-x64-musl' ? { libc: ['musl'] } : null);
    expect(productionClosure(lock, ['native'], glibc, all, manifest)).toEqual([
      'node_modules/host',
      'node_modules/leaf',
      'node_modules/native',
      'node_modules/native-linux-x64',
      'node_modules/native/node_modules/helper',
    ]);
  });

  it('leaves out an optional package that is not installed', () => {
    const installed = (key) => key !== 'node_modules/native-win32-x64';
    expect(productionClosure(lock, ['native'], windows, installed)).not.toContain('node_modules/native-win32-x64');
  });

  it('refuses a required dependency missing from the lock', () => {
    const broken = { packages: { ...lock.packages, 'node_modules/leaf': undefined } };
    delete broken.packages['node_modules/leaf'];
    expect(() => productionClosure(broken, ['native'], windows, all)).toThrow(/leaf, a dependency of/);
  });

  it('reads the real lock: the shipped native modules hold no build tool and no workspace', () => {
    const real = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
    const keys = productionClosure(real, ['better-sqlite3', 'sharp'], windows, all);
    const names = keys.map(nameOfKey);
    expect(names).toContain('better-sqlite3');
    expect(names).toContain('sharp');
    expect(names).toContain('@img/sharp-win32-x64');
    expect(names.filter((name) => name.startsWith('@img/sharp-') && !name.includes('win32-x64'))).toEqual([]);
    for (const name of ['@emberglass/shared', 'vite', 'esbuild', 'typescript', 'tsx', 'node-gyp', 'prebuild-install']) {
      expect(names).not.toContain(name);
    }
  });
});

describe('packageDirOf', () => {
  it('is the package folder of a file in node_modules, scoped or not', () => {
    expect(packageDirOf('node_modules/fastify/lib/route.js')).toBe('node_modules/fastify');
    expect(packageDirOf('node_modules/@fastify/static/index.js')).toBe('node_modules/@fastify/static');
    expect(packageDirOf('node_modules/a/node_modules/b/x.js')).toBe('node_modules/a/node_modules/b');
    expect(packageDirOf('server/src/main.ts')).toBeNull();
  });
});

/** The entries of a zip, read back from its central directory as an unzip tool reads them. */
function readZip(zip) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const mode = zip.readUInt32LE(at + 38) >>> 16;
    const offset = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const localName = zip.readUInt16LE(offset + 26);
    const body = zip.subarray(offset + 30 + localName, offset + 30 + localName + size);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    expect(crc32(data)).toBe(crc);
    entries.push({ name, data, mode });
    at += 46 + nameLength;
  }
  return entries;
}

describe('createZip', () => {
  it('writes entries that read back intact, with their names, contents and modes', () => {
    const text = Buffer.from('Emberglass\r\n'.repeat(200));
    const random = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 7919) % 251));
    const zip = createZip(
      [
        { name: 'Emberglass/README.txt', data: text },
        { name: 'Emberglass/emberglass', data: random, mode: 0o100755 },
        { name: 'Emberglass/Reset PIN.cmd', data: Buffer.alloc(0) },
      ],
      new Date(2026, 9, 2, 12, 30, 0),
    );
    const entries = readZip(zip);
    expect(entries.map((entry) => entry.name)).toEqual([
      'Emberglass/README.txt',
      'Emberglass/emberglass',
      'Emberglass/Reset PIN.cmd',
    ]);
    expect(entries[0].data.equals(text)).toBe(true);
    expect(entries[1].data.equals(random)).toBe(true);
    expect(entries[1].mode & 0o777).toBe(0o755);
    expect(entries[0].mode & 0o777).toBe(0o644);
    expect(entries[2].data.length).toBe(0);
  });
});

describe('createIco', () => {
  it('indexes each PNG with its size, 256 written as 0', () => {
    const ico = createIco([
      { size: 16, png: Buffer.from('aaaa') },
      { size: 256, png: Buffer.from('bbbbbb') },
    ]);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);
    expect(ico[6]).toBe(16);
    expect(ico[6 + 16]).toBe(0);
    const second = ico.readUInt32LE(6 + 16 + 12);
    expect(ico.subarray(second, second + 6).toString()).toBe('bbbbbb');
  });
});
