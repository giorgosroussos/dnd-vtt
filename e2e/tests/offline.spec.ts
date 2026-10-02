import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { armed, attempts, browserService, hostOf, OUTSIDE, probeUrl } from '../offline/log.js';
import { PACKAGE_DIR } from '../package.js';

// The offline acceptance of specs/10-testing-acceptance.md §6 (specs/02-architecture.md §6, Q-020,
// D-127). Every other spec of this run has already run, each browser behind the blackhole proxy and
// the server under the guard, so nothing could leave the local host; this test, run last (the
// `offline` project), fails if anything tried. It also shows the block was real: every server of the
// run announced the guard, each browser's probe request was refused and recorded with its user agent,
// and a Node process under the guard is refused a connection and a lookup, so an empty log means
// nothing was attempted, not that nothing was watched (review H2).

// The browsers of this run: Chromium always, and those EMBERGLASS_E2E_BROWSERS names (playwright.config.ts).
const browsers = [
  ...new Set([
    'chromium',
    ...(process.env.EMBERGLASS_E2E_BROWSERS ?? 'chromium')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  ]),
];
// A URL, not a path: `--import` reads an absolute Windows path's drive letter as a URL scheme.
const guard = new URL('../offline/guard.mjs', import.meta.url).href;

test('@gate:offline-e2e the end-to-end run sent nothing beyond the local host, and the block it ran under holds', () => {
  // 1. The servers of the run were watched: the suite's own and each First run journey's, one per
  // browser, all started with the guard (review H2). Against a package (PKG-03) every one of them is its
  // launcher, and none is the source install's start script.
  const all = attempts();
  const entry = PACKAGE_DIR ? /launcher\.mjs/ : /start\.mjs/;
  const servers = all.filter((each) => armed(each) && entry.test(each.target));
  expect(servers.length, 'servers started under the guard').toBeGreaterThanOrEqual(1 + browsers.length);
  if (PACKAGE_DIR) {
    expect(all.filter((each) => armed(each) && /start\.mjs/.test(each.target))).toEqual([]);
    for (const each of servers) expect(each.target, 'a server of the package').toContain(PACKAGE_DIR);
  }

  // 2. Nothing was attempted by any view or by the server during the whole run, but each browser's own
  // probe (journeys/offline-probe.spec.ts), which shows its traffic went through the proxy; Edge's calls
  // to its own services are reported, not counted.
  const services = all.filter(browserService);
  if (services.length > 0) {
    test.info().annotations.push({
      type: 'browser services',
      description: `${services.length} attempts by Edge to its own services, blocked: ${[
        ...new Set(services.map((each) => hostOf(each.target))),
      ].join(', ')}`,
    });
  }
  const counted = all.filter((each) => !armed(each) && !browserService(each));
  expect(counted.map((each) => `${each.from} ${each.target}`).sort()).toEqual(
    browsers.map((name) => `browser GET ${probeUrl(name)}`).sort(),
  );

  // 3. So does a Node process's, under the guard the server runs with: a connection, a lookup and a datagram.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'emberglass-guard-'));
  try {
    const probe = path.join(dir, 'outbound.jsonl');
    const run = spawnSync(
      process.execPath,
      [
        '--import',
        guard,
        '-e',
        [
          `const report = (e) => console.log(e?.cause?.code ?? e?.code);`,
          `fetch('http://${OUTSIDE}/').catch(report)`,
          `  .then(() => require('node:dns').promises.lookup('example.org').catch(report))`,
          `  .then(() => new Promise((done) => require('node:dgram').createSocket('udp4')`,
          `    .send(Buffer.from('x'), 53, '${OUTSIDE}', (e) => { report(e); done(); })))`,
          `  .then(() => process.exit(3));`,
        ].join('\n'),
      ],
      { encoding: 'utf8', env: { ...process.env, EMBERGLASS_E2E_OUTBOUND_LOG: probe } },
    );
    expect(run.status, run.stderr).toBe(3);
    expect(run.stdout.trim().split(/\s+/)).toEqual(['ECONNREFUSED', 'ENOTFOUND', 'ECONNREFUSED']);
    expect(attempts(probe).filter(armed)).toHaveLength(1);
    expect(
      attempts(probe)
        .filter((each) => !armed(each))
        .map((each) => `${each.kind} ${each.target}`),
    ).toEqual([`connect ${OUTSIDE}:80`, 'lookup example.org', `udp ${OUTSIDE}:53`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
