// `make package-gates`: the package gates (PKG-03, specs/13-implementation-plan.md §11; specs/10-testing-acceptance.md
// §3, §4, §5, §6; D-176, D-177). The package `make package` built, in dist/package/, passes these gates of the source
// install once installed:
//
//   - the hidden-information suite: the three `@gate:` tests of server/src/ws/ (recorded traffic, player
//     commands refused, images revoked), with EMBERGLASS_TEST_PACKAGE pointing the harness at the package;
//   - the five journeys of e2e/tests/journeys/ in every browser EMBERGLASS_E2E_BROWSERS names, and the offline
//     run that watches them, with EMBERGLASS_E2E_PACKAGE pointing Playwright at the package.
//
// Every server of both runs is the package's own runtime running its launcher, as Emberglass.cmd does, with no
// program on PATH. On Windows the package is the installer's: installed silently into Program Files, which only
// a throwaway machine may allow (EMBERGLASS_PACKAGE_SYSTEM_TESTS=1, the CI runner, D-172), and uninstalled at the
// end. Elsewhere it is the zip, unzipped into a temporary folder, to try the gates locally. A gate test that did
// not run, or ran against something else, fails the target as surely as one that failed: the verdicts are
// scripts/package/lib.mjs's, tested in lib.test.mjs.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  browsersOf,
  journeySpecs,
  packagedServersVerdict,
  playwrightVerdicts,
  sha256,
  vitestVerdicts,
} from './lib.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.join(root, 'dist', 'package');
const windows = process.platform === 'win32';
const failures = [];

function log(line) {
  console.log(`package-gates: ${line}`);
}

function expect(condition, message) {
  if (condition) log(`ok   ${message}`);
  else {
    failures.push(message);
    log(`FAIL ${message}`);
  }
  return condition;
}

/** The one file of dist/package/ with this ending, and whether its `.sha256` is its checksum. */
function built(ending) {
  const found = existsSync(out) ? readdirSync(out).filter((name) => name.endsWith(ending)) : [];
  if (found.length !== 1) {
    console.error(`package-gates: expected one *${ending} in ${out}, found ${found.length}. Run make package first.`);
    process.exit(1);
  }
  const file = path.join(out, /** @type {string} */ (found[0]));
  const sum = existsSync(`${file}.sha256`) ? readFileSync(`${file}.sha256`, 'utf8') : '';
  expect(
    sum === `${sha256(readFileSync(file))}  ${path.basename(file)}\n`,
    `${path.basename(file)} matches its .sha256 (if not, build it again with make package)`,
  );
  return file;
}

/**
 * Removes a temporary folder of the run's own, waiting out a process that still holds a file in it: the
 * uninstaller's copy of itself writes its log after the program folder is gone (EPERM on the Windows runner,
 * release run 37052169914, attempt 3). A folder that still cannot go is left to the throwaway runner's
 * temporary directory with a warning; it is no check of the package, so it fails nothing.
 */
function removeTemporary(folder) {
  try {
    rmSync(folder, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
  } catch (error) {
    log(`could not remove ${folder} (${error.code ?? error}); it stays in the temporary directory`);
  }
}

/** Installs the installer silently for every user; answers the installed folder and how to uninstall it. */
function install(setup) {
  const app = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Emberglass');
  const data = path.join(process.env.APPDATA ?? '', 'Emberglass');
  if (existsSync(app) || existsSync(data)) {
    console.error(
      `package-gates: ${app} or ${data} exists already: the gates install only on a machine without Emberglass.`,
    );
    process.exit(1);
  }
  const logs = mkdtempSync(path.join(os.tmpdir(), 'emberglass-gates-setup-'));
  const installed = spawnSync(
    setup,
    ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', `/LOG=${path.join(logs, 'install.log')}`],
    { timeout: 180_000 },
  );
  if (installed.status !== 0 && existsSync(path.join(logs, 'install.log'))) {
    console.log(readFileSync(path.join(logs, 'install.log'), 'utf8'));
  }
  const ok =
    expect(installed.status === 0, `the installer installs silently (exit ${installed.status})`) &&
    expect(existsSync(path.join(app, 'emberglass.exe')), `the package is installed in ${app}`);
  if (!ok) {
    // Nothing to test: the gates would only fail again, slowly, on a folder that is not there (review U-L8).
    console.error('package-gates: the installer failed; its log is above. No gate ran.');
    process.exit(1);
  }
  const uninstall = async () => {
    const removed = spawnSync(
      path.join(app, 'unins000.exe'),
      ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/LOG=${path.join(logs, 'uninstall.log')}`],
      { timeout: 180_000 },
    );
    // The uninstaller runs a copy of itself and returns at once: done once the folder is gone.
    const deadline = Date.now() + 120_000;
    while (existsSync(app) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 500));
    expect(removed.status === 0 && !existsSync(app), `the package is uninstalled afterwards (exit ${removed.status})`);
    // Every server of the gates had a data directory of its own: none may have used the DM's (review T-L2).
    expect(!existsSync(data), `the gates left nothing in ${data}`);
    removeTemporary(logs);
  };
  return { folder: app, uninstall };
}

/** Unzips the zip into a temporary folder, as a DM would; answers the package's folder and how to remove it. */
function unzip(zip) {
  const work = mkdtempSync(path.join(os.tmpdir(), 'emberglass-gates-'));
  const unzipped = spawnSync('python3', ['-m', 'zipfile', '-e', zip, work], { stdio: 'inherit' });
  if (unzipped.status !== 0) throw new Error('unzipping with python3 failed');
  const folder = path.join(work, 'Emberglass');
  // Python's zipfile drops the Unix modes the zip records; a DM's unzip keeps them.
  for (const file of ['emberglass', 'emberglass.sh', 'reset-pin.sh']) chmodSync(path.join(folder, file), 0o755);
  return { folder, uninstall: async () => removeTemporary(work) };
}

function run(what, args, cwd, env) {
  log(`running ${what}`);
  const result = spawnSync(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' });
  expect(result.status === 0, `${what} passes (exit ${result.status})`);
}

/** The hidden-information gates, each of which must have run against the package and passed. */
function hiddenInformation(folder, reports) {
  const report = path.join(reports, 'vitest.json');
  const servers = path.join(reports, 'servers.jsonl');
  const files = ['src/ws/hidden-information.test.ts', 'src/ws/commands.test.ts'];
  run(
    'the hidden-information suite against the package',
    [
      path.join(root, 'node_modules', 'vitest', 'vitest.mjs'),
      'run',
      '--project',
      'server',
      '-t',
      '@gate:',
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${report}`,
      ...files,
    ],
    root,
    // The harness writes one line per packaged server it starts, so that the gates show where they ran.
    { EMBERGLASS_TEST_PACKAGE: folder, EMBERGLASS_TEST_PACKAGE_LOG: servers },
  );
  const parsed = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : null;
  const sources = files.map((file) => readFileSync(path.join(root, 'server', file), 'utf8'));
  for (const verdict of vitestVerdicts(parsed, sources)) expect(verdict.ok, verdict.message);
  const started = existsSync(servers) ? readFileSync(servers, 'utf8').split('\n') : [];
  const verdict = packagedServersVerdict(started, folder);
  expect(verdict.ok, verdict.message);
  // How long each took, so that a slowdown shows in the log long before a limit is reached (review T-L3).
  for (const test of (parsed?.testResults ?? []).flatMap((file) => file.assertionResults ?? [])) {
    if (test.status === 'passed')
      log(`${test.title.split(' ', 1)[0]} took ${Math.round((test.duration ?? 0) / 1000)} s`);
  }
}

/** The journeys in every browser and the offline gate, each of which must have run and passed. */
function journeys(folder, reports) {
  const report = path.join(reports, 'playwright.json');
  run(
    'the journeys and the offline run against the package',
    [path.join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', '--reporter=list,json'],
    path.join(root, 'e2e'),
    { EMBERGLASS_E2E_PACKAGE: folder, PLAYWRIGHT_JSON_OUTPUT_FILE: report },
  );
  const parsed = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : null;
  const specs = journeySpecs(path.join(root, 'e2e', 'tests', 'journeys'));
  for (const verdict of playwrightVerdicts(parsed, specs, browsersOf(process.env.EMBERGLASS_E2E_BROWSERS))) {
    expect(verdict.ok, verdict.message);
  }
}

if (windows && process.env.EMBERGLASS_PACKAGE_SYSTEM_TESTS !== '1') {
  console.error(
    'package-gates: on Windows the gates install the package into Program Files and its firewall rules, so they run ' +
      'only where EMBERGLASS_PACKAGE_SYSTEM_TESTS=1 says the machine is a throwaway one (the CI runner).',
  );
  process.exit(1);
}

const zip = built('.zip');
const setup = windows ? built('-setup.exe') : undefined;
const reports = mkdtempSync(path.join(os.tmpdir(), 'emberglass-gates-reports-'));
let target;
try {
  target = setup ? install(setup) : unzip(zip);
  log(`the package under test: ${target.folder}`);
  hiddenInformation(target.folder, reports);
  journeys(target.folder, reports);
} finally {
  await target?.uninstall();
  removeTemporary(reports);
}

if (failures.length > 0) {
  console.error(`package-gates: ${failures.length} check(s) failed:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
log(`${path.basename(zip, '.zip')} passes the package gates.`);
