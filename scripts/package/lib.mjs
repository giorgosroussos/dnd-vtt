// Helpers of the Windows package build and its check (PKG-01, specs/09-operations.md §1, D-164, D-166):
// the production closure of a set of packages read from package-lock.json, their licence files, a zip
// writer and an ICO writer. Nothing here touches the network.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

/** @typedef {{ platform: string, arch: string, libc: 'glibc' | 'musl' | null }} Target */

/** The machine this runs on, as package-lock.json's `os`, `cpu` and `libc` fields name it. */
export function hostTarget() {
  const libc =
    process.platform === 'linux'
      ? /** @type {{ header?: { glibcVersionRuntime?: string } }} */ (process.report.getReport()).header
          ?.glibcVersionRuntime
        ? 'glibc'
        : 'musl'
      : null;
  return /** @type {Target} */ ({ platform: process.platform, arch: process.arch, libc });
}

/** Whether an npm `os`/`cpu`/`libc` list admits a value: absent admits all, `!x` excludes x. */
function admits(list, value) {
  if (!Array.isArray(list) || list.length === 0) return true;
  if (value === null) return true;
  const excluded = list.filter((entry) => entry.startsWith('!')).map((entry) => entry.slice(1));
  const included = list.filter((entry) => !entry.startsWith('!'));
  if (excluded.includes(value)) return false;
  return included.length === 0 || included.includes(value);
}

/** @param {Record<string, any>} entry @param {Target} target */
export function runsOn(entry, target) {
  return admits(entry.os, target.platform) && admits(entry.cpu, target.arch) && admits(entry.libc, target.libc);
}

/** The lock key a dependency named `name` of the package at `from` resolves to, as Node would find it. */
export function resolveLockKey(packages, from, name) {
  let base = from;
  for (;;) {
    const key = base === '' ? `node_modules/${name}` : `${base}/node_modules/${name}`;
    if (packages[key]) return key;
    if (base === '') return null;
    const cut = base.lastIndexOf('/node_modules/');
    base = cut >= 0 ? base.slice(0, cut) : '';
  }
}

/** The installed package.json of a lock key under `root`, or null when it is not installed. */
export function installedManifest(root, key) {
  const file = path.join(root, ...key.split('/'), 'package.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

/** The package name of a lock key: what follows its last `node_modules/`. */
export function nameOfKey(key) {
  const cut = key.lastIndexOf('node_modules/');
  return cut >= 0 ? key.slice(cut + 'node_modules/'.length) : key;
}

/**
 * The production closure of `roots` (package names, or workspace folders such as `server`) in a
 * package-lock.json: every lock key reachable through `dependencies`, `optionalDependencies` that
 * run on the target and are installed, and non-optional `peerDependencies`. Workspace links are
 * followed into their folder. Returns lock keys of real packages (no links, no workspaces), sorted.
 *
 * @param {{ packages: Record<string, any> }} lock
 * @param {string[]} roots
 * @param {Target} target
 * @param {(key: string) => boolean} installed
 * @param {(key: string) => Record<string, any> | null} [manifest] the installed package.json of a key:
 *   package-lock.json leaves out `libc`, which only the package's own manifest states
 */
export function productionClosure(lock, roots, target, installed, manifest = () => null) {
  const packages = lock.packages;
  const found = new Set();
  const queue = [];
  for (const root of roots) {
    const key = packages[root] ? root : resolveLockKey(packages, '', root);
    if (!key) throw new Error(`${root} is not in package-lock.json`);
    queue.push(key);
  }
  const seen = new Set();
  while (queue.length > 0) {
    let key = /** @type {string} */ (queue.shift());
    if (seen.has(key)) continue;
    seen.add(key);
    let entry = packages[key];
    if (entry.link) {
      key = entry.resolved;
      entry = packages[key];
      if (!entry || seen.has(key)) continue;
      seen.add(key);
    }
    const workspace = !key.includes('node_modules/');
    if (!workspace) found.add(key);
    const optional = entry.optionalDependencies ?? {};
    const peerMeta = entry.peerDependenciesMeta ?? {};
    const wanted = [
      ...Object.keys(entry.dependencies ?? {}).map((name) => ({ name, optional: name in optional })),
      ...Object.keys(optional).map((name) => ({ name, optional: true })),
      ...Object.keys(entry.peerDependencies ?? {})
        .filter((name) => !peerMeta[name]?.optional)
        .map((name) => ({ name, optional: false })),
    ];
    for (const { name, optional: isOptional } of wanted) {
      const dep = resolveLockKey(packages, key, name);
      if (!dep) {
        if (isOptional) continue;
        throw new Error(`${name}, a dependency of ${key}, is not in package-lock.json`);
      }
      if (isOptional) {
        if (!installed(dep)) continue;
        const own = manifest(dep) ?? {};
        const platformFields = { os: own.os ?? packages[dep].os, cpu: own.cpu ?? packages[dep].cpu, libc: own.libc };
        if (!runsOn(platformFields, target)) continue;
      }
      queue.push(dep);
    }
  }
  return [...found].sort();
}

const LICENCE_FILE = /^(?:licen[cs]e|copying|notice)(?:[.\-_].*)?$/i;

/** The licence and notice files at the top of a package folder, sorted by name. */
export function licenceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && LICENCE_FILE.test(entry.name))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

/** The `name`, `version` and `license` of the package in `dir`. */
export function packageInfo(dir) {
  const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const license =
    typeof manifest.license === 'string'
      ? manifest.license
      : (manifest.license?.type ?? manifest.licenses?.map((entry) => entry.type).join(' OR ') ?? 'UNKNOWN');
  return { name: manifest.name, version: manifest.version, license };
}

/** The package folder of a file inside node_modules, or null for a file outside one. */
export function packageDirOf(file) {
  const normal = file.split(path.sep).join('/');
  const cut = normal.lastIndexOf('node_modules/');
  if (cut < 0) return null;
  const rest = normal.slice(cut + 'node_modules/'.length).split('/');
  const parts = rest[0]?.startsWith('@') ? rest.slice(0, 2) : rest.slice(0, 1);
  return normal.slice(0, cut) + 'node_modules/' + parts.join('/');
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** A DOS date and time for zip headers, in local time as zip readers show it. */
function dosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * A zip archive of `entries` ({ name, data, mode }), deflated, without zip64: the package is far
 * under 4 GiB and 65,535 files. Folder entries are implied by the paths, as Explorer reads them.
 * Unix modes are recorded so that an extracted runtime stays executable off Windows.
 *
 * @param {{ name: string, data: Buffer, mode?: number }[]} entries
 * @param {Date} mtime
 */
export function createZip(entries, mtime) {
  const { time, date } = dosDateTime(mtime);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const deflated = deflateRawSync(entry.data, { level: 9 });
    const stored = deflated.length >= entry.data.length;
    const body = stored ? entry.data : deflated;
    if (body.length > 0xffffffff || offset > 0xffffffff) throw new Error('the archive needs zip64');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by Unix, so the mode below is read
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((((entry.mode ?? 0o644) & 0o7777) | 0o100000) * 0x10000, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  if (entries.length > 0xffff) throw new Error('the archive needs zip64');
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** An ICO file holding the given square PNG images (Windows Vista onwards reads PNG in ICO). */
export function createIco(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const at = 6 + 16 * index;
    header.writeUInt8(size >= 256 ? 0 : size, at);
    header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt16LE(1, at + 4); // colour planes
    header.writeUInt16LE(32, at + 6); // bits per pixel
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.png)]);
}
