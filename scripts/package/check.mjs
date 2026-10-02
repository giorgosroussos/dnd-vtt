// `make package`, second half: the acceptance check of the package just built (PKG-01, D-164, D-166).
//
//   node scripts/package/check.mjs [--port N]      reads dist/package/*.zip
//
// What a DM does with the zip, on this machine: its checksum is checked; it is unzipped into a new
// folder whose name has spaces, brackets, `&` and non-ASCII letters (on Windows with Expand-Archive,
// .NET's zip reader; Explorer's own is not scriptable); the launcher is run
// with nothing but the system folders on PATH, so no Node can be found (checked), and with an empty
// EMBERGLASS_DATA_DIR. It must start the server, which must create its data there and answer
// `make smoke`'s checks (scripts/smoke.mjs); a second launch must find it running, open the DM view
// and exit, starting no second server; the PIN must be set from loopback, an image must go through
// sharp and the live WebSocket must open; the PIN reset must clear the PIN; a restart must use the TV
// address stored in Settings; two launches at once must start one server; a port another program holds
// must fail with advice. On Windows the runtime must carry Emberglass's name, and the installer is checked:
// its checksum always, and where EMBERGLASS_PACKAGE_SYSTEM_TESTS=1 (the CI runner) an install, an upgrade
// over data of an older schema and an uninstall (PKG-02). Every process it starts is stopped at the end.
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { connect, createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTALLER_APP_ID, sha256 } from './lib.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.join(root, 'dist', 'package');
const windows = process.platform === 'win32';
const failures = [];
const children = [];

function log(line) {
  console.log(`package-check: ${line}`);
}

function expect(condition, message) {
  if (condition) log(`ok   ${message}`);
  else {
    failures.push(message);
    log(`FAIL ${message}`);
  }
  return condition;
}

async function freePort() {
  const portArg = process.argv.indexOf('--port');
  if (portArg >= 0) return Number(process.argv[portArg + 1]);
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
      server.close(() => resolve(port));
    });
  });
}

/** A process of the package, its output collected, stoppable with everything it started. */
function run(command, args, env, { verbatim = false } = {}) {
  const child = spawn(command, args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !windows,
    windowsHide: true,
    windowsVerbatimArguments: verbatim,
  });
  const record = { child, output: '', exit: /** @type {Promise<number | null>} */ (new Promise(() => {})) };
  child.stdout.on('data', (chunk) => (record.output += chunk));
  child.stderr.on('data', (chunk) => (record.output += chunk));
  record.exit = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  children.push(record);
  return record;
}

function stop(record) {
  if (record.child.exitCode !== null || record.child.pid === undefined) return;
  if (windows) spawnSync('taskkill', ['/pid', String(record.child.pid), '/t', '/f'], { stdio: 'ignore' });
  else {
    try {
      process.kill(-record.child.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}

async function within(ms, promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve) => (timer = setTimeout(() => resolve('timeout'), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves true once `test` holds, polling every 100 ms, false after `ms`; leaves no timer behind. */
async function waitFor(test, ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await test()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Whether anything at all accepts a TCP connection on the port, Emberglass or not. */
function portTaken(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function answersAuth(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth`, { signal: AbortSignal.timeout(2000) });
    return response.status === 200 && (await response.text()) === '{"dm":false}';
  } catch {
    return false;
  }
}

function extract(zip, into) {
  if (windows) {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${zip.replaceAll("'", "''")}' -DestinationPath '${into.replaceAll("'", "''")}'`,
      ],
      { stdio: 'inherit' },
    );
    if (result.status !== 0) throw new Error('Expand-Archive failed');
    return;
  }
  const result = spawnSync('python3', ['-m', 'zipfile', '-e', zip, into], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('unzipping with python3 failed');
  // Python's zipfile drops the Unix modes the zip records; a DM's unzip keeps them.
  for (const file of ['emberglass', 'emberglass.sh', 'reset-pin.sh'])
    chmodSync(path.join(into, 'Emberglass', file), 0o755);
}

/** The environment of a DM's machine with no Node: the system folders only on PATH. */
function cleanEnv(dataDir, port, home) {
  if (windows) {
    const system = process.env.SystemRoot ?? 'C:\\Windows';
    const keep = [
      'SystemRoot',
      'SystemDrive',
      'windir',
      'ComSpec',
      'TEMP',
      'TMP',
      'USERPROFILE',
      'APPDATA',
      'LOCALAPPDATA',
      'PATHEXT',
      'NUMBER_OF_PROCESSORS',
      'PROCESSOR_ARCHITECTURE',
    ];
    const env = Object.fromEntries(keep.filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
    return {
      ...env,
      PATH: [path.join(system, 'System32'), system, path.join(system, 'System32', 'WindowsPowerShell', 'v1.0')].join(
        ';',
      ),
      EMBERGLASS_DATA_DIR: dataDir,
      EMBERGLASS_PORT: String(port),
    };
  }
  return { HOME: home, PATH: path.join(home, 'bin'), EMBERGLASS_DATA_DIR: dataDir, EMBERGLASS_PORT: String(port) };
}

function nodeOnPath(env) {
  const names = windows ? ['node.exe', 'node.cmd', 'node'] : ['node'];
  return env.PATH.split(path.delimiter).some((dir) => names.some((name) => existsSync(path.join(dir, name))));
}

/**
 * Installs, upgrades and uninstalls the installer on this machine, which must be a throwaway one (the CI
 * runner): the acceptance of PKG-02 (specs/09-operations.md §4, §5, D-172, D-174, D-175). An older-labelled
 * installer of the same folder first, then the DM's data as an older schema left it, then this installer over
 * it while Emberglass runs, a start that migrates after its backup, and an uninstall while it runs again.
 */
async function installerChecks(setup, older, cleanEnvironment) {
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  const app = path.join(programFiles, 'Emberglass');
  const exe = path.join(app, 'emberglass.exe');
  const data = path.join(process.env.APPDATA ?? '', 'Emberglass');
  const startMenu = path.join(
    process.env.ProgramData ?? 'C:\\ProgramData',
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Emberglass',
  );
  const desktop = path.join(process.env.PUBLIC ?? 'C:\\Users\\Public', 'Desktop', 'Emberglass.lnk');
  if (existsSync(data) || existsSync(app)) {
    expect(
      false,
      `the installer checks refuse to run where ${data} or ${app} already exists: they would touch a real install`,
    );
    return;
  }
  const logs = mkdtempSync(path.join(os.tmpdir(), 'emberglass-setup-'));
  // Each query has its own limit: one that hangs fails the check by name instead of the whole job.
  const powershell = (command, what = 'a PowerShell query') => {
    const started = Date.now();
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; ${command}`],
      { encoding: 'utf8', timeout: 90_000 },
    );
    if (result.error || result.status === null) {
      expect(
        false,
        `${what} answers within 90 s (${result.error?.message ?? 'killed'}, after ${Date.now() - started} ms)`,
      );
    }
    return result;
  };
  const install = (file, name, extra = []) => {
    const logFile = path.join(logs, `${name}.log`);
    const result = spawnSync(
      file,
      ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', `/LOG=${logFile}`, ...extra],
      {
        timeout: 180_000,
      },
    );
    if (result.status !== 0 && existsSync(logFile)) console.log(readFileSync(logFile, 'utf8'));
    return result.status;
  };
  const printLog = (name) => {
    const logFile = path.join(logs, `${name}.log`);
    if (existsSync(logFile)) {
      console.log(
        readFileSync(logFile, 'utf8')
          .split('\n')
          .filter((line) => /netsh|powershell|exit code|firewall|PrepareToInstall|close/i.test(line))
          .join('\n'),
      );
    }
  };
  // Every inbound rule that names this emberglass.exe, whatever it is called (a prompt's Allow would add one
  // under another name), as Windows PowerShell 5.1 can list them. A query that fails is a failure.
  const rules = () => {
    const shown = powershell(
      `$found = @(Get-NetFirewallApplicationFilter -Program '${exe.replaceAll("'", "''")}' | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' } | ForEach-Object { [pscustomobject]@{ name = $_.DisplayName; action = $_.Action.ToString(); profile = $_.Profile.ToString(); enabled = $_.Enabled.ToString(); protocol = ($_ | Get-NetFirewallPortFilter).Protocol } }); ConvertTo-Json -Compress -InputObject $found`,
    );
    if (shown.status !== 0) {
      expect(false, `the firewall rules can be read (powershell exit ${shown.status}: ${shown.stderr.trim()})`);
      return null;
    }
    const text = shown.stdout.trim();
    const parsed = text === '' ? [] : JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  };
  const twoRules = (when) => {
    const found = (rules() ?? []).sort((a, b) => (a.action < b.action ? -1 : 1));
    return expect(
      found.length === 2 &&
        found[0].name === 'Emberglass' &&
        found[0].action === 'Allow' &&
        found[0].profile === 'Private' &&
        found[0].protocol === 'TCP' &&
        found[0].enabled === 'True' &&
        found[1].name === 'Emberglass (blocked on public networks)' &&
        found[1].action === 'Block' &&
        /^(?:Domain, Public|Public, Domain)$/.test(found[1].profile) &&
        found[1].enabled === 'True',
      `${when}: exactly two inbound rules for emberglass.exe, TCP allowed on private networks and all blocked on public and domain ones (${JSON.stringify(found)})`,
    );
  };
  // The installs Windows lists under Apps: exactly one Emberglass, at the expected version.
  const registered = () => {
    const shown = powershell(
      "$found = @(Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | Get-ItemProperty | Where-Object { $_.DisplayName -eq 'Emberglass' } | ForEach-Object { [pscustomobject]@{ key = $_.PSChildName; version = $_.DisplayVersion } }); ConvertTo-Json -Compress -InputObject $found",
    );
    if (shown.status !== 0) return null;
    const text = shown.stdout.trim();
    const parsed = text === '' ? [] : JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  };
  const oneInstall = (versionLabel, when) => {
    const found = registered();
    expect(
      found !== null &&
        found.length === 1 &&
        found[0].key === `{${INSTALLER_APP_ID}}_is1` &&
        found[0].version === versionLabel,
      `${when}: Windows lists exactly one Emberglass, version ${versionLabel} (${JSON.stringify(found)})`,
    );
  };
  const shortcutTarget = (link) =>
    powershell(
      `(New-Object -ComObject WScript.Shell).CreateShortcut('${link.replaceAll("'", "''")}').TargetPath`,
    ).stdout.trim();
  const port = await freePort();
  const runEnv = { ...cleanEnvironment, EMBERGLASS_PORT: String(port) };
  delete runEnv.EMBERGLASS_DATA_DIR;
  const startInstalled = () =>
    run(
      path.join(runEnv.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'),
      ['/d', '/s', '/c', `""${shortcutTarget(path.join(startMenu, 'Emberglass.lnk'))}""`],
      runEnv,
      { verbatim: true },
    );
  const serverProcesses = () =>
    Number(
      powershell(
        `@(Get-Process -Name emberglass -ErrorAction SilentlyContinue | Where-Object Path -eq '${exe}').Count`,
      ).stdout.trim(),
    );

  log('installer: installing the older-labelled version');
  // An older version first, for every user (Q-108).
  const olderLabel = path.basename(older).replace(/^Emberglass-(.+)-win-x64-setup\.exe$/, '$1');
  expect(install(older, 'older') === 0, `an older installer (${olderLabel}) installs silently`);
  expect(
    existsSync(exe) && existsSync(path.join(app, 'app', 'server.mjs')),
    `it installs into ${app}, the only folder it offers`,
  );
  for (const [link, target] of [
    ['Emberglass.lnk', path.join(app, 'Emberglass.cmd')],
    ['Reset the Emberglass PIN.lnk', path.join(app, 'Reset PIN.cmd')],
    ['Uninstall Emberglass.lnk', path.join(app, 'unins000.exe')],
  ]) {
    const found = existsSync(path.join(startMenu, link)) ? shortcutTarget(path.join(startMenu, link)) : '';
    expect(
      found.toLowerCase() === target.toLowerCase(),
      `the Start Menu has ${link.slice(0, -4)}, opening ${target} (got "${found}")`,
    );
  }
  expect(!existsSync(desktop), 'it adds no desktop shortcut unless asked');
  if (!twoRules('after installing')) printLog('older');
  oneInstall(olderLabel, 'after installing the older version');

  log('installer: writing a version 8 database');
  // The DM's data as an older Emberglass left it: schema version 8, a setting changed, and a file of the
  // older app's that the new one does not have.
  const { default: Database } = await import('better-sqlite3');
  mkdirSync(data, { recursive: true });
  const old = new Database(path.join(data, 'emberglass.db'));
  // As the migration runner applies them: foreign keys off, one transaction and version each.
  old.pragma('foreign_keys = OFF');
  const migrations = readdirSync(path.join(app, 'app', 'migrations'))
    .filter((file) => /^\d{4}_[a-z0-9][a-z0-9_-]*\.sql$/.test(file))
    .sort();
  for (const file of migrations) {
    const number = Number(file.slice(0, 4));
    if (number > 8) continue;
    old.exec('BEGIN');
    old.exec(readFileSync(path.join(app, 'app', 'migrations', file), 'utf8'));
    old.pragma(`user_version = ${number}`);
    old.exec('COMMIT');
  }
  old.prepare("UPDATE settings SET ruler_rule = 'dmg'").run();
  const settingsId = old.prepare('SELECT id FROM settings').pluck().get();
  old.close();
  const before = sha256(readFileSync(path.join(data, 'emberglass.db')));
  writeFileSync(path.join(app, 'app', 'left-by-an-older-version.txt'), 'old');

  log('installer: upgrading while the older version runs');
  // The newer installer over it, as an upgrade, while the older Emberglass runs, with the desktop shortcut
  // asked for this time (review C-M1, T-M5, T-M6).
  const running = startInstalled();
  await waitFor(async () => running.child.exitCode !== null || (await answersAuth(port)), 60_000);
  expect(await answersAuth(port), 'the older Emberglass runs before the upgrade');
  const exeBefore = sha256(readFileSync(exe));
  expect(
    install(setup, 'upgrade', ['/TASKS=desktopicon']) === 0,
    'the newer installer upgrades it in place, silently, while it runs',
  );
  await within(30_000, running.exit);
  expect(
    serverProcesses() === 0 && !(await portTaken(port)),
    'the upgrade stopped the running Emberglass, freeing its port',
  );
  expect(
    sha256(readFileSync(exe)) !== exeBefore,
    'the upgrade replaced emberglass.exe (its version information names the new version)',
  );
  oneInstall(path.basename(setup).replace(/^Emberglass-(.+)-win-x64-setup\.exe$/, '$1'), 'after upgrading');
  if (!twoRules('after upgrading')) printLog('upgrade');
  expect(
    !existsSync(path.join(app, 'app', 'left-by-an-older-version.txt')),
    "the upgrade leaves nothing of the older app's folder",
  );
  expect(sha256(readFileSync(path.join(data, 'emberglass.db'))) === before, 'the upgrade leaves the data untouched');
  expect(
    existsSync(desktop) && shortcutTarget(desktop).toLowerCase() === path.join(app, 'Emberglass.cmd').toLowerCase(),
    'the desktop shortcut is added when asked',
  );

  log('installer: starting the upgraded version');
  // The first start after the upgrade migrates the data, after a dated backup (specs/09-operations.md §2).
  const started = startInstalled();
  await waitFor(async () => started.child.exitCode !== null || (await answersAuth(port)), 60_000);
  expect(await answersAuth(port), 'the upgraded Emberglass starts from its Start Menu shortcut');
  const backups = readdirSync(data).filter((name) => /^emberglass-backup-.*-v8\.db$/.test(name));
  expect(backups.length === 1, `the migration's backup of the version 8 database appears (${backups.join(', ')})`);
  const migrated = new Database(path.join(data, 'emberglass.db'), { readonly: true });
  const kept = migrated.prepare('SELECT id, ruler_rule FROM settings').get();
  const schema = migrated.pragma('user_version', { simple: true });
  migrated.close();
  expect(
    kept?.id === settingsId && kept?.ruler_rule === 'dmg' && schema === migrations.length,
    `the upgraded install keeps the data and migrates it to version ${migrations.length} (got ${schema})`,
  );

  log('installer: uninstalling while it runs');
  // A silent uninstall while Emberglass runs: it stops, the program, its shortcuts and its rules go, and the
  // data stays (specs/09-operations.md §5).
  const uninstallLog = path.join(logs, 'uninstall.log');
  const uninstalled = spawnSync(
    path.join(app, 'unins000.exe'),
    ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/LOG=${uninstallLog}`],
    { timeout: 180_000 },
  );
  expect(uninstalled.status === 0, `the uninstaller starts and returns 0 (got ${uninstalled.status})`);
  // It runs a copy of itself from a temporary folder and returns at once: done once the folder is gone.
  await waitFor(() => !existsSync(app), 120_000);
  await within(30_000, started.exit);
  if (existsSync(uninstallLog) && existsSync(app)) console.log(readFileSync(uninstallLog, 'utf8'));
  expect(!existsSync(app), `the uninstaller removes the program folder, ${app}`);
  expect(serverProcesses() === 0 && !(await portTaken(port)), 'it stopped the running Emberglass first');
  expect(!existsSync(startMenu) && !existsSync(desktop), 'it removes the Start Menu folder and the desktop shortcut');
  const left = rules();
  expect(left !== null && left.length === 0, `it removes both firewall rules (${JSON.stringify(left)})`);
  const listed = registered();
  expect(listed !== null && listed.length === 0, `Windows no longer lists Emberglass (${JSON.stringify(listed)})`);
  expect(existsSync(path.join(data, 'emberglass.db')), `it leaves the data directory, ${data}`);
  rmSync(logs, { recursive: true, force: true });
}

const zips = existsSync(out) ? readdirSync(out).filter((name) => name.endsWith('.zip')) : [];
if (zips.length !== 1) {
  console.error(`package-check: expected one zip in ${out}, found ${zips.length}. Run node scripts/package/build.mjs.`);
  process.exit(1);
}
const zipName = /** @type {string} */ (zips[0]);
const zip = path.join(out, zipName);
const work = mkdtempSync(path.join(os.tmpdir(), 'emberglass-package-'));
const port = await freePort();

try {
  // The checksum the release publishes beside the zip.
  const sum = readFileSync(`${zip}.sha256`, 'utf8');
  expect(sum === `${sha256(readFileSync(zip))}  ${zipName}\n`, `${zipName}.sha256 is the zip's SHA-256`);

  // A folder named as a DM's may be: spaces, brackets, an ampersand and letters beyond ASCII (Greek in the
  // owner's case), which cmd's quoting and native modules' loading must survive (review T-M6).
  const folder = path.join(work, 'Emberglass (1) & Ünï Χάρτης');
  extract(zip, folder);
  const pkg = path.join(folder, 'Emberglass');
  const runtime = path.join(pkg, windows ? 'emberglass.exe' : 'emberglass');
  for (const file of [
    runtime,
    windows ? 'Emberglass.cmd' : 'emberglass.sh',
    windows ? 'Reset PIN.cmd' : 'reset-pin.sh',
    'README.txt',
    'LICENSE',
    'CREDITS.md',
    'THIRD_PARTY_NOTICES.txt',
    'app/server.mjs',
    'app/launcher.mjs',
    'app/reset-pin.mjs',
    'app/migrations/0001_initial_schema.sql',
    'app/migrations/0009_settings_tv_address.sql',
    'app/client/dist/index.html',
    'app/node_modules/better-sqlite3/package.json',
    'app/node_modules/sharp/package.json',
  ]) {
    expect(existsSync(path.resolve(pkg, file)), `the package holds ${path.relative(pkg, path.resolve(pkg, file))}`);
  }
  const shipped = readdirSync(path.join(pkg, 'app', 'node_modules')).sort();
  expect(
    shipped.every((name) =>
      ['@img', 'better-sqlite3', 'detect-libc', 'node-addon-api', 'semver', 'sharp'].includes(name),
    ),
    `app/node_modules holds only the native modules and their dependencies (${shipped.join(', ')})`,
  );
  // Of sharp's binary packages, only this system's.
  const host = new RegExp(`^(?:colour|sharp-(?:libvips-)?${process.platform}-${process.arch})$`);
  const images = readdirSync(path.join(pkg, 'app', 'node_modules', '@img')).sort();
  expect(
    images.length > 1 && images.every((name) => host.test(name)),
    `@img holds only this system's sharp (${images.join(', ')})`,
  );
  const readme = readFileSync(path.join(pkg, 'README.txt'), 'utf8');
  expect(
    /Built from the (?:tag \S+ \(commit [0-9a-f]{40}\)|commit [0-9a-f]{40})/.test(readme),
    'README.txt names the source it was built from',
  );
  expect(readme.includes('More info, then Run anyway'), 'README.txt says how to start the unsigned package');
  const notices = readFileSync(path.join(pkg, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
  for (const name of [
    'Node.js',
    'better-sqlite3',
    'sharp',
    'fastify',
    'socket.io',
    'react',
    'vite',
    'libvips',
    'GNU Lesser General Public License',
    'Copyright (c) James Sumners',
  ]) {
    expect(notices.includes(name), `THIRD_PARTY_NOTICES.txt covers ${name}`);
  }
  if (windows) {
    const description = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-Item -LiteralPath '${runtime.replaceAll("'", "''")}').VersionInfo.FileDescription`,
      ],
      { encoding: 'utf8' },
    ).stdout.trim();
    expect(description === 'Emberglass', `emberglass.exe describes itself as Emberglass (got "${description}")`);
  }

  // A DM's machine: no Node on PATH, an empty data directory.
  const home = path.join(work, 'home');
  mkdirSync(path.join(home, 'bin'), { recursive: true });
  const dataDir = path.join(work, 'data');
  mkdirSync(dataDir);
  const env = cleanEnv(dataDir, port, home);
  expect(!nodeOnPath(env), `no Node on the launcher's PATH (${env.PATH})`);
  expect(readdirSync(dataDir).length === 0, 'EMBERGLASS_DATA_DIR starts empty');
  expect(!(await portTaken(port)), `nothing at all listens on port ${port} before the launch`);

  // A double-click: cmd /s /c ""…"" keeps a path with & and spaces whole, as Explorer does.
  const launch = (script = windows ? 'Emberglass.cmd' : 'emberglass.sh') =>
    windows
      ? run(
          path.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'),
          ['/d', '/s', '/c', `""${path.join(pkg, script)}""`],
          env,
          { verbatim: true },
        )
      : run('/bin/sh', [path.join(pkg, script)], env);
  // Off Windows no browser opener is on the clean PATH, so a launch that only opens the DM view says
  // where to go and keeps its window (code 2); on Windows rundll32 opens it (code 0).
  const openedCode = windows ? 0 : 2;
  const base = `http://127.0.0.1:${port}`;
  const dm = `${base}/dm`;
  const origin = { origin: base };

  // First launch: the server starts and the DM view opens.
  const first = launch();
  await waitFor(async () => first.child.exitCode !== null || (await answersAuth(port)), 60_000);
  expect(await answersAuth(port), 'the first launch starts a server that answers /api/auth with {"dm":false}');
  const smoke = spawnSync(process.execPath, [path.join(root, 'scripts', 'smoke.mjs'), '--wait', '30'], {
    env: { ...process.env, SMOKE_URL: base },
    encoding: 'utf8',
  });
  expect(smoke.status === 0, `make smoke's checks pass against it: ${(smoke.stdout + smoke.stderr).trim()}`);
  for (const file of ['emberglass.db', 'images', 'logs']) {
    expect(existsSync(path.join(dataDir, file)), `the server created ${file} in EMBERGLASS_DATA_DIR`);
  }
  await waitFor(() => first.output.includes('Opening the DM view'), 5000);
  for (const [text, what] of [
    [`Emberglass is running on port ${port}`, 'says the server is running'],
    ['Connect a screen (', "shows the TV's address with its adapter, and its QR code"],
    [`Open http://localhost:${port}/dm in a browser on this PC to set it`, 'says where to set the PIN'],
    [`Opening the DM view: ${dm}`, 'opens the DM view on the loopback address it asked'],
  ]) {
    expect(first.output.includes(text), `the first launch's console ${what}`);
  }

  // Second launch: the running server is found, the DM view opens, nothing else starts.
  const second = launch();
  const code = await within(30_000, second.exit);
  expect(code === openedCode, `the second launch exits by itself, with code ${openedCode} (got ${code})`);
  expect(
    second.output.includes(`Emberglass is already running on port ${port}. Opening ${dm}`),
    'the second launch finds the server running and opens the DM view',
  );
  expect(!second.output.includes('Emberglass is running on port'), 'the second launch starts no second server');
  expect(first.child.exitCode === null && (await answersAuth(port)), 'the first server is still the one answering');

  // The bundle's native and real-time parts, which smoke does not reach: the PIN set from loopback
  // (specs/07-security-and-access.md §1, scrypt), an upload through sharp, whose Windows DLLs load
  // only from the package's own folder, and the live WebSocket's handshake (Socket.io, bundled).
  const setPin = () =>
    fetch(`${base}/api/setup`, {
      method: 'POST',
      headers: { ...origin, 'content-type': 'application/json' },
      body: JSON.stringify({ pin: '24681357' }),
    });
  const setup = await setPin();
  const cookie = (setup.headers.get('set-cookie') ?? '').split(';', 1)[0];
  expect(
    setup.ok && cookie.startsWith('emberglass_dm='),
    `the PIN is set from this PC's loopback address (${setup.status})`,
  );
  const { default: sharp } = await import('sharp');
  const png = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#7a4b2a' } })
    .png()
    .toBuffer();
  const upload = await fetch(`${base}/api/images`, {
    method: 'POST',
    headers: { ...origin, cookie, 'content-type': 'image/png' },
    body: png,
  });
  const image = upload.ok ? await upload.json() : {};
  expect(upload.status === 201 && image.id === sha256(png), `an image uploads through sharp (${upload.status})`);
  const display = await fetch(`${base}/images/${image.id}/display`, { headers: { cookie } });
  const displayed = Buffer.from(await display.arrayBuffer());
  expect(
    display.status === 200 && displayed.subarray(8, 12).toString() === 'WEBP',
    `its display version is a WebP made by sharp (${display.status})`,
  );
  const handshake = await new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`);
    const timer = setTimeout(() => resolve('timeout'), 10_000);
    socket.addEventListener('message', (event) => {
      clearTimeout(timer);
      socket.close();
      resolve(String(event.data));
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      resolve('error');
    });
  });
  expect(
    String(handshake).startsWith('0{"sid":'),
    `the live WebSocket opens its Socket.io session (${String(handshake).slice(0, 12)})`,
  );
  // A TV address this PC does not have, for the restart below (specs/08-ux-journeys.md §5, Q-110).
  const chosen = await fetch(`${base}/api/settings`, {
    method: 'PATCH',
    headers: { ...origin, cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ tv_address: '10.254.253.252' }),
  });
  expect(chosen.ok, `a TV address is saved in Settings (${chosen.status})`);

  // The PIN reset from the package (specs/07-security-and-access.md §1): cleared, so setup is open again.
  const reset = launch(windows ? 'Reset PIN.cmd' : 'reset-pin.sh');
  const resetCode = await within(30_000, reset.exit);
  expect(
    resetCode === 0 && reset.output.includes('The DM PIN was cleared'),
    `the PIN reset from the package says it cleared the PIN (code ${resetCode})`,
  );
  const again = await setPin();
  expect(again.ok, `after the reset the PIN is set again from loopback (${again.status})`);

  stop(first);
  await within(10_000, first.exit);
  expect(!(await portTaken(port)), 'stopping the launcher stops the server, freeing the port');

  // A restart on the same data: the stored TV address is used, and named as gone since this PC lacks it.
  const third = launch();
  await waitFor(async () => third.child.exitCode !== null || (await answersAuth(port)), 60_000);
  await waitFor(() => third.output.includes('Opening the DM view'), 5000);
  expect(
    third.output.includes('The TV address chosen in Settings, 10.254.253.252, is not an address of this PC now'),
    "the console at start uses the stored TV address and says it is not this PC's",
  );
  expect(!third.output.includes('No DM PIN is set yet'), 'the restart keeps the PIN set before it');
  stop(third);
  await within(10_000, third.exit);

  // Two double-clicks at once: one server starts, the other launch opens its DM view (review C-L1).
  const twins = [launch(), launch()];
  const twinCode = await within(60_000, Promise.race(twins.map((twin) => twin.exit)));
  await waitFor(() => answersAuth(port), 30_000);
  const starters = twins.filter((twin) => twin.output.includes('Emberglass is running on port'));
  expect(starters.length === 1, `two launches at once start exactly one server (${starters.length})`);
  const other = twins.find((twin) => twin !== starters[0]);
  expect(
    twinCode === openedCode && other !== undefined && other.output.includes('Emberglass is already running on port'),
    `the other launch opens the running server's DM view and exits (code ${twinCode})`,
  );
  // A second server on the same data directory, even on another port, starts nothing and touches nothing:
  // the data directory is locked by the running one (D-173).
  const intruder = run(runtime, [path.join(pkg, 'app', 'server.mjs')], { ...env, EMBERGLASS_PORT: String(port + 2) });
  const intruderCode = await within(30_000, intruder.exit);
  expect(
    intruderCode !== 0 &&
      intruderCode !== 'timeout' &&
      intruder.output.includes('Emberglass is already running in another window'),
    `a second server on the same data directory refuses to start (code ${intruderCode})`,
  );
  expect(!(await portTaken(port + 2)), 'it listens on no port');
  for (const twin of twins) stop(twin);
  await Promise.all(twins.map((twin) => within(10_000, twin.exit)));
  await waitFor(async () => !(await portTaken(port)), 10_000);

  // The port held by a program that is not Emberglass: plain advice, no browser, no server.
  const blocker = createHttpServer((_request, response) => response.writeHead(404).end('not Emberglass'));
  await new Promise((resolve) => blocker.listen(port, '0.0.0.0', () => resolve(undefined)));
  try {
    const taken = launch();
    const takenCode = await within(60_000, taken.exit);
    expect(takenCode === 1, `a launch on a port another program holds fails, with code 1 (got ${takenCode})`);
    expect(
      taken.output.includes(`Port ${port} is used by another program, so Emberglass cannot start on it.`) &&
        taken.output.includes(`EMBERGLASS_PORT=${port + 1}`),
      'it says the port is taken and how to start on another one',
    );
    expect(!taken.output.includes('Opening the DM view'), 'it opens no browser');
  } finally {
    await new Promise((resolve) => blocker.close(() => resolve(undefined)));
  }

  // The installer (PKG-02, specs/09-operations.md §4, §5, Q-108, D-172). Built on Windows beside the zip.
  // Installing changes the machine (Program Files, the firewall, the Start Menu), so it runs only where
  // EMBERGLASS_PACKAGE_SYSTEM_TESTS=1 says the machine is a throwaway one, the CI runner.
  if (windows) {
    const setups = readdirSync(out).filter((name) => name.endsWith('-setup.exe'));
    expect(setups.length === 1, `one installer beside the zip (${setups.join(', ')})`);
    const setupName = setups[0] ?? '';
    const setup = path.join(out, setupName);
    const setupSum = existsSync(`${setup}.sha256`) ? readFileSync(`${setup}.sha256`, 'utf8') : '';
    expect(
      setupSum === `${sha256(readFileSync(setup))}  ${setupName}\n`,
      `${setupName}.sha256 is the installer's SHA-256`,
    );
    if (process.env.EMBERGLASS_PACKAGE_SYSTEM_TESTS === '1') {
      const olderDir = path.join(out, 'upgrade-test');
      const older = existsSync(olderDir)
        ? readdirSync(olderDir).find((name) => name.endsWith('-setup.exe'))
        : undefined;
      expect(older !== undefined, 'the older-labelled installer for the upgrade check was built');
      if (older) await installerChecks(setup, path.join(olderDir, older), env);
    } else if (process.env.CI === 'true') {
      // In CI the installer checks are the release's gate: a job that lost the variable must fail, not skip
      // (review T-H1).
      expect(false, 'EMBERGLASS_PACKAGE_SYSTEM_TESTS=1 is set where the package is checked in CI');
    } else {
      log('skip the installer installs here: they change the machine; CI sets EMBERGLASS_PACKAGE_SYSTEM_TESTS=1');
    }
  }

  if (failures.length > 0) {
    for (const [name, record] of [
      ['first', first],
      ['second', second],
      ['third', third],
      ['twin 1', twins[0]],
      ['twin 2', twins[1]],
    ]) {
      log(`${name} launch output:`);
      console.log(record.output);
    }
  }
} finally {
  for (const record of children) stop(record);
  await new Promise((resolve) => setTimeout(resolve, 500));
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}

if (failures.length > 0) {
  console.error(`package-check: ${failures.length} check(s) failed.`);
  process.exit(1);
}
log(`${zipName} passes.`);
