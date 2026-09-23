// `make tripwire GATE=<id>`: a failing-forward tripwire for a gate the testing
// specification requires and nothing implements yet (specs/13-implementation-plan.md
// §3 FND-02, D-059).
//
// A tripwire passes only while its gate is provably absent, and fails with
// promotion instructions the moment the gate exists, so a missing gate and a
// silently passing gate never look alike. A gate announces itself with the
// marker `@gate:<id>` in the code that implements it: in a Playwright or Vitest
// test title, which also makes `--grep @gate:<id>` select it, or in a comment
// next to a build check. Absence is proven by scanning every code file Git
// tracks or would track, and the scan itself must cover the test roots it
// claims to cover, or the tripwire fails instead of passing on an empty scan.
//
//   node scripts/tripwire.mjs [GATE]     no GATE: every tripwire in turn
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export const GATES = [
  {
    id: 'hidden-information',
    spec: 'specs/10-testing-acceptance.md §3',
    gate: 'a recorded-traffic test proving no hidden token reaches a player view',
    lands: 'LIV-02, REL-02',
  },
  {
    id: 'player-command-rejection',
    spec: 'specs/10-testing-acceptance.md §3',
    gate: 'a test proving every command from the players room is rejected and changes nothing',
    lands: 'LIV-02, REL-02',
  },
  {
    id: 'image-revocation',
    spec: 'specs/10-testing-acceptance.md §3',
    gate: 'a test proving an image a player once fetched is refused after its token is hidden',
    lands: 'LIV-02, REL-02',
  },
  {
    id: 'offline-e2e',
    spec: 'specs/10-testing-acceptance.md §6',
    gate: 'the end-to-end run with outbound traffic beyond the local host blocked',
    lands: 'REL-02',
  },
  {
    id: 'external-url-build',
    spec: 'specs/10-testing-acceptance.md §6',
    gate: 'a build that fails when the client references an external URL for scripts, styles, fonts or images',
    lands: 'REL-02',
  },
];

const CODE_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
// The tripwire and its tests name every marker; they are the registry, not a gate.
const SELF = new Set(['scripts/tripwire.mjs', 'scripts/tripwire.test.mjs']);
// Where the gates will live. A scan that sees no test file in one of these has
// not looked where a gate would be, and proves nothing.
export const REQUIRED_ROOTS = [
  { label: 'Playwright tests', pattern: /^e2e\/tests\/.+\.spec\.ts$/ },
  { label: 'Vitest tests', pattern: /^(?:server|client|shared)\/src\/.+\.test\.tsx?$/ },
];

export function markerFor(id) {
  return `@gate:${id}`;
}

/** Judge one gate over a list of repository paths; `read(path)` returns file text. */
export function evaluate(id, paths, read) {
  const gate = GATES.find((g) => g.id === id);
  if (!gate) {
    return { status: 'error', lines: [`unknown gate "${id}"; known: ${GATES.map((g) => g.id).join(', ')}`] };
  }
  const scanned = paths.filter((p) => CODE_FILE.test(p) && !SELF.has(p));
  const missing = REQUIRED_ROOTS.filter((root) => !scanned.some((p) => root.pattern.test(p)));
  if (missing.length > 0) {
    return {
      status: 'error',
      lines: [
        `tripwire ${id}: cannot prove the gate absent; the scan found no ${missing.map((m) => m.label).join(' and no ')}.`,
        `Scanned ${scanned.length} code files. Run it from the repository root of a checkout.`,
      ],
    };
  }
  const marker = new RegExp(`${markerFor(id).replace(/[-:]/g, '\\$&')}(?![\\w-])`);
  const found = scanned.filter((p) => marker.test(read(p)));
  if (found.length === 0) {
    return {
      status: 'absent',
      lines: [
        `tripwire ${id}: gate ABSENT, as expected today. This job is not the gate.`,
        `  Gate: ${gate.gate} (${gate.spec}); arrives with ${gate.lands}.`,
        `  Proof: ${scanned.length} code files scanned, test roots included; none carries ${markerFor(id)}.`,
        `  Promotion condition: the first code file carrying ${markerFor(id)} turns this job red.`,
      ],
    };
  }
  return {
    status: 'present',
    lines: [
      `tripwire ${id}: gate PRESENT in ${found.join(', ')}. This tripwire has done its job; promote the gate:`,
      `  1. Make the gate run inside a real gate target (\`make e2e\`, \`make test\` or \`make build\`) and fail when it should.`,
      `  2. Remove "${id}" from GATES in scripts/tripwire.mjs and its job from .github/workflows/ci.yml.`,
      `  3. Update README.md "Continuous integration" and the evidence in TRACEABILITY.md in the same change.`,
    ],
  };
}

function repositoryPaths() {
  const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`);
  return [...new Set(listed.stdout.split('\0').filter(Boolean))].filter((p) => existsSync(p));
}

function main(args) {
  const ids = args[0] ? [args[0]] : GATES.map((g) => g.id);
  const paths = repositoryPaths();
  let exitCode = 0;
  for (const id of ids) {
    const result = evaluate(id, paths, (p) => readFileSync(p, 'utf8'));
    const out = result.status === 'absent' ? console.log : console.error;
    for (const line of result.lines) out(line);
    if (result.status !== 'absent') exitCode = 1;
  }
  return exitCode;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
