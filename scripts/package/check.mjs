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
import { sha256 } from './lib.mjs';

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
 * runner): the acceptance of PKG-02. A first install; a v8 database in the DM's %APPDATA%\Emberglass and a
 * file the older app would have left; the installer again over it, as an upgrade; a start that migrates
 * after its backup; a silent uninstall that removes the rule and the program and leaves the data.
 */
async function installerChecks(setup, cleanEnvironment) {
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  const app = path.join(programFiles, 'Emberglass');
  const data = path.join(process.env.APPDATA ?? '', 'Emberglass');
  const startMenu = path.join(
    process.env.ProgramData ?? 'C:\\ProgramData',
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Emberglass',
  );
  if (existsSync(data) || existsSync(app)) {
    expect(
      false,
      `the installer checks refuse to run where ${data} or ${app} already exists: they would touch a real install`,
    );
    return;
  }
  const logs = mkdtempSync(path.join(os.tmpdir(), 'emberglass-setup-'));
  const install = (name) => {
    const logFile = path.join(logs, `${name}.log`);
    const result = spawnSync(setup, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', `/LOG=${logFile}`], {
      timeout: 300_000,
    });
    if (result.status !== 0 && existsSync(logFile)) console.log(readFileSync(logFile, 'utf8'));
    return result.status;
  };
  const rules = () => {
    const shown = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "@(Get-NetFirewallRule -DisplayName 'Emberglass' -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ direction = $_.Direction.ToString(); action = $_.Action.ToString(); profile = $_.Profile.ToString(); enabled = $_.Enabled.ToString(); program = ($_ | Get-NetFirewallApplicationFilter).Program } }) | ConvertTo-Json -Compress -AsArray",
      ],
      { encoding: 'utf8' },
    );
    const text = shown.stdout.trim();
    return text === '' ? [] : JSON.parse(text);
  };
  const oneRule = (when) => {
    const found = rules();
    expect(
      found.length === 1 &&
        found[0].direction === 'Inbound' &&
        found[0].action === 'Allow' &&
        found[0].profile === 'Private' &&
        found[0].enabled === 'True' &&
        found[0].program.toLowerCase() === path.join(app, 'emberglass.exe').toLowerCase(),
      `${when}: exactly one inbound rule, allowing emberglass.exe on private networks only (${JSON.stringify(found)})`,
    );
  };

  // A first install, for every user.
  expect(install('first') === 0, 'the installer installs silently');
  expect(
    existsSync(path.join(app, 'emberglass.exe')) && existsSync(path.join(app, 'app', 'server.mjs')),
    `it installs into ${app}`,
  );
  expect(existsSync(path.join(startMenu, 'Emberglass.lnk')), 'it adds the Start Menu shortcut');
  expect(existsSync(path.join(startMenu, 'Reset the Emberglass PIN.lnk')), 'it adds the PIN reset to the Start Menu');
  const desktop = path.join(process.env.PUBLIC ?? 'C:\\Users\\Public', 'Desktop', 'Emberglass.lnk');
  expect(!existsSync(desktop), 'it adds no desktop shortcut unless asked');
  oneRule('after installing');

  // The DM's data as an older Emberglass left it: schema version 8, a setting changed, and a file of the
  // older app's that the new one does not have.
  const { default: Database } = await import('better-sqlite3');
  mkdirSync(data, { recursive: true });
  const old = new Database(path.join(data, 'emberglass.db'));
  // As the migration runner applies them: foreign keys off, one transaction and version each.
  old.pragma('foreign_keys = OFF');
  for (const file of readdirSync(path.join(app, 'app', 'migrations')).sort()) {
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

  // The installer again, over the install: an upgrade in place.
  expect(install('upgrade') === 0, 'the installer upgrades an install in place, silently');
  oneRule('after upgrading');
  expect(
    !existsSync(path.join(app, 'app', 'left-by-an-older-version.txt')),
    "the upgrade leaves nothing of the older app's folder",
  );
  expect(sha256(readFileSync(path.join(data, 'emberglass.db'))) === before, 'the upgrade leaves the data untouched');

  // The first start after the upgrade migrates the data, after a dated backup (specs/09-operations.md §2).
  const port = await freePort();
  const runEnv = { ...cleanEnvironment, EMBERGLASS_PORT: String(port) };
  delete runEnv.EMBERGLASS_DATA_DIR;
  const started = run(
    path.join(runEnv.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'),
    ['/d', '/s', '/c', `""${path.join(app, 'Emberglass.cmd')}""`],
    runEnv,
    { verbatim: true },
  );
  await waitFor(async () => started.child.exitCode !== null || (await answersAuth(port)), 60_000);
  expect(await answersAuth(port), 'the installed Emberglass starts from the Start Menu target');
  stop(started);
  await within(10_000, started.exit);
  await waitFor(async () => !(await portTaken(port)), 10_000);
  const backups = readdirSync(data).filter((name) => /^emberglass-backup-.*-v8\.db$/.test(name));
  expect(backups.length === 1, `the migration's backup of the version 8 database appears (${backups.join(', ')})`);
  const migrated = new Database(path.join(data, 'emberglass.db'), { readonly: true });
  const kept = migrated.prepare('SELECT id, ruler_rule FROM settings').get();
  const schema = migrated.pragma('user_version', { simple: true });
  migrated.close();
  expect(
    kept?.id === settingsId && kept?.ruler_rule === 'dmg' && schema >= 9,
    `the upgraded install keeps the data and migrates it (version ${schema})`,
  );

  // A silent uninstall: the program, its shortcuts and its rule go; the data stays (specs/09-operations.md §5).
  const uninstaller = path.join(app, 'unins000.exe');
  spawnSync(uninstaller, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], { timeout: 300_000 });
  // The uninstaller runs a copy of itself from a temporary folder and returns at once.
  await waitFor(() => !existsSync(path.join(app, 'emberglass.exe')), 120_000);
  expect(
    !existsSync(path.join(app, 'emberglass.exe')) && !existsSync(path.join(app, 'app')),
    'the uninstaller removes the program',
  );
  expect(!existsSync(path.join(startMenu, 'Emberglass.lnk')), 'it removes the Start Menu shortcuts');
  await waitFor(() => rules().length === 0, 30_000);
  expect(rules().length === 0, 'it removes the firewall rule');
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
    if (process.env.EMBERGLASS_PACKAGE_SYSTEM_TESTS === '1') await installerChecks(setup, env);
    else log('skip the installer installs here: they change the machine; CI sets EMBERGLASS_PACKAGE_SYSTEM_TESTS=1');
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
