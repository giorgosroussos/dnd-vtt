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
// On Windows the same folder is also wrapped by Inno Setup in Emberglass-<version>-win-x64-setup.exe,
// beside its .sha256 (PKG-02, D-172): installed for every user, with Start Menu shortcuts and a firewall
// rule for private networks only.
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
  innoScript,
  installerInfo,
  UPGRADE_FROM_VERSION,
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

// 9. The installer, on Windows (PKG-02, specs/09-operations.md §4, §5, Q-108, D-172): Inno Setup over the
// staged folder, beside the zip with its own checksum. Inno Setup is on the Windows runner's image; a
// Windows machine without it is told where to get it.
if (windows) {
  const iscc = [
    process.env.ISCC,
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  ].find((file) => file && existsSync(file));
  if (!iscc)
    throw new Error('Inno Setup 6 is not installed (https://jrsoftware.org/isdl.php); set ISCC to its ISCC.exe.');
  const work = path.join(out, 'installer');
  mkdirSync(work, { recursive: true });
  const icon = path.join(work, 'emberglass.ico');
  writeFileSync(icon, await emberglassIco());
  /** Compiles the installer for `label` into `dir`, beside its .sha256; answers its file name. */
  const compile = (label, dir) => {
    mkdirSync(dir, { recursive: true });
    const name = `Emberglass-${label}-win-x64-setup`;
    const info = path.join(work, `info-${label}.txt`);
    writeFileSync(info, installerInfo(label));
    const script = path.join(work, `emberglass-${label}.iss`);
    writeFileSync(script, innoScript({ version: label, stage, outDir: dir, outName: name, icon, info }));
    const compiled = spawnSync(iscc, ['/Q', script], { stdio: 'inherit' });
    if (compiled.status !== 0) throw new Error(`Inno Setup failed (exit ${compiled.status}).`);
    const setup = readFileSync(path.join(dir, `${name}.exe`));
    writeFileSync(path.join(dir, `${name}.exe.sha256`), `${sha256(setup)}  ${name}.exe\n`);
    log(`${name}.exe: ${(setup.length / 1024 / 1024).toFixed(1)} MiB, sha256 ${sha256(setup)}`);
    return name;
  };
  compile(version, out);
  // Where the installer checks run (the CI runner), an older-labelled installer of the same folder, for a real
  // upgrade from an older version to this one (review T-M5), in a folder of its own that no upload names.
  if (process.env.EMBERGLASS_PACKAGE_SYSTEM_TESTS === '1')
    compile(UPGRADE_FROM_VERSION, path.join(out, 'upgrade-test'));
  rmSync(work, { recursive: true, force: true });
}

function filesOf(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? filesOf(full) : [full];
    });
}

/** Emberglass's icon as an ICO, from the favicon: the runtime's icon and the installer's. */
async function emberglassIco() {
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
  return createIco(images);
}

async function brandWindowsRuntime(executable) {
  const ResEdit = await import('resedit');
  const icon = ResEdit.Data.IconFile.from(await emberglassIco());
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
  // Vite is a devDependency, but its preload and dependency-map helpers are inside client/dist's entry.
  dirs.add(at('node_modules', 'vite'));
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
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      // Vite's licence file goes on with the licences of its own bundled dependencies, which reach the
      // package only through Vite's build, not as code; its own MIT licence comes first.
      const own = component.name === 'vite' ? (text.split(/^# Licenses of bundled dependencies/m)[0] ?? text) : text;
      sections.push(own.trim(), '');
    }
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
      if (component.license === 'MIT') {
        // The MIT licence asks for its notice with the copyright: the package's author stands for it.
        sections.push(
          `The package declares the MIT licence and includes no licence file; its text, with the author the`,
          'package names:',
          '',
          mitLicence(component.author ?? `the authors of ${component.name}`),
          '',
        );
      } else {
        sections.push(`The package declares the licence ${component.license} and includes no licence file.`, '');
      }
    }
  }
  if (missing.length > 0)
    log(`no licence file in: ${missing.join(', ')} (given their declared licence; MIT with the author as its holder)`);
  for (const [name, file] of [
    ['GNU Lesser General Public License, version 3', 'LGPL-3.0.txt'],
    ['GNU General Public License, version 3', 'GPL-3.0.txt'],
    ['Mozilla Public License, version 2.0', 'MPL-2.0.txt'],
  ]) {
    sections.push(rule, name, rule, readFileSync(at('scripts', 'package', 'licences', file), 'utf8').trim(), '');
  }
  return sections.join(windows ? '\r\n' : '\n').replaceAll(/\r?\n/g, windows ? '\r\n' : '\n');
}

/** The MIT licence's text, for a package that declares it but carries no licence file. */
function mitLicence(holder) {
  return [
    'MIT License',
    '',
    `Copyright (c) ${holder}`,
    '',
    'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and',
    'associated documentation files (the "Software"), to deal in the Software without restriction,',
    'including without limitation the rights to use, copy, modify, merge, publish, distribute,',
    'sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is',
    'furnished to do so, subject to the following conditions:',
    '',
    'The above copyright notice and this permission notice shall be included in all copies or',
    'substantial portions of the Software.',
    '',
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT',
    'NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND',
    'NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,',
    'DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT',
    'OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
  ].join('\n');
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
        // A path with `!` stays whole even where cmd expands variables late by default (review S-L4).
        'setlocal DisableDelayedExpansion',
        'title Emberglass',
        '"%~dp0emberglass.exe" "%~dp0app\\launcher.mjs"',
        // On a failure, or a DM view no browser opened, wait so the DM can read why; the code goes on.
        'set code=%errorlevel%',
        'if not "%code%"=="0" pause',
        'exit /b %code%',
        '',
      ].join('\r\n'),
    );
    writeFileSync(
      path.join(stage, 'Reset PIN.cmd'),
      [
        '@echo off',
        // A path with `!` stays whole even where cmd expands variables late by default (review S-L4).
        'setlocal DisableDelayedExpansion',
        'title Emberglass: reset the DM PIN',
        '"%~dp0emberglass.exe" "%~dp0app\\reset-pin.mjs"',
        'set code=%errorlevel%',
        'pause',
        'exit /b %code%',
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
  // One text for the installed program (Program Files, Start Menu) and for the zip (review U-M7).
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
    `  Installed: Emberglass in the Start Menu. From the zip: double-click ${start} in its folder.`,
    '  It opens the DM view, http://127.0.0.1:3000/dm (or the port you set), in your browser, and',
    '  starts the server first if it is not running yet. Keep its window open while you play:',
    '  closing it stops the server. The window shows the address and QR code for the TV. If the',
    '  TV cannot open it, check first that Windows calls your Wi-Fi a private network (FIREWALL',
    '  below), then choose the TV address in Settings in the DM view.',
    '',
    '  First run: choose the DM PIN in the browser that opens, on this PC. Setup is refused from',
    '  any other device.',
    '',
    '  The installer and the zip are not signed. When Windows shows "Windows protected your PC",',
    '  choose More info, then Run anyway, once the file matches its .sha256 from the release.',
    '',
    'FIREWALL',
    '  Installed: Emberglass is allowed on private networks only and blocked on public ones, so',
    '  Windows does not ask. From the zip: Windows Defender Firewall asks the first time whether',
    '  Emberglass may communicate on networks; allow it on private networks only. Either way your',
    "  home Wi-Fi must be a private network in Windows' settings (Settings, Network & internet,",
    '  Wi-Fi, your network, Network profile type: Private): on a Public one the TV cannot reach it.',
    '',
    'YOUR DATA',
    '  Campaigns, images and logs are in %APPDATA%\\Emberglass, not in this folder. To back up,',
    '  stop the server and copy that folder. EMBERGLASS_DATA_DIR and EMBERGLASS_PORT change the',
    '  folder and the port (3000).',
    '',
    'FORGOTTEN PIN',
    `  Installed: Reset the Emberglass PIN in the Start Menu. From the zip: double-click ${reset}.`,
    '  Then choose a new PIN at http://127.0.0.1:3000/dm (or the port you set) on this PC.',
    '',
    'UPDATING AND UNINSTALLING',
    '  Emberglass never checks for updates. Installed: finish your session, then run the newer',
    '  installer, which upgrades in place; uninstall it from the Start Menu or Settings, Apps. From',
    '  the zip: stop the server, unzip the newer package into a new folder and start it there;',
    '  delete the old folder when you like. The first start upgrades your data, after a dated',
    '  backup copy of the database. Neither uninstalling nor deleting the folder deletes your data.',
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
