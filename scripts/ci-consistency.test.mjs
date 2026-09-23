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
const readme = read('README.md');

const verifyGates = list(/^verify:([^#\n]*)##/m.exec(makefile)[1].replace(/\s+/g, ','));
const targetMatrices = [...workflow.matchAll(/^\s+target: \[(.*)\]$/gm)].map((m) => list(m[1]));
const tripwireMatrix = list(/^\s+gate: \[(.*)\]$/m.exec(workflow)[1]);

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
    for (const id of REQUIRED_GATES) {
      const registered = GATES.some((g) => g.id === id);
      const present = paths.some((p) => !notAGate.test(p) && readFile(p)?.includes(`@gate:${id}`));
      expect(registered || present, `${id}: neither a tripwire nor present in the repository`).toBe(true);
    }
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
});
