import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GATES, evaluate, markerFor, readText, repositoryPaths } from './tripwire.mjs';

// A repository with both test roots present and no gate in it.
const BASE = {
  'e2e/tests/views.spec.ts': "test('both views load', () => {});",
  'server/src/http/app.test.ts': "it('answers 404', () => {});",
  'client/src/main.tsx': 'render();',
};

// Every gate is promoted (D-127), so the mechanism is tested on a registry of its own: the two
// gates REL-02 promoted, as they were registered until then.
const SAMPLE = [
  { id: 'offline-e2e', spec: 'specs/10-testing-acceptance.md §6', gate: 'the offline run', lands: 'REL-02' },
  { id: 'external-url-build', spec: 'specs/10-testing-acceptance.md §6', gate: 'the URL check', lands: 'REL-02' },
];

// A value of null stands for a binary file.
function judge(id, files) {
  return evaluate(id, Object.keys(files), (p) => files[p], SAMPLE);
}

describe('tripwire', () => {
  it.each(SAMPLE.map((g) => g.id))('passes while %s is absent and says it is not the gate', (id) => {
    const result = judge(id, BASE);
    expect(result.status).toBe('absent');
    expect(result.lines.join('\n')).toContain('This job is not the gate');
    expect(result.lines.join('\n')).toContain(`Promotion condition: the first file carrying ${markerFor(id)}`);
  });

  it.each(SAMPLE.map((g) => g.id))('turns red with promotion instructions once %s appears in a test', (id) => {
    const result = judge(id, {
      ...BASE,
      'e2e/tests/gate.spec.ts': `test('the gate ${markerFor(id)}', () => {});`,
    });
    expect(result.status).toBe('present');
    expect(result.lines[0]).toContain('e2e/tests/gate.spec.ts');
    expect(result.lines.join('\n')).toContain('promote the gate');
    expect(result.lines.join('\n')).toContain('.github/workflows/ci.yml');
    expect(result.lines.join('\n')).toContain('ruleset on main');
    expect(result.lines.join('\n')).toContain('a skipped or placeholder test is not a gate');
  });

  it('finds a marker in a build script, not only in tests', () => {
    const result = judge('external-url-build', {
      ...BASE,
      'client/vite.config.ts': `// ${markerFor('external-url-build')}\nexport default {};`,
    });
    expect(result.status).toBe('present');
  });

  it.each([
    ['scripts/check-external-urls.py', '# '],
    ['scripts/offline.sh', '# '],
    ['.github/workflows/ci.yml', '# '],
    ['package.json', '"x": "'],
    ['Makefile', '# '],
  ])('finds a marker in %s, whatever the language', (file, prefix) => {
    const result = judge('offline-e2e', { ...BASE, [file]: `${prefix}${markerFor('offline-e2e')}` });
    expect(result.status).toBe('present');
    expect(result.lines[0]).toContain(file);
  });

  it('skips binary files and counts only text ones as scanned', () => {
    const result = judge('external-url-build', { ...BASE, 'docs/map.png': null, 'e2e/fixture.webp': null });
    expect(result.status).toBe('absent');
    expect(result.lines.join('\n')).toContain('Proof: 3 text files scanned');
  });

  it('does not mistake a longer gate name for the gate', () => {
    const result = judge('offline-e2e', {
      ...BASE,
      'e2e/tests/other.spec.ts': `test('${markerFor('offline-e2e')}-later', () => {});`,
    });
    expect(result.status).toBe('absent');
  });

  it('ignores markers in documentation, the event log and the tripwire itself', () => {
    const marker = markerFor('external-url-build');
    const result = judge('external-url-build', {
      ...BASE,
      'README.md': marker,
      'specs/10-testing-acceptance.md': marker,
      'docs/notes.txt': marker,
      '.log/events.jsonl': marker,
      'scripts/ci-consistency.test.mjs': marker,
      'scripts/tripwire.mjs': marker,
      'scripts/tripwire.test.mjs': marker,
    });
    expect(result.status).toBe('absent');
  });

  it('refuses to pass on a scan that missed the test roots', () => {
    expect(judge('external-url-build', {}).status).toBe('error');
    expect(judge('external-url-build', { 'e2e/tests/views.spec.ts': '' }).lines[0]).toContain('no Vitest tests');
    expect(judge('external-url-build', { 'server/src/a.test.ts': '' }).lines[0]).toContain('no Playwright tests');
  });

  it('rejects an unknown gate', () => {
    expect(judge('no-such-gate', BASE).status).toBe('error');
  });

  it('scans tracked and untracked files but not ignored ones', () => {
    const repo = mkdtempSync(path.join(os.tmpdir(), 'emberglass-tripwire-'));
    const write = (file, text) => {
      mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
      writeFileSync(path.join(repo, file), text);
    };
    const judgeRepo = () => evaluate('offline-e2e', repositoryPaths(repo), (p) => readText(p, repo), SAMPLE);
    try {
      expect(spawnSync('git', ['init', '-q'], { cwd: repo }).status).toBe(0);
      write('.gitignore', 'dist/\n');
      write('e2e/tests/views.spec.ts', '');
      write('server/src/app.test.ts', '');
      write('dist/built.js', `// ${markerFor('offline-e2e')}`);
      expect(judgeRepo().status).toBe('absent');

      write('e2e/tests/offline.spec.ts', `test('${markerFor('offline-e2e')}', () => {});`);
      const present = judgeRepo();
      expect(present.status).toBe('present');
      expect(present.lines[0]).toContain('gate PRESENT in e2e/tests/offline.spec.ts');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('registers no gate once every one is promoted, and says so from the command line', () => {
    expect(GATES).toEqual([]);
    const script = fileURLToPath(new URL('./tripwire.mjs', import.meta.url));
    const cwd = fileURLToPath(new URL('..', import.meta.url));
    const all = spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
    expect(all.stderr).toBe('');
    expect(all.status).toBe(0);
    expect(all.stdout).toContain('no gate is registered');
    // A promoted gate's tripwire is gone: asking for it is an error, not a pass.
    const promoted = spawnSync(process.execPath, [script, 'offline-e2e'], { cwd, encoding: 'utf8' });
    expect(promoted.status).toBe(1);
    expect(promoted.stderr).toContain('unknown gate "offline-e2e"; known: none, every gate is promoted');
  });
});
