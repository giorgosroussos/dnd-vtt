import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// The `now-items` rule of check-docs.py (D-152, REL-03 review T-L7): PLAN.md's Now holds 1 to 3 package
// items that are not done, or, once every package is done, none and a `- None:` line saying so.
// `check_plan` runs on a PLAN.md in a temporary folder against the TRACEABILITY rows given.
const script = fileURLToPath(new URL('./check-docs.py', import.meta.url));
const dirs = [];

const RUN = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("check_docs", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
rows = {key: tuple(value) for key, value in json.loads(sys.argv[3]).items()}
module.check_plan(sys.argv[2], rows)
print(json.dumps([line for line in module.failures if "now-items" in line]))
`;

/** The now-items failures for a PLAN.md whose Now section is `now`, given each package's status. */
function nowFailures(now, statuses) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'emberglass-plan-'));
  dirs.push(root);
  writeFileSync(path.join(root, 'PLAN.md'), `# PLAN\n\n## Now\n\n${now}\n\n## Next\n\n- None.\n`);
  const rows = Object.fromEntries(Object.entries(statuses).map(([id, status], n) => [id, [n + 1, status, 'x']]));
  const run = spawnSync('python3', ['-c', RUN, script, root, JSON.stringify(rows)], { encoding: 'utf8' });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('check-docs now-items', () => {
  it('accepts an empty Now with a None line once every package is done', () => {
    expect(nowFailures('- None: every package is done.', { 'AAA-01': 'done', 'BBB-02': 'done' })).toEqual([]);
  });

  it('refuses an empty Now while a package is not done, None line or not', () => {
    const statuses = { 'AAA-01': 'done', 'BBB-02': 'in progress' };
    expect(nowFailures('- None: every package is done.', statuses)).toEqual([
      expect.stringContaining('no `### <PACKAGE-ID>` item under Now'),
    ]);
  });

  it('refuses an empty Now without a None line even when every package is done', () => {
    expect(nowFailures('Nothing here.', { 'AAA-01': 'done' })).toEqual([
      expect.stringContaining('no `### <PACKAGE-ID>` item under Now'),
    ]);
  });

  it('still refuses a done package as a Now item, and accepts one that is not done', () => {
    expect(nowFailures('### AAA-01 — Something', { 'AAA-01': 'done' })).toEqual([
      expect.stringContaining('AAA-01 is already `done`'),
    ]);
    expect(nowFailures('### AAA-01 — Something', { 'AAA-01': 'in progress' })).toEqual([]);
  });
});
