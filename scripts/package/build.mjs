// `make package`, first half: the portable package of this machine's build (PKG-01, specs/09-operations.md
// §1, §3, specs/02-architecture.md §8, D-164, D-166). Run on the Windows runner it is the Windows x64
// package the release workflow publishes; anywhere else it builds the same folder for that system, to
// try the package locally, and nothing publishes it (only Windows x64 is packaged, `09` §3).
//
//   node scripts/package/build.mjs [--skip-build]     output: dist/package/
//
// The staged folder, zipped as Emberglass-<version>-<platform>-<arch>.zip beside its .sha256:
//
//   Emberglass/
//     emberglass.exe          the Node runtime this script runs on, renamed, with Emberglass's icon and
//                             description on Windows (the firewall prompt names the program by them)
//     Emberglass.cmd          the launcher: opens the DM view, starting the server if none answers
//     Reset PIN.cmd           clears the DM PIN (specs/07-security-and-access.md §1)
//     README.txt              how to start, the firewall, the data, the version and its source tag
//     LICENSE  CREDITS.md  THIRD_PARTY_NOTICES.txt
//     app/server.mjs  app/launcher.mjs  app/reset-pin.mjs    the server bundled by esbuild
//     app/migrations/  app/client/dist/
//     app/node_modules/       better-sqlite3 and sharp with their production dependencies, copied from
//                             this machine's `npm ci`, so the native binaries are this system's own
//
// Nothing is downloaded: the runtime is the Node that runs this script (setup-node's, from .nvmrc, in
// CI), the native modules are the ones `make setup` installed, and the licence texts are in the
// repository. A build without a tag names its commit instead and says it is not a release.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readBuildVersion } from '../../client/build-version.ts';
import {
  createIco,
  createZip,
  hostTarget,
  installedManifest,
  licenceFiles,
  nameOfKey,
  packageDirOf,
  packageInfo,
  productionClosure,
  sha256,
} from './lib.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.join(root, 'dist', 'package');
const stage = path.join(out, 'Emberglass');
const app = path.join(stage, 'app');
const target = hostTarget();
const windows = target.platform === 'win32';
const at = (...parts) => path.join(root, ...parts);

/** The native modules the bundle leaves external (D-164); everything else is inside server.mjs. */
const NATIVE = ['better-sqlite3', 'sharp'];
/** Development-only imports of the server, never reached in production (`app.ts` dev mode). */
const DEV_ONLY = ['vite', '@fastify/middie'];

const manifest = JSON.parse(readFileSync(at('package.json'), 'utf8'));
const version = readBuildVersion();
const repository = String(manifest.repository?.url ?? '').replace(/\.git$/, '');
if (!repository) throw new Error('package.json has no repository URL for the source offer.');

function log(line) {
  console.log(`package: ${line}`);
}

function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** The tag and commit the package is built from (AGPL-3.0 §6, `09` §1). */
function sourceInfo() {
  const commit = git('rev-parse', 'HEAD');
  const tag =
    process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME
      ? process.env.GITHUB_REF_NAME
      : git('describe', '--tags', '--exact-match', 'HEAD');
  const changed = git('status', '--porcelain', '--untracked-files=no');
  return { commit, tag, changed: changed !== null && changed !== '' };
}

// 1. The production build of the client and the server (`make build`'s, external-URL check included).
if (!process.argv.includes('--skip-build')) {
  log(`building Emberglass ${version}`);
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: windows,
    env: { ...process.env, EMBERGLASS_BUILD_VERSION: version },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!existsSync(at('client', 'dist', 'index.html'))) throw new Error('client/dist is missing: run `npm run build`.');

rmSync(out, { recursive: true, force: true });
mkdirSync(app, { recursive: true });

// 2. The server bundle: three entries, each a module of its own so that the launcher can start the
// server in its own process (closing the window stops it) without holding a second copy of it.
log('bundling the server');
const bundle = await build({
  absWorkingDir: root,
  entryPoints: {
    server: at('server', 'src', 'main.ts'),
    launcher: at('server', 'src', 'launcher-main.ts'),
    'reset-pin': at('server', 'src', 'auth', 'reset-pin-cli.ts'),
  },
  outdir: app,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: [...NATIVE, ...DEV_ONLY],
  define: { __EMBERGLASS_BUNDLE__: 'true' },
  // The CommonJS libraries inside an ES module bundle still call require for Node's built-ins.
  banner: {
    js: "import { createRequire as __emberglassRequire } from 'node:module';\nconst require = __emberglassRequire(import.meta.url);",
  },
  legalComments: 'eof',
  metafile: true,
  logLevel: 'warning',
});

// 3. The migrations and the client build, as paths.ts finds them beside the bundle.
mkdirSync(path.join(app, 'migrations'));
for (const file of readdirSync(at('server', 'migrations')).filter((name) => name.endsWith('.sql'))) {
  copyFileSync(at('server', 'migrations', file), path.join(app, 'migrations', file));
}
cpSync(at('client', 'dist'), path.join(app, 'client', 'dist'), { recursive: true });

// 4. The native modules with their production dependencies, for this system only.
const lock = JSON.parse(readFileSync(at('package-lock.json'), 'utf8'));
const installed = (key) => existsSync(at(...key.split('/')));
const ownManifest = (key) => installedManifest(root, key);
const nativeKeys = productionClosure(lock, NATIVE, target, installed, ownManifest);
const betterSqlitePrebuild = `${target.libc === 'musl' ? 'linuxmusl' : target.platform}-${target.arch}.node`;
if (!existsSync(at('node_modules', 'better-sqlite3', 'prebuilds', betterSqlitePrebuild))) {
  throw new Error(`better-sqlite3 has no prebuilt binary ${betterSqlitePrebuild} for this system.`);
}
for (const key of nativeKeys) {
  const from = at(...key.split('/'));
  const to = path.join(app, ...key.split('/'));
  cpSync(from, to, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(from, source).split(path.sep);
      // Nested node_modules are entries of the closure in their own right.
      if (relative[0] === 'node_modules') return false;
      if (nameOfKey(key) === 'better-sqlite3') {
        // The sources and the other systems' binaries are not needed to run (lib/binding.js).
        if (['deps', 'src', 'build', 'binding.gyp'].includes(relative[0] ?? '')) return false;
        if (relative[0] === 'prebuilds' && relative[1] && relative[1] !== betterSqlitePrebuild) return false;
      }
      return true;
    },
  });
}
log(`native modules: ${nativeKeys.map(nameOfKey).join(', ')}`);

// 5. The runtime: this Node, renamed; on Windows with Emberglass's icon and version information.
const runtimeName = windows ? 'emberglass.exe' : 'emberglass';
const runtime = path.join(stage, runtimeName);
if (windows) {
  writeFileSync(runtime, await brandWindowsRuntime(readFileSync(process.execPath)));
} else {
  copyFileSync(process.execPath, runtime);
  chmodSync(runtime, 0o755);
}
const nodeLicence = [path.dirname(process.execPath), path.dirname(path.dirname(process.execPath))]
  .map((dir) => path.join(dir, 'LICENSE'))
  .find((file) => existsSync(file));
if (!nodeLicence) throw new Error(`No LICENSE beside the Node runtime ${process.execPath}.`);

// 6. Licences and notices: AGPL-3.0, the credits, and every third-party component in the package.
copyFileSync(at('LICENSE'), path.join(stage, 'LICENSE'));
copyFileSync(at('CREDITS.md'), path.join(stage, 'CREDITS.md'));
writeFileSync(path.join(stage, 'THIRD_PARTY_NOTICES.txt'), notices());

// 7. The launchers and the README.
const source = sourceInfo();
writeLaunchers();
writeFileSync(path.join(stage, 'README.txt'), readme(source));

// 8. The zip and its checksum.
const zipName = `Emberglass-${version}-${windows ? 'win' : target.platform}-${target.arch}.zip`;
const mtime = source.commit ? new Date(Number(git('show', '-s', '--format=%ct', 'HEAD')) * 1000) : new Date();
const entries = filesOf(stage).map((file) => {
  const relative = path.relative(out, file).split(path.sep).join('/');
  return { name: relative, data: readFileSync(file), mode: statSync(file).mode };
});
const zip = createZip(entries, mtime);
writeFileSync(path.join(out, zipName), zip);
writeFileSync(path.join(out, `${zipName}.sha256`), `${sha256(zip)}  ${zipName}\n`);
log(`${zipName}: ${(zip.length / 1024 / 1024).toFixed(1)} MiB, ${entries.length} files, sha256 ${sha256(zip)}`);
log(source.tag ? `built from tag ${source.tag}` : `built from commit ${source.commit ?? 'unknown'}, no tag`);

function filesOf(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? filesOf(full) : [full];
    });
}

async function brandWindowsRuntime(executable) {
  const ResEdit = await import('resedit');
  const { default: sharp } = await import('sharp');
  const svg = readFileSync(at('client', 'public', 'favicon.svg'));
  const images = [];
  for (const size of [16, 24, 32, 48, 64, 256]) {
    images.push({
      size,
      png: await sharp(svg, { density: 72 * (size / 32) * 4 })
        .resize(size, size)
        .png()
        .toBuffer(),
    });
  }
  const icon = ResEdit.Data.IconFile.from(createIco(images));
  // Node's Authenticode signature would no longer match the edited file; the package is unsigned (Q-109).
  const exe = ResEdit.NtExecutable.from(executable, { ignoreCert: true });
  const resources = ResEdit.NtExecutableResource.from(exe);
  const group = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries)[0];
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    group?.id ?? 1,
    group?.lang ?? 1033,
    icon.icons.map((item) => item.data),
  );
  const info =
    ResEdit.Resource.VersionInfo.fromEntries(resources.entries)[0] ?? ResEdit.Resource.VersionInfo.createEmpty();
  const numeric = version.split('-')[0];
  const languages = info.getAllLanguagesForStringValues();
  for (const language of languages.length > 0 ? languages : [{ lang: 1033, codepage: 1200 }]) {
    info.setStringValues(language, {
      CompanyName: 'Emberglass',
      FileDescription: 'Emberglass',
      ProductName: 'Emberglass',
      InternalName: 'emberglass',
      OriginalFilename: 'emberglass.exe',
      FileVersion: version,
      ProductVersion: version,
      LegalCopyright: 'Emberglass: AGPL-3.0. Node.js runtime: see THIRD_PARTY_NOTICES.txt.',
      Comments: `The Node.js ${process.versions.node} runtime, renamed for Emberglass.`,
    });
  }
  info.setFileVersion(numeric);
  info.setProductVersion(numeric);
  info.outputToResourceEntries(resources.entries);
  resources.outputResource(exe);
  return Buffer.from(exe.generate());
}

function notices() {
  // What the package carries: the server bundle's inputs, the client's production closure (Vite
  // bundles it whole into client/dist) and the native modules shipped in app/node_modules.
  const dirs = new Set();
  for (const input of Object.keys(bundle.metafile.inputs)) {
    const dir = packageDirOf(input);
    if (dir) dirs.add(path.resolve(root, dir));
  }
  for (const key of productionClosure(lock, ['client', 'shared'], target, installed, ownManifest))
    dirs.add(at(...key.split('/')));
  for (const key of nativeKeys) dirs.add(at(...key.split('/')));
  const components = [...dirs]
    .map((dir) => ({ dir, ...packageInfo(dir) }))
    // Ours, and type declarations, of which nothing reaches the package.
    .filter((component) => !component.name.startsWith('@emberglass/') && !component.name.startsWith('@types/'));
  const unique = new Map(components.map((component) => [`${component.name}@${component.version}`, component]));
  const sorted = [...unique.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const rule = '='.repeat(78);
  const sections = [
    'THIRD-PARTY NOTICES',
    '',
    `Emberglass ${version} is free software under the GNU Affero General Public License, version 3`,
    '(LICENSE). It carries the third-party components below, each under its own licence, whose text',
    'follows its name. Condition icons and rule text are credited in CREDITS.md.',
    '',
    'Components:',
    `  Node.js ${process.versions.node} (the runtime, emberglass${windows ? '.exe' : ''})`,
    ...sorted.map((component) => `  ${component.name} ${component.version} (${component.license})`),
    '',
    rule,
    `Node.js ${process.versions.node}`,
    'Source: https://github.com/nodejs/node',
    rule,
    readFileSync(nodeLicence, 'utf8').trim(),
    '',
  ];
  const missing = [];
  for (const component of sorted) {
    sections.push(rule, `${component.name} ${component.version}`, `Licence: ${component.license}`, rule);
    const files = licenceFiles(component.dir);
    for (const file of files) sections.push(readFileSync(file, 'utf8').trim(), '');
    // libvips and the libraries it is built with: in @img/sharp-libvips-* off Windows, inside the DLLs
    // of @img/sharp-win32-* on it. Neither ships their licence texts, so the list is vendored, for
    // the libvips version it belongs to, and the full texts are appended below.
    const libvips = libvipsVersion(component.dir);
    const listed = libvips !== null;
    if (listed) {
      // The file: the libvips version, a note for whoever updates it, then the list.
      const [first, , ...table] = readFileSync(
        at('scripts', 'package', 'licences', 'libvips-libraries.txt'),
        'utf8',
      ).split(/\n\n/);
      if (first !== `libvips ${libvips}`) {
        throw new Error(
          `${component.name} carries libvips ${libvips}, but scripts/package/licences/libvips-libraries.txt ` +
            `lists the libraries of ${first}: update it from that sharp-libvips release's README.`,
        );
      }
      sections.push(
        `This package contains libvips ${libvips} and the libraries below, each used under the licence`,
        'named. The texts of the LGPL-3.0, the GPL-3.0 it builds on and the MPL-2.0 are at the end of',
        'this file. Their sources: https://github.com/lovell/sharp-libvips/releases',
        '',
        table.join('\n\n').trim(),
        '',
      );
    }
    if (files.length === 0 && !listed) {
      missing.push(`${component.name}@${component.version}`);
      sections.push(`The package declares the licence ${component.license} and includes no licence file.`, '');
    }
  }
  if (missing.length > 0) log(`no licence file in: ${missing.join(', ')} (named with their declared licence)`);
  for (const [name, file] of [
    ['GNU Lesser General Public License, version 3', 'LGPL-3.0.txt'],
    ['GNU General Public License, version 3', 'GPL-3.0.txt'],
    ['Mozilla Public License, version 2.0', 'MPL-2.0.txt'],
  ]) {
    sections.push(rule, name, rule, readFileSync(at('scripts', 'package', 'licences', file), 'utf8').trim(), '');
  }
  return sections.join(windows ? '\r\n' : '\n').replaceAll(/\r?\n/g, windows ? '\r\n' : '\n');
}

/** The libvips version a sharp binary package records in its versions.json, if it does. */
function libvipsVersion(dir) {
  for (const file of [path.join(dir, 'versions.json'), path.join(dir, 'lib', 'versions.json')]) {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')).vips ?? null;
  }
  return null;
}

function writeLaunchers() {
  if (windows) {
    // %~dp0 is this folder, with its trailing backslash, wherever the package was unzipped or installed.
    // The window stays open while the server runs; on a failure it waits so that the DM can read why.
    writeFileSync(
      path.join(stage, 'Emberglass.cmd'),
      [
        '@echo off',
        'title Emberglass',
        '"%~dp0emberglass.exe" "%~dp0app\\launcher.mjs"',
        'if errorlevel 1 pause',
        '',
      ].join('\r\n'),
    );
    writeFileSync(
      path.join(stage, 'Reset PIN.cmd'),
      [
        '@echo off',
        'title Emberglass: reset the DM PIN',
        '"%~dp0emberglass.exe" "%~dp0app\\reset-pin.mjs"',
        'pause',
        '',
      ].join('\r\n'),
    );
    return;
  }
  // `${0%/*}` rather than dirname: the launcher must not need anything on PATH.
  for (const [file, entry] of [
    ['emberglass.sh', 'launcher.mjs'],
    ['reset-pin.sh', 'reset-pin.mjs'],
  ]) {
    writeFileSync(path.join(stage, file), `#!/bin/sh\nhere="\${0%/*}"\nexec "$here/emberglass" "$here/app/${entry}"\n`);
    chmodSync(path.join(stage, file), 0o755);
  }
}

function readme({ commit, tag, changed }) {
  const start = windows ? 'Emberglass.cmd' : 'emberglass.sh';
  const reset = windows ? 'Reset PIN.cmd' : 'reset-pin.sh';
  const built = tag
    ? `Built from the tag ${tag} (commit ${commit}) of ${repository}`
    : `Built from the commit ${commit ?? 'unknown'} of ${repository}, with no tag: not a release.`;
  const lines = [
    `Emberglass ${version}`,
    '',
    'A free, self-hosted virtual tabletop for in-person play, compatible with 5th edition (SRD 5.1).',
    'The server runs on this PC; the TV opens the player view in its browser over the home Wi-Fi.',
    '',
    'START',
    `  Double-click ${start}. It opens the DM view, http://localhost:3000/dm, in your browser, and`,
    '  starts the server first if it is not running yet. Keep its window open while you play:',
    '  closing it stops the server. The window shows the address and QR code for the TV. If the',
    '  TV cannot open it, choose the TV address in Settings in the DM view.',
    '',
    '  First run: choose the DM PIN in the browser that opens, on this PC. Setup is refused from',
    '  any other device.',
    '',
    'FIREWALL',
    '  The first time, Windows Defender Firewall asks whether Emberglass may communicate on',
    '  networks. Allow it on private networks only. Your home Wi-Fi must be a private network in',
    "  Windows' network settings: on a network Windows classes as Public the TV cannot reach it.",
    '',
    'YOUR DATA',
    '  Campaigns, images and logs are in %APPDATA%\\Emberglass, not in this folder. To back up,',
    '  stop the server and copy that folder. Deleting this folder does not delete your data.',
    '  EMBERGLASS_DATA_DIR and EMBERGLASS_PORT change the folder and the port (3000).',
    '',
    'FORGOTTEN PIN',
    `  Double-click ${reset}, then choose a new PIN at http://localhost:3000/dm in a browser on this PC.`,
    '',
    'UPDATING',
    '  Emberglass never checks for updates. To update, stop the server, unzip the newer package',
    '  into a new folder and start it from there; it upgrades your data on its first start, after',
    '  a dated backup copy of the database in the data folder.',
    '',
    'NETWORK',
    '  Plain HTTP on your home network: anyone who can watch your Wi-Fi could read the PIN. Do not',
    '  run it on a public or shared network. Nothing is sent outside your network.',
    '',
    'LICENCE AND SOURCE',
    '  Emberglass is free software under the GNU Affero General Public License, version 3 (LICENSE).',
    `  ${built}`,
    `  The source is at ${repository}${tag ? `/tree/${tag}` : ''}.`,
    ...(changed ? ['  This build had local changes beyond that commit.'] : []),
    '  Third-party components and their licences: THIRD_PARTY_NOTICES.txt. Credits: CREDITS.md.',
    '  Emberglass is not affiliated with or endorsed by Wizards of the Coast.',
    '',
  ];
  return lines.join(windows ? '\r\n' : '\n');
}
