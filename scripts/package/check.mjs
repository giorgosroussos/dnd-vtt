// `make package`, second half: the acceptance check of the package just built (PKG-01, D-164, D-166).
//
//   node scripts/package/check.mjs [--port N]      reads dist/package/*.zip
//
// What a DM does with the zip, on this machine: its checksum is checked; it is unzipped into a new
// folder (on Windows with Expand-Archive, as Explorer's "Extract all" reads it); the launcher is run
// with nothing but the system folders on PATH, so no Node can be found (checked), and with an empty
// EMBERGLASS_DATA_DIR. It must start the server, which must create its data there and answer
// `make smoke`'s checks (scripts/smoke.mjs); a second launch must find it running, open the DM view
// and exit, starting no second server; the PIN must be set from loopback, an image must go through
// sharp and the live WebSocket must open; the PIN reset must clear the PIN. On Windows the runtime
// must carry Emberglass's name. Every process it starts is stopped at the end.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
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
function run(command, args, env) {
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: !windows, windowsHide: true });
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
      ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${into}'`],
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

  const folder = path.join(work, 'unzipped');
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
  const readme = readFileSync(path.join(pkg, 'README.txt'), 'utf8');
  expect(
    /Built from the (?:tag \S+ \(commit [0-9a-f]{40}\)|commit [0-9a-f]{40})/.test(readme),
    'README.txt names the source it was built from',
  );
  const notices = readFileSync(path.join(pkg, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
  for (const name of [
    'Node.js',
    'better-sqlite3',
    'sharp',
    'fastify',
    'socket.io',
    'react',
    'libvips',
    'GNU Lesser General Public License',
  ]) {
    expect(notices.includes(name), `THIRD_PARTY_NOTICES.txt covers ${name}`);
  }
  if (windows) {
    const description = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-Item -LiteralPath '${runtime}').VersionInfo.FileDescription`],
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
  expect(!(await answersAuth(port)), `nothing answers on port ${port} before the launch`);

  const launcher = windows
    ? {
        command: path.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'),
        args: ['/d', '/c', path.join(pkg, 'Emberglass.cmd')],
      }
    : { command: '/bin/sh', args: [path.join(pkg, 'emberglass.sh')] };

  // First launch: the server starts and the DM view opens.
  const first = run(launcher.command, launcher.args, env);
  const deadline = Date.now() + 60_000;
  while (!(await answersAuth(port)) && Date.now() < deadline && first.child.exitCode === null) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  expect(await answersAuth(port), 'the first launch starts a server that answers /api/auth with {"dm":false}');
  const smoke = spawnSync(process.execPath, [path.join(root, 'scripts', 'smoke.mjs'), '--wait', '30'], {
    env: { ...process.env, SMOKE_URL: `http://127.0.0.1:${port}` },
    encoding: 'utf8',
  });
  expect(smoke.status === 0, `make smoke's checks pass against it: ${(smoke.stdout + smoke.stderr).trim()}`);
  for (const file of ['emberglass.db', 'images', 'logs']) {
    expect(existsSync(path.join(dataDir, file)), `the server created ${file} in EMBERGLASS_DATA_DIR`);
  }
  await within(
    5000,
    new Promise((resolve) => {
      const poll = setInterval(() => {
        if (first.output.includes('Opening the DM view')) {
          clearInterval(poll);
          resolve(undefined);
        }
      }, 100);
    }),
  );
  for (const [text, what] of [
    [`Emberglass is running on port ${port}`, 'says the server is running'],
    ['Connect a screen', "shows the TV's address and QR code"],
    [`Open http://localhost:${port}/dm in a browser on this PC to set it`, 'says where to set the PIN'],
    [`Opening the DM view: http://localhost:${port}/dm`, 'opens the DM view on loopback'],
  ]) {
    expect(first.output.includes(text), `the first launch's console ${what}`);
  }

  // Second launch: the running server is found, the DM view opens, nothing else starts.
  const second = run(launcher.command, launcher.args, env);
  const code = await within(30_000, second.exit);
  expect(code === 0, `the second launch exits by itself, with code 0 (got ${code})`);
  expect(
    second.output.includes(`Emberglass is already running on port ${port}. Opening http://localhost:${port}/dm`),
    'the second launch finds the server running and opens the DM view',
  );
  expect(!second.output.includes('Emberglass is running on port'), 'the second launch starts no second server');
  expect(first.child.exitCode === null && (await answersAuth(port)), 'the first server is still the one answering');

  // The bundle's native and real-time parts, which smoke does not reach: the PIN set from loopback
  // (specs/07-security-and-access.md §1, scrypt), an upload through sharp, whose Windows DLLs load
  // only from the package's own folder, and the live WebSocket's handshake (Socket.io, bundled).
  const base = `http://127.0.0.1:${port}`;
  const origin = { origin: base };
  const setup = await fetch(`${base}/api/setup`, {
    method: 'POST',
    headers: { ...origin, 'content-type': 'application/json' },
    body: JSON.stringify({ pin: '24681357' }),
  });
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

  // The PIN reset from the package (specs/07-security-and-access.md §1).
  const reset = windows
    ? run(launcher.command, ['/d', '/c', path.join(pkg, 'Reset PIN.cmd')], env)
    : run('/bin/sh', [path.join(pkg, 'reset-pin.sh')], env);
  const resetCode = await within(30_000, reset.exit);
  expect(
    resetCode === 0 && reset.output.includes('The DM PIN was cleared'),
    `the PIN reset from the package clears the PIN (code ${resetCode})`,
  );

  stop(first);
  await within(10_000, first.exit);
  expect(!(await answersAuth(port)), 'stopping the launcher stops the server');
  if (failures.length > 0) {
    log('first launch output:');
    console.log(first.output);
    log('second launch output:');
    console.log(second.output);
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
