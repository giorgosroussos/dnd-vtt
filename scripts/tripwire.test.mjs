import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GATES, evaluate, markerFor } from './tripwire.mjs';

// A repository with both test roots present and no gate in it.
const BASE = {
  'e2e/tests/views.spec.ts': "test('both views load', () => {});",
  'server/src/http/app.test.ts': "it('answers 404', () => {});",
  'client/src/main.tsx': 'render();',
};

function judge(id, files) {
  return evaluate(id, Object.keys(files), (p) => files[p]);
}

describe('tripwire', () => {
  it.each(GATES.map((g) => g.id))('passes while %s is absent and says it is not the gate', (id) => {
    const result = judge(id, BASE);
    expect(result.status).toBe('absent');
    expect(result.lines.join('\n')).toContain('This job is not the gate');
    expect(result.lines.join('\n')).toContain(`Promotion condition: the first code file carrying ${markerFor(id)}`);
  });

  it.each(GATES.map((g) => g.id))('turns red with promotion instructions once %s appears in a test', (id) => {
    const result = judge(id, {
      ...BASE,
      'e2e/tests/gate.spec.ts': `test('the gate ${markerFor(id)}', () => {});`,
    });
    expect(result.status).toBe('present');
    expect(result.lines[0]).toContain('e2e/tests/gate.spec.ts');
    expect(result.lines.join('\n')).toContain('promote the gate');
    expect(result.lines.join('\n')).toContain('.github/workflows/ci.yml');
  });

  it('finds a marker in a build script, not only in tests', () => {
    const result = judge('external-url-build', {
      ...BASE,
      'client/vite.config.ts': `// ${markerFor('external-url-build')}\nexport default {};`,
    });
    expect(result.status).toBe('present');
  });

  it('does not mistake a longer gate name for the gate', () => {
    const result = judge('offline-e2e', {
      ...BASE,
      'e2e/tests/other.spec.ts': `test('${markerFor('offline-e2e')}-later', () => {});`,
    });
    expect(result.status).toBe('absent');
  });

  it('ignores markers in documentation and in the tripwire itself', () => {
    const marker = markerFor('hidden-information');
    const result = judge('hidden-information', {
      ...BASE,
      'README.md': marker,
      'scripts/tripwire.mjs': marker,
      'scripts/tripwire.test.mjs': marker,
    });
    expect(result.status).toBe('absent');
  });

  it('refuses to pass on a scan that missed the test roots', () => {
    expect(judge('hidden-information', {}).status).toBe('error');
    expect(judge('hidden-information', { 'e2e/tests/views.spec.ts': '' }).lines[0]).toContain('no Vitest tests');
    expect(judge('hidden-information', { 'server/src/a.test.ts': '' }).lines[0]).toContain('no Playwright tests');
  });

  it('rejects an unknown gate', () => {
    expect(judge('no-such-gate', BASE).status).toBe('error');
  });

  it('passes on this repository today, for every gate', () => {
    const run = spawnSync(process.execPath, ['scripts/tripwire.mjs'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
    });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    for (const gate of GATES) expect(run.stdout).toContain(`tripwire ${gate.id}: gate ABSENT`);
  });
});
