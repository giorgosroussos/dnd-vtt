// `make package-gates`: the package gates (PKG-03, specs/13-implementation-plan.md §11; specs/10-testing-acceptance.md
// §3, §4, §5, §6; D-176). The package `make package` built, in dist/package/, passes the same gates as the source
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
// not run, or ran against something else, fails the target as surely as one that failed.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './lib.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.join(root, 'dist', 'package');
const windows = process.platform === 'win32';
const failures = [];

/** The `@gate:` tests of specs/10-testing-acceptance.md §3, which must each run and pass against the package. */
const HIDDEN_INFORMATION_GATES = ['hidden-information', 'player-command-rejection', 'image-revocation'];
/** The journeys of specs/10-testing-acceptance.md §5 and the per-browser offline probe, in every browser. */
const JOURNEYS = [
  'first-run.spec.ts',
  'prepare.spec.ts',
  'connect.spec.ts',
  'run.spec.ts',
  'recover.spec.ts',
  'large-scene.spec.ts',
  'offline-probe.spec.ts',
];

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
    `${path.basename(file)} matches its .sha256`,
  );
  return file;
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
  expect(installed.status === 0, `the installer installs silently (exit ${installed.status})`);
  expect(existsSync(path.join(app, 'emberglass.exe')), `the package is installed in ${app}`);
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
    rmSync(logs, { recursive: true, force: true });
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
  return { folder, uninstall: async () => rmSync(work, { recursive: true, force: true }) };
}

function run(what, args, cwd, env) {
  log(`running ${what}`);
  const result = spawnSync(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' });
  expect(result.status === 0, `${what} passes (exit ${result.status})`);
}

/** The hidden-information gates, each of which must have run and passed. */
function hiddenInformation(folder, reports) {
  const report = path.join(reports, 'vitest.json');
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
      'src/ws/hidden-information.test.ts',
      'src/ws/commands.test.ts',
    ],
    root,
    { EMBERGLASS_TEST_PACKAGE: folder },
  );
  const results = existsSync(report)
    ? JSON.parse(readFileSync(report, 'utf8')).testResults.flatMap((file) => file.assertionResults)
    : [];
  for (const id of HIDDEN_INFORMATION_GATES) {
    const found = results.filter((test) => test.title.startsWith(`@gate:${id} `));
    expect(
      found.length === 1 && found[0].status === 'passed',
      `@gate:${id} ran against the package and passed (${found.map((test) => test.status).join(', ') || 'not run'})`,
    );
  }
}

/** Every test of a Playwright JSON report, with its file, project and outcome. */
function playwrightTests(suite, file = suite.file) {
  return [
    ...(suite.specs ?? []).flatMap((spec) =>
      spec.tests.map((test) => ({
        file: spec.file ?? file,
        title: spec.title,
        project: test.projectName,
        status: test.status,
      })),
    ),
    ...(suite.suites ?? []).flatMap((child) => playwrightTests(child, child.file ?? file)),
  ];
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
  const tests = existsSync(report)
    ? JSON.parse(readFileSync(report, 'utf8')).suites.flatMap((suite) => playwrightTests(suite))
    : [];
  const browsers = [
    ...new Set([
      'chromium',
      ...(process.env.EMBERGLASS_E2E_BROWSERS ?? 'chromium')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean),
    ]),
  ];
  for (const browser of browsers) {
    for (const journey of JOURNEYS) {
      const found = tests.filter(
        (test) => test.project === browser && test.file.replaceAll('\\', '/').endsWith(`journeys/${journey}`),
      );
      expect(
        found.length > 0 && found.every((test) => test.status === 'expected'),
        `${journey} ran in ${browser} against the package and passed (${found.map((test) => test.status).join(', ') || 'not run'})`,
      );
    }
  }
  // The run's own offline check, last; each browser's probe above carries the same marker.
  const offline = tests.filter((test) => test.project === 'offline' && test.title.startsWith('@gate:offline-e2e '));
  expect(
    offline.length === 1 && offline[0].status === 'expected',
    `@gate:offline-e2e ran after them and passed (${offline.map((test) => test.status).join(', ') || 'not run'})`,
  );
}

if (windows && process.env.EMBERGLASS_PACKAGE_SYSTEM_TESTS !== '1') {
  console.error(
    'package-gates: on Windows the gates install the package into Program Files and its firewall rules, so they run ' +
      'only where EMBERGLASS_PACKAGE_SYSTEM_TESTS=1 says the machine is a throwaway one (the CI runner).',
  );
  process.exit(1);
}

const zip = built('.zip');
const target = windows ? install(built('-setup.exe')) : unzip(zip);
const reports = mkdtempSync(path.join(os.tmpdir(), 'emberglass-gates-reports-'));
try {
  log(`the package under test: ${target.folder}`);
  hiddenInformation(target.folder, reports);
  journeys(target.folder, reports);
} finally {
  await target.uninstall();
  rmSync(reports, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`package-gates: ${failures.length} check(s) failed.`);
  process.exit(1);
}
log(`${path.basename(zip, '.zip')} passes the package gates.`);
