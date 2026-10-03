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
  const author = typeof manifest.author === 'string' ? manifest.author : (manifest.author?.name ?? null);
  return { name: manifest.name, version: manifest.version, license, author };
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

/**
 * The installer's identity: Windows recognises an installed Emberglass by it, so a newer installer
 * upgrades it in place. Never change it, or every install made before stays beside the new one.
 */
export const INSTALLER_APP_ID = '2ADC5081-636A-4E62-B504-5FBEC0D6EFD8';
/** The version label of the older installer the CI upgrade check installs first (D-175). */
export const UPGRADE_FROM_VERSION = '0.9.0';

/** The inbound firewall rules the installer adds and the uninstaller removes (specs/09-operations.md §4, D-174). */
export const FIREWALL_RULE = 'Emberglass';
export const FIREWALL_BLOCK_RULE = 'Emberglass (blocked on public networks)';

/** The installer's first page: what it does, where the data is, the licence in a line (review U-M2). */
export function installerInfo(version) {
  return [
    `Emberglass ${version}`,
    '',
    'This installs Emberglass for every user of this PC, in Program Files.',
    '',
    '- It adds an Emberglass folder to the Start Menu.',
    '- It allows Emberglass through Windows Defender Firewall on private networks only, and blocks it',
    '  on public ones. Your home Wi-Fi must be a private network in Windows settings.',
    '- Your campaigns, images and settings live in %APPDATA%\\Emberglass for each user. Updating or',
    '  uninstalling never deletes them.',
    '- The first time you start it, the DM view opens in your browser on this PC to choose the DM PIN.',
    '',
    'Emberglass is free software under the GNU Affero General Public License, version 3. The full text',
    'is LICENSE in the program folder; the components it carries are in THIRD_PARTY_NOTICES.txt.',
    '',
  ].join('\r\n');
}

/**
 * The Inno Setup script of the Windows installer (PKG-02, specs/09-operations.md §4, §5, Q-108, D-172,
 * D-174, D-175): the PKG-01 folder installed for every user under Program Files, always there, with one
 * administrator prompt; a Start Menu folder with Emberglass, the PIN reset and the uninstaller, and a
 * desktop shortcut on request; two inbound rules for emberglass.exe, TCP allowed on the private profile
 * and everything blocked on the public and domain ones, removed before they are added again on an upgrade
 * and removed on uninstall; a running Emberglass from this folder stopped before an upgrade replaces its
 * files or an uninstall removes them; the app folder replaced whole on an upgrade; and nothing done to the
 * data directory, which lives in each user's %APPDATA% and which no line here names.
 *
 * @param {{ version: string, stage: string, outDir: string, outName: string, icon: string, info: string }} options
 */
export function innoScript({ version, stage, outDir, outName, icon, info }) {
  const numeric = /^\d+\.\d+\.\d+/.exec(version)?.[0];
  if (!numeric) throw new Error(`the version ${version} does not start with major.minor.patch`);
  // Inno Setup doubles a quote inside a quoted parameter.
  const quoted = (args) => `"${args.replaceAll('"', '""')}"`;
  const program = 'program="{app}\\emberglass.exe"';
  const allow = `name="${FIREWALL_RULE}" ${program}`;
  const block = `name="${FIREWALL_BLOCK_RULE}" ${program}`;
  const netsh = (args, message) =>
    `Filename: "{sys}\\netsh.exe"; Parameters: ${quoted(`advfirewall firewall ${args}`)}; Flags: runhidden` +
    (message ? `; StatusMsg: "${message}"` : '');
  // Only the Emberglass this folder holds: one started from a zip elsewhere is left alone.
  const stopRunning = quoted(
    // No braces: Inno Setup reads { as the start of one of its constants.
    '-NoProfile -NonInteractive -Command "Get-Process -Name emberglass -ErrorAction SilentlyContinue | Where-Object Path -eq \'{app}\\emberglass.exe\' | Stop-Process -Force"',
  );
  return [
    '; Generated by scripts/package/build.mjs (PKG-02, D-172, D-175); do not edit.',
    '[Setup]',
    `AppId={{${INSTALLER_APP_ID}}`,
    'AppName=Emberglass',
    `AppVersion=${version}`,
    `AppVerName=Emberglass ${version}`,
    'AppPublisher=Emberglass',
    `VersionInfoVersion=${numeric}.0`,
    'VersionInfoDescription=Emberglass installer',
    'DefaultDirName={autopf}\\Emberglass',
    // Always Program Files: a folder chosen elsewhere (D:\Games, C:\Emberglass) can inherit permissions that
    // let any user of the PC replace the program the firewall rule and the Start Menu trust (review S-H1).
    'DisableDirPage=yes',
    'UsePreviousAppDir=no',
    'DefaultGroupName=Emberglass',
    'DisableProgramGroupPage=yes',
    // Every user, one administrator prompt (Q-108).
    'PrivilegesRequired=admin',
    // Windows x64 only (specs/09-operations.md §3): not Windows on Arm under emulation.
    'ArchitecturesAllowed=x64os',
    'ArchitecturesInstallIn64BitMode=x64os',
    // An upgrade closes a running Emberglass, forcing it if it does not close by itself; [Code] stops the
    // one from this folder first in any case.
    'CloseApplications=force',
    'RestartApplications=no',
    'SetupIconFile=' + icon,
    'UninstallDisplayIcon={app}\\emberglass.exe',
    'UninstallDisplayName=Emberglass',
    // What the installer does, the data and the licence in a line: never asked to accept (the AGPL asks no
    // acceptance of whoever runs the program).
    `InfoBeforeFile=${info}`,
    `OutputDir=${outDir}`,
    `OutputBaseFilename=${outName}`,
    'Compression=lzma2/max',
    'SolidCompression=yes',
    'WizardStyle=modern',
    '',
    '[Languages]',
    'Name: "english"; MessagesFile: "compiler:Default.isl"',
    '',
    '[Messages]',
    // The data is kept, and the DM is told where it is (review U-M3, specs/09-operations.md §5).
    'ConfirmUninstall=Remove Emberglass from this PC? Your campaigns, images and settings in %APPDATA%\\Emberglass are kept. Delete that folder yourself if you want them gone.',
    'UninstalledAll=Emberglass was removed from this PC. Your campaigns, images and settings are still in %APPDATA%\\Emberglass.',
    '',
    '[Tasks]',
    'Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked',
    '',
    '[InstallDelete]',
    // An upgrade leaves nothing of the older app behind: its client build has other file names. The folder
    // is always {autopf}\Emberglass, Emberglass's own.
    'Type: filesandordirs; Name: "{app}\\app"',
    '',
    '[Files]',
    `Source: "${stage}\\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion`,
    '',
    '[Icons]',
    'Name: "{group}\\Emberglass"; Filename: "{app}\\Emberglass.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\\emberglass.exe"; Comment: "Start Emberglass and open the DM view"',
    'Name: "{group}\\Reset the Emberglass PIN"; Filename: "{app}\\Reset PIN.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\\emberglass.exe"',
    'Name: "{group}\\Uninstall Emberglass"; Filename: "{uninstallexe}"',
    'Name: "{autodesktop}\\Emberglass"; Filename: "{app}\\Emberglass.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\\emberglass.exe"; Tasks: desktopicon',
    '',
    '[Run]',
    // Private networks only (specs/09-operations.md §4, Q-076, Q-108, D-174): older rules go first, so an
    // upgrade leaves exactly these two; TCP is all Emberglass serves.
    netsh(`delete rule ${allow}`),
    netsh(`delete rule ${block}`),
    netsh(
      `add rule ${allow} dir=in action=allow protocol=TCP profile=private enable=yes description="Emberglass on private networks: the TV and the DM view"`,
      'Allowing Emberglass on private networks...',
    ),
    netsh(
      `add rule ${block} dir=in action=block profile=public,domain enable=yes description="Emberglass is not served on public networks"`,
      'Blocking Emberglass on public networks...',
    ),
    // As the DM, not as the administrator: the data directory and PIN setup are the DM's own.
    'Filename: "{app}\\Emberglass.cmd"; WorkingDir: "{app}"; Description: "Start Emberglass"; Flags: postinstall nowait skipifsilent runasoriginaluser shellexec',
    '',
    '[UninstallRun]',
    // A running Emberglass from this folder stops first, so its files can go (review C-M1).
    `Filename: "{sys}\\WindowsPowerShell\\v1.0\\powershell.exe"; Parameters: ${stopRunning}; Flags: runhidden; RunOnceId: "EmberglassStop"`,
    `${netsh(`delete rule ${allow}`)}; RunOnceId: "EmberglassFirewall"`,
    `${netsh(`delete rule ${block}`)}; RunOnceId: "EmberglassFirewallBlock"`,
    '',
    '[Code]',
    '// Before files are replaced: a running Emberglass from this folder is stopped, whatever Restart Manager',
    '// could close (review C-M1). Its database is safe: SQLite commits or rolls back whole.',
    'function PrepareToInstall(var NeedsRestart: Boolean): String;',
    'var',
    '  ResultCode: Integer;',
    'begin',
    `  Exec(ExpandConstant('{sys}\\WindowsPowerShell\\v1.0\\powershell.exe'), ExpandConstant('${stopRunning.slice(1, -1).replaceAll('""', '"').replaceAll("'", "''")}'), '', SW_HIDE, ewWaitUntilTerminated, ResultCode);`,
    "  Result := '';",
    'end;',
    '',
  ].join('\r\n');
}

// The package gates' verdicts (PKG-03, `make package-gates`, D-176, D-177): what `gates.mjs` requires of the Vitest
// and Playwright JSON reports, kept here so that each way a gate can be missed is tested (scripts/package/lib.test.mjs).

/** The `@gate:` tests of specs/10-testing-acceptance.md §3 that must each run and pass against the package. */
export const HIDDEN_INFORMATION_GATES = ['hidden-information', 'player-command-rejection', 'image-revocation'];

/** The journey specs of e2e/tests/journeys/, read from disk so that a journey added later is required too. */
export function journeySpecs(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.spec.ts'))
    .sort();
}

/** The browsers of a run: Chromium always, then those EMBERGLASS_E2E_BROWSERS names (e2e/playwright.config.ts). */
export function browsersOf(list) {
  return [
    ...new Set([
      'chromium',
      ...(list ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean),
    ]),
  ];
}

/**
 * One verdict per hidden-information gate from a Vitest JSON report (null when none was written): exactly one test
 * of that marker, passed. `sources` are the texts of the files the gates live in: an inverted test (`it.fails`)
 * reports `passed` when its body fails, so a file that has one judges nothing.
 * @returns {{ ok: boolean, message: string }[]}
 */
export function vitestVerdicts(report, sources = []) {
  const results = (report?.testResults ?? []).flatMap((file) => file.assertionResults ?? []);
  const inverted = sources.some((text) => /\.fails\s*\(/.test(text));
  return HIDDEN_INFORMATION_GATES.map((id) => {
    const found = results.filter((test) => test.title.startsWith(`@gate:${id} `));
    return {
      ok: !inverted && found.length === 1 && found[0].status === 'passed',
      message: `@gate:${id} ran against the package and passed (${
        inverted ? 'an inverted test in its file' : found.map((test) => test.status).join(', ') || 'not run'
      })`,
    };
  });
}

/** Every test of a Playwright JSON report, with its file, project, outcome and the outcome it was meant to have. */
export function playwrightTests(report) {
  const walk = (suite, file) => [
    ...(suite.specs ?? []).flatMap((spec) =>
      spec.tests.map((test) => ({
        file: (spec.file ?? file ?? '').replaceAll('\\', '/'),
        title: spec.title,
        project: test.projectName,
        status: test.status,
        expectedStatus: test.expectedStatus,
      })),
    ),
    ...(suite.suites ?? []).flatMap((child) => walk(child, child.file ?? file)),
  ];
  return (report?.suites ?? []).flatMap((suite) => walk(suite, suite.file));
}

/**
 * One verdict per journey per browser, then one for the run's offline gate, from a Playwright JSON report (null when
 * none was written). A journey passes in a browser when it ran there and every test of it passed as a passing test
 * (`expectedStatus` 'passed': a `test.fail()` that fails is 'expected' too). The offline gate is the `offline`
 * project's; each browser's probe carries the same marker and is a journey.
 * @returns {{ ok: boolean, message: string }[]}
 */
export function playwrightVerdicts(report, journeys, browsers) {
  const tests = playwrightTests(report);
  const passed = (test) => test.status === 'expected' && test.expectedStatus === 'passed';
  const verdicts = [];
  for (const browser of browsers) {
    for (const journey of journeys) {
      const found = tests.filter((test) => test.project === browser && test.file.endsWith(`journeys/${journey}`));
      verdicts.push({
        ok: found.length > 0 && found.every(passed),
        message: `${journey} ran in ${browser} against the package and passed (${
          found.map((test) => test.status).join(', ') || 'not run'
        })`,
      });
    }
  }
  const offline = tests.filter((test) => test.project === 'offline' && test.title.startsWith('@gate:offline-e2e '));
  verdicts.push({
    ok: offline.length === 1 && passed(offline[0]),
    message: `@gate:offline-e2e ran after them and passed (${offline.map((test) => test.status).join(', ') || 'not run'})`,
  });
  return verdicts;
}

/**
 * Whether the hidden-information gates ran against the package: one line per server the test harness started in
 * package mode (server/src/ws/testing/harness.ts), each naming the package's folder. The recorded-traffic gate
 * starts two servers and each of the other two gates one, so fewer than four means some gate ran elsewhere.
 * @returns {{ ok: boolean, message: string }}
 */
export function packagedServersVerdict(lines, folder) {
  const servers = lines.filter((line) => line.trim() !== '').map((line) => JSON.parse(line));
  const ours = servers.filter((server) => server.folder === folder);
  return {
    ok: ours.length >= 4 && ours.length === servers.length,
    message: `every hidden-information server was the package in ${folder} (${ours.length} of ${servers.length}, at least 4 needed)`,
  };
}
