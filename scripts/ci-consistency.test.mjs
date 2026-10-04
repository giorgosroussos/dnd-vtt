import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GATES } from './tripwire.mjs';

// "CI is green" and "`make verify` is green" are the same statement only while
// the Makefile, the workflow, the tripwire registry and the README agree
// (specs/13-implementation-plan.md §3 FND-02, D-060, D-061). Nothing else checks it.
const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const list = (text) =>
  text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const makefile = read('Makefile');
const workflow = read('.github/workflows/ci.yml');
const release = read('.github/workflows/release.yml');
const readme = read('README.md');

const verifyGates = list(/^verify:([^#\n]*)##/m.exec(makefile)[1].replace(/\s+/g, ','));
const targetMatrices = [...workflow.matchAll(/^\s+target: \[(.*)\]$/gm)].map((m) => list(m[1]));
// No tripwire job at all once every gate is promoted (D-127).
const tripwireMatrix = list(/^\s+gate: \[(.*)\]$/m.exec(workflow)?.[1] ?? '');

// Every gate `specs/10-testing-acceptance.md` §3 and §6 require that is a test or
// a build check. Each is either still a tripwire or, once promoted, carries its
// marker in the repository; dropping one from both is what this list catches.
const REQUIRED_GATES = [
  'hidden-information',
  'player-command-rejection',
  'image-revocation',
  'offline-e2e',
  'external-url-build',
];

describe('CI and the command contract agree', () => {
  it('runs the same gate targets on Linux and on Windows', () => {
    expect(targetMatrices).toHaveLength(2);
    expect(targetMatrices[0]).toEqual(targetMatrices[1]);
  });

  it('runs every gate of `make verify` as its own job', () => {
    expect(verifyGates.length).toBeGreaterThan(0);
    for (const gate of verifyGates) expect(targetMatrices[0]).toContain(gate);
  });

  it('runs every gate job through a real Makefile target', () => {
    const targets = new Set([...makefile.matchAll(/^([a-zA-Z][\w-]*):/gm)].map((m) => m[1]));
    for (const target of targetMatrices[0]) expect(targets).toContain(target);
  });

  it('has one tripwire job per registered gate, and no other', () => {
    expect([...tripwireMatrix].sort()).toEqual(GATES.map((g) => g.id).sort());
  });

  it('keeps every required gate either as a tripwire or present in the repository', () => {
    const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
    });
    const paths = listed.stdout.split('\0').filter(Boolean);
    const readFile = (p) => {
      try {
        const bytes = readFileSync(path.join(fileURLToPath(root), p));
        return bytes.includes(0) ? null : bytes.toString('utf8');
      } catch {
        return null;
      }
    };
    const notAGate = /(?:\.md$|^\.log\/|^specs\/|^docs\/|^scripts\/(?:tripwire|ci-consistency)\.)/;
    const isTest = /\.(?:spec|test)\.(?:ts|tsx|mjs|js)$/;
    for (const id of REQUIRED_GATES) {
      const registered = GATES.some((g) => g.id === id);
      // In a test that runs, not only in a comment beside the code it checks (review C-L4).
      const present = paths.some((p) => isTest.test(p) && !notAGate.test(p) && readFile(p)?.includes(`@gate:${id}`));
      expect(registered || present, `${id}: neither a tripwire nor present in the repository`).toBe(true);
    }
  });

  it('runs the external-URL check in the client build, which make build runs (review C-L4)', () => {
    const client = JSON.parse(read('client/package.json'));
    expect(client.scripts.build).toContain('node ../scripts/check-external-urls.mjs dist');
    expect(/^build:[^#\n]*##/m.test(makefile)).toBe(true);
  });

  it('maps every job to its command in README.md', () => {
    for (const target of targetMatrices[0]) {
      expect(readme).toContain(`| \`${target} · linux\`, \`${target} · windows\` | `);
      expect(readme).toContain(`| \`make ${target}\` |`);
    }
    for (const id of tripwireMatrix) {
      expect(readme).toContain(`| \`tripwire · ${id} (absent)\` | \`ubuntu-latest\` | \`make tripwire GATE=${id}\` |`);
    }
  });

  // The package is built and checked by one target on the Windows runner, in CI and on a tag, so a
  // release is the package CI already checked (PKG-01, D-164, D-166).
  it('builds the package with make package, on Windows, in CI and in the release workflow', () => {
    for (const text of [workflow, release]) {
      const job = /^ {2}package:\n([\s\S]*?)(?=^ {2}\S|(?![\s\S]))/m.exec(text)?.[1] ?? '';
      expect(job).toContain('name: package · windows');
      expect(job).toContain('runs-on: windows-latest');
      expect(job).toContain('run: make package');
      expect(job).not.toContain('contents: write');
    }
    expect(/^package:[^#\n]*##/m.test(makefile)).toBe(true);
    expect(readme).toContain('| `package · windows` | `windows-latest` | `make package` |');
  });

  // The package is built and gated after a merge to main and on demand, never on a pull request (D-179); the gates
  // job carries no condition of its own and is skipped with the job it needs. The release workflow, on a tag,
  // always builds and gates before it publishes.
  it('builds and gates the package in CI on main and on demand, not on pull requests', () => {
    expect(workflow).toMatch(/^on:\n {2}pull_request:\n {2}push:\n {4}branches: \[main\]\n {2}workflow_dispatch:\n/m);
    const job = /^ {2}package:\n([\s\S]*?)(?=^ {2}\S)/m.exec(workflow)?.[1] ?? '';
    expect(job).toMatch(/^ {4}if: github\.event_name != 'pull_request'$/m);
    const gates = /^ {2}package-gates:\n([\s\S]*?)(?=^ {2}\S|(?![\s\S]))/m.exec(workflow)?.[1] ?? '';
    expect(gates).toContain('needs: package');
    const built = /^ {2}package:\n([\s\S]*?)(?=^ {2}\S)/m.exec(release)?.[1] ?? '';
    expect(built).not.toMatch(/^ {4}if:/m);
  });

  // The installer is installed, upgraded and uninstalled only where the variable says the machine may be
  // changed; a job that lost it would skip that silently (review T-H1). Both jobs keep both files.
  it('runs the installer checks in both package jobs, and keeps and releases the installer beside the zip', () => {
    for (const text of [workflow, release]) {
      const job = /^ {2}package:\n([\s\S]*?)(?=^ {2}\S|(?![\s\S]))/m.exec(text)?.[1] ?? '';
      expect(job).toContain("EMBERGLASS_PACKAGE_SYSTEM_TESTS: '1'");
      for (const glob of [
        'dist/package/*.zip',
        'dist/package/*.zip.sha256',
        'dist/package/*-setup.exe',
        'dist/package/*-setup.exe.sha256',
      ]) {
        expect(job).toContain(glob);
      }
    }
    const publish = /^ {2}release:\n([\s\S]*)/m.exec(release)?.[1] ?? '';
    expect(publish).toContain('sha256sum --check --strict "$(basename "$setup").sha256" "$(basename "$zip").sha256"');
    expect(publish).toContain(
      'gh release create "$GITHUB_REF_NAME" package/*-setup.exe package/*-setup.exe.sha256 package/*.zip package/*.zip.sha256',
    );
  });

  it('checks that the tag names this version, and builds with it, before make package (review T-L10)', () => {
    const job = /^ {2}package:\n([\s\S]*?)(?=^ {2}\S)/m.exec(release)?.[1] ?? '';
    const check = job.indexOf('- name: The tag names this version');
    expect(check).toBeGreaterThan(-1);
    expect(job.indexOf('run: make package')).toBeGreaterThan(check);
    expect(job).toContain('"v$version" | "v$version"-*) ;;');
    expect(job).toContain('echo "EMBERGLASS_BUILD_VERSION=${GITHUB_REF_NAME#v}" >> "$GITHUB_ENV"');
  });

  // The package gates (PKG-03, D-176): the package the package job built, installed on a fresh Windows runner and
  // put through the hidden-information suite, the journeys and the offline run, in CI and before every release.
  it("runs the package gates on the package job's own package, on Windows, in CI and in the release workflow", () => {
    for (const text of [workflow, release]) {
      const job = /^ {2}package-gates:\n([\s\S]*?)(?=^ {2}\S|(?![\s\S]))/m.exec(text)?.[1] ?? '';
      expect(job).toContain('name: package gates · windows');
      expect(job).toContain('needs: package');
      expect(job).toContain('runs-on: windows-latest');
      expect(job).toContain("EMBERGLASS_PACKAGE_SYSTEM_TESTS: '1'");
      expect(job).toContain('EMBERGLASS_E2E_BROWSERS: chromium,msedge');
      expect(job).toMatch(/name: package-windows\n {10}path: dist\/package\n/);
      const download = job.indexOf('name: package-windows');
      expect(download).toBeGreaterThan(-1);
      expect(job.indexOf('run: make package-gates')).toBeGreaterThan(download);
      expect(job).not.toContain('make package\n');
      // Never skipped or allowed to fail while the run stays green (review T-M3).
      expect(job).not.toMatch(/continue-on-error|^ {4}if:/m);
      // The files tested are the files the package job built (review S-M1).
      const check = job.indexOf('name: The package is the one the package job built');
      expect(check).toBeGreaterThan(download);
      expect(job.indexOf('run: make package-gates')).toBeGreaterThan(check);
      expect(job).toContain('SETUP_SHA256: ${{ needs.package.outputs.setup }}');
      // A failed gate keeps its traces, in a release as in CI (release run 37052169914 kept nothing).
      expect(job).toMatch(/if: failure\(\)\n {8}uses: actions\/upload-artifact@[0-9a-f]{40}/);
      expect(job).toContain('path: e2e/test-results/');
      expect(job).not.toContain('contents: write');
    }
    for (const text of [workflow, release]) {
      const job = /^ {2}package:\n([\s\S]*?)(?=^ {2}\S)/m.exec(text)?.[1] ?? '';
      expect(job).toContain('setup: ${{ steps.digests.outputs.setup }}');
      expect(job).toContain('zip: ${{ steps.digests.outputs.zip }}');
      expect(job.indexOf('id: digests')).toBeGreaterThan(job.indexOf('run: make package'));
    }
    expect(/^package-gates:[^#\n]*##/m.test(makefile)).toBe(true);
    expect(readme).toContain('| `package gates · windows` | `windows-latest` | `make package-gates` |');
  });

  it('publishes only from a version tag, after the package gates, with provenance, from the job that runs no project code', () => {
    expect(release).toMatch(/^on:\n {2}push:\n {4}tags: \['v\*'\]\n/m);
    expect(release).toMatch(/^permissions:\n {2}contents: read\n/m);
    const publish = /^ {2}release:\n([\s\S]*)/m.exec(release)?.[1] ?? '';
    expect(publish).toContain('needs: [package, package-gates]');
    expect(publish).toContain('contents: write');
    expect(publish).toContain('id-token: write');
    expect(publish).toContain('attestations: write');
    expect(publish).toMatch(/uses: actions\/attest@[0-9a-f]{40} # v\d/);
    // Only once the owner approves it, never skipped or soft-failed (review S-M2, T-M3).
    expect(publish).toMatch(/^ {4}environment: release$/m);
    expect(publish).not.toMatch(/continue-on-error|^ {4}if:/m);
    // The files are the ones built and gated; the release is read, and a published one refused, before anything is
    // attested; only "release not found" counts as none; a leftover draft is deleted, not published (review S-M1,
    // S-L2, C-M3, C-L1).
    const verified = publish.indexOf('SETUP_SHA256: ${{ needs.package.outputs.setup }}');
    const refused = publish.indexOf('is already published');
    const attested = publish.indexOf('uses: actions/attest@');
    const created = publish.indexOf('gh release create');
    expect(verified).toBeGreaterThan(-1);
    expect(refused).toBeGreaterThan(verified);
    expect(attested).toBeGreaterThan(refused);
    expect(created).toBeGreaterThan(attested);
    expect(publish).toContain("grep -q 'release not found'");
    expect(publish).not.toContain('2>/dev/null');
    expect(publish).toContain('gh release delete "$GITHUB_REF_NAME"');
    expect(publish).not.toMatch(/--draft|--clobber/);
    expect(publish).toContain('--signer-workflow');
    expect(publish).not.toMatch(/make |npm |node /);
  });
});
