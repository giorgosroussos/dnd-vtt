# Emberglass

A free, self-hosted virtual tabletop for in-person play, compatible with 5th edition (SRD 5.1): the DM prepares sessions as series of scenes and runs them on a TV or projector from a server on their own PC. It is not a remote-play platform, a character manager or a map maker. Licensed under AGPL-3.0.

Status: **Phase 0 in progress.** The command contract and repository scaffold (FND-01) are done: every `make` target runs, and the server serves two empty views. The CI pipeline (FND-02) runs every gate on Linux and Windows. No product feature exists yet; the next work package is in `PLAN.md`.

Development needs Node.js 24 or newer (`nvm use` reads `.nvmrc`) and Python 3 for the documentation gates.

```bash
make setup        # npm ci, Playwright's Chromium, .env from .env.example
make verify       # lint, format-check, typecheck, test, e2e, build, check-docs
make dev          # the server with Vite on http://localhost:3000 (player view /, DM view /dm)
make smoke        # checks a running server
make help         # the full command contract
```

- Agents and contributors start at `AGENTS.md`. Ready-made session prompts: `SESSION_BOOTSTRAP_PROMPT_SAMPLE.md`.
- Specifications: `specs/README.md` (map, requirement language, conflict resolution).
- Raw requirements and their authority: `docs/inputs/README.md`.
- Current work, decisions, gaps, open questions and evidence: `PLAN.md`, `DECISIONS.md`, `GAPS.md`, `QUESTIONS.md`, `TRACEABILITY.md`.

## Continuous integration

GitHub Actions, `.github/workflows/ci.yml` (FND-02, `specs/13-implementation-plan.md` §3; D-060, D-061), on every pull request, every push to `main` and on demand. Every job runs exactly one root `Makefile` target, so a gate cannot pass in CI and fail locally: to reproduce a red job, run its command. Before it, a job only provisions the machine (checkout, Node from `.nvmrc`, `make setup`; on Windows also MSYS2 for `make` and bash). No job retries.

| Job | Runners | Command |
| --- | --- | --- |
| `lint · linux`, `lint · windows` | `ubuntu-latest`, `windows-latest` | `make lint` |
| `format-check · linux`, `format-check · windows` | both | `make format-check` |
| `typecheck · linux`, `typecheck · windows` | both | `make typecheck` |
| `test · linux`, `test · windows` | both | `make test` |
| `e2e · linux`, `e2e · windows` | both | `make e2e` |
| `build · linux`, `build · windows` | both | `make build` |
| `check-docs · linux`, `check-docs · windows` | both | `make check-docs` |
| `audit · linux`, `audit · windows` | both | `make audit` |
| `scan-secrets · linux`, `scan-secrets · windows` | both | `make scan-secrets` |
| `tripwire · hidden-information (absent)` | `ubuntu-latest` | `make tripwire GATE=hidden-information` |
| `tripwire · offline-e2e (absent)` | `ubuntu-latest` | `make tripwire GATE=offline-e2e` |
| `tripwire · external-url-build (absent)` | `ubuntu-latest` | `make tripwire GATE=external-url-build` |

A tripwire job stands in for a gate that `specs/10-testing-acceptance.md` §3 or §6 requires and nothing implements yet. It passes only while the gate is provably absent, meaning no code file carries the marker `@gate:<id>`, and says so in its name and output; it is never the gate. The first test or build check that carries the marker turns the job red, with the promotion steps: run the gate inside a real gate target, then remove its job here and its entry in `scripts/tripwire.mjs`.

`make verify` runs the first seven gate commands; `make audit`, `make scan-secrets` and `make tripwire` run beside it. Caches (npm, Playwright browsers) are keyed on `package-lock.json`, and a failed `e2e` job keeps `e2e/test-results/` as an artifact for seven days. A ruleset on `main` requires every job above by name, so a red pipeline blocks a merge; it lives on GitHub, not in this repository. Promoting a tripwire removes its job, so the same change must remove that job from the ruleset's required checks, or GitHub waits for a check that never runs.

Stack: Node.js 24 LTS (one process), TypeScript, Fastify, Socket.io, SQLite (better-sqlite3), sharp, React with react-konva, Vite; Vitest and Playwright.
