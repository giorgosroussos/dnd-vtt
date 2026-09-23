# TRACEABILITY

Implementation status and evidence per work package (`specs/13-implementation-plan.md`) and per critical journey (`specs/10-testing-acceptance.md` §5). Status values: `not started`, `in progress`, `done`. Status is set only from evidence that ran and passed; never from plans, file presence or stubs. `make check-docs` verifies that every package has exactly one row and that `done` rows carry evidence. The product-intent scope matrix is `specs/11-traceability.md`.

## Work packages

| Package | Phase | Outcome | Key specs | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| FND-01 | 0 | Command contract and repository scaffold | `02` §1, `09` §1 | done | 2026-09-23, Linux (WSL2), Node 24.11.0. `make clean-start` exit 0: a copy of the working tree with an empty temporary data directory ran setup (`npm ci`), infra-up, migrate, verify, then `make smoke` against `make dev`, and was removed. `make verify` exit 0: lint, format-check, typecheck, `make test` (51 Vitest tests, among them `server/src/db/migrate.test.ts` "migrateDataDirectory against a real SQLite file" in a temporary data directory, and `server/src/http/app.test.ts` "answers 404 at /api/…"), `make e2e` (2 Playwright tests in `e2e/tests/views.spec.ts`: a DM context and a player context against the production build), build, check-docs. `make smoke` exit 0 against `make dev` and against `npm start`. `make audit` found 0 vulnerabilities. `make scan-secrets` exit 0, and exit 1 with a planted GitHub token. `make help` lists all 25 targets of AGENTS.md "Commands"; `make infra-up`, `infra-status` and `infra-down` exit 0. `npm start` and `make test` refuse Node 22 and Node 12 with a message. |
| FND-02 | 0 | CI baseline | `10` §4, `10` §2 | done | 2026-09-23, pull request https://github.com/giorgosroussos/dnd-vtt/pull/1, `.github/workflows/ci.yml`. Green: https://github.com/giorgosroussos/dnd-vtt/actions/runs/35906565756 (commit `ed05102`) and https://github.com/giorgosroussos/dnd-vtt/actions/runs/35907555101 (commit `1649fa8`, the same tree): all 23 jobs passed, each running one `make <target>`: `lint`, `format-check`, `typecheck`, `test` (67 Vitest tests against real SQLite files in temporary data directories), `e2e` (2 Playwright tests, DM and player contexts against the production build), `build`, `check-docs`, `audit`, `scan-secrets` on `ubuntu-latest` and on `windows-latest` (MSYS2 `make`, native Node 24), plus the five tripwire jobs, each printing "gate ABSENT" and its promotion condition. Red: https://github.com/giorgosroussos/dnd-vtt/actions/runs/35907022399 (commit `88f76c3`, a deliberately failing `shared/src/deliberate-failure.test.ts`) turned `test · linux` and `test · windows` red on that assertion while the other 21 jobs passed; reverted in `1649fa8`. Earlier red runs found and fixed three real defects: `make build` on a fresh checkout (missing project reference to `shared`), a POSIX-only path in `server/src/config.test.ts`, and Vite's dev-server close hanging during its first dependency optimization. Local: actionlint with shellcheck exit 0; a planted `@gate:hidden-information` marker turned `make tripwire GATE=hidden-information` red with promotion steps. Branch protection, 2026-09-23: ruleset 23898009 on `main`, read back from `GET /repos/giorgosroussos/dnd-vtt/rules/branches/main`, requires all 23 checks by name (the 18 gate jobs and the 5 tripwires) and blocks force pushes and deletion, so a red pipeline blocks a merge. Review (prompt 2), 2026-09-23: no critical or high finding; the medium and low findings were fixed (D-060, D-061 supersede D-058, D-059): the tripwire scans every text file, not only JavaScript and TypeScript; `scripts/ci-consistency.test.mjs` ties the `verify` prerequisites, both CI matrices, the tripwire registry and `README.md` together and fails when a required gate is neither a tripwire nor present (each checked by a deliberate mutation that turned it red); secretlint runs without `cmd.exe`; the Vite close wait is bounded; checkout no longer persists the token. After the fixes, locally: `make verify` exit 0 with 82 Vitest tests (29 in `scripts/`) and 2 Playwright tests, `make audit`, `make scan-secrets` (a planted token in `planted a%OS%b & c.txt` exits 1), `make tripwire` and actionlint exit 0; on GitHub, https://github.com/giorgosroussos/dnd-vtt/actions/runs/35911745219 (commit `1b98c60`) green on all 23 jobs. Not covered here: `make dev` and `make clean-start` on Windows (G-003). |
| FND-03 | 0 | API and WebSocket conventions | `02` §5, `04` §2, `04` §3, `04` §5 | in progress | Every acceptance criterion has evidence below; `in progress` only until the review (prompt 2) runs, which blocks merge (`14` §7). 2026-09-24, pull request from branch `fnd-03-api-ws-conventions`. Green: https://github.com/giorgosroussos/dnd-vtt/actions/runs/35927265858 (commit `6046a65`): all 23 jobs passed, `lint`, `format-check`, `typecheck`, `test`, `e2e`, `build`, `check-docs`, `audit`, `scan-secrets` on `ubuntu-latest` and `windows-latest`, plus the five tripwires (gates absent). Review (prompt 2) has not run yet; it is the remaining `PLAN.md` item before merge. Locally, Linux (WSL2), Node 24.11.0: `make verify` exit 0: lint, format-check, typecheck, `make test` (149 Vitest tests), `make e2e` (2 Playwright tests), build, check-docs. REST envelope and validation: `server/src/http/errors.test.ts` "answers an unknown /api path with 404 in the envelope", "answers a body with %s with 400 validation_failed and changes nothing" (wrong type, string not coerced, missing field, unknown field not stripped, below minimum), "answers malformed and empty JSON with 400 malformed_body", "answers an unsupported media type with 415", "answers a server failure with 500 internal_error and no detail of the failure", each response checked against `ErrorEnvelopeSchema` exported from `shared`; `server/src/http/app.test.ts` "answers 404 at %s in the error envelope". Commands and versions: `server/src/domain/commands.test.ts` "rejects %s in the error envelope and changes nothing" (12 cases: the target state deep-equal before and after, the apply step never called, the version counter not advanced), "refuses %s as unsupported" for all ten command types; `server/src/domain/version.test.ts` "starts at 1 and strictly ascends by one"; `shared/src/live.test.ts` checks the command and event names against the tables of `04` §2 and §3. Logging against a real temporary data directory: `server/src/log/logger.test.ts` (console and `logs/emberglass.log`, rotation keeping exactly `.1`–`.3`, redaction); `server/src/http/errors.test.ts` "keeps a PIN, a session cookie and a session identifier out of the console and the log file", which turned red when the string scrubbing was disabled as a deliberate mutation. `make audit` 0 vulnerabilities; `make scan-secrets` exit 0; `make tripwire` all five gates absent. `make smoke` exit 0 against `make dev` (`.dev-data/logs/emberglass.log` received `server.started`) and against the production build started with a temporary data directory, whose log file received `server.started` and a redacted `http.rejected` line. |
| FND-04 | 0 | Design, accessibility and localization foundation | `02` §2, `08` §6, `08` §8, `02` §6 | not started | — |
| SRV-01 | 1 | Schema and migrations | `03` §1, `03` §2, `03` §3, `03` §6 | not started | — |
| SRV-02 | 1 | PIN, DM session and guessing protection | `07` §1, `07` §2, `07` §6, `07` §7 | not started | — |
| SRV-03 | 1 | Campaigns, sessions and scenes over REST | `03` §7, `03` §5 | not started | — |
| SRV-04 | 1 | Image upload pipeline | `05` §6, `05` §7, `03` §7 | not started | — |
| SRV-05 | 1 | Asset library over REST | `05` §1, `05` §2, `05` §4, `05` §5 | not started | — |
| PRP-01 | 2 | DM workspace shell | `08` §1, `07` §1 | not started | — |
| PRP-02 | 2 | Canvas and grid overlay | `08` §3, `06` §2, `03` §6 | not started | — |
| PRP-03 | 2 | Grid calibration | `06` §1, `06` §2, `06` §3 | not started | — |
| PRP-04 | 2 | Tokens in preparation | `05` §3, `05` §4, `05` §5, `06` §4 | not started | — |
| LIV-01 | 3 | WebSocket rooms, snapshots and reconnection | `04` §1, `04` §5, `04` §6 | not started | — |
| LIV-02 | 3 | Live commands and role projection | `04` §2, `04` §3, `04` §4, `07` §5 | not started | — |
| LIV-03 | 3 | Player view and connecting a screen | `08` §4, `08` §9, `08` §5 | not started | — |
| LIV-04 | 3 | Live and prep modes | `08` §2, `04` §2, `04` §10 | not started | — |
| LIV-05 | 3 | Undo | `04` §8 | not started | — |
| LIV-06 | 3 | Cameras | `04` §9 | not started | — |
| LIV-07 | 3 | Ruler | `06` §5, `04` §11 | not started | — |
| REL-01 | 4 | Operations and repository documents | `09` §1, `09` §2, `09` §5, `09` §6 | not started | — |
| REL-02 | 4 | Acceptance suite and system matrix | `10` §3, `10` §5, `10` §6, `10` §4 | not started | — |
| REL-03 | 4 | Acceptance on the owner's TV | `10` §4, `05` §7 | not started | — |

## Critical end-to-end journeys (`10` §5)

| # | Journey | Status | Evidence |
| --- | --- | --- | --- |
| 1 | First run | not started | — |
| 2 | Prepare | not started | — |
| 3 | Connect TV | not started | — |
| 4 | Run | not started | — |
| 5 | Recover | not started | — |

## Phase exit criteria

Phase exit criteria are in `specs/13-implementation-plan.md` §3–7. A phase is exited only when every package in it is `done` here and its exit criteria have recorded evidence. No phase has been entered.

## Reproducing the evidence

From a clone, with Node 24 or newer on PATH (`nvm use` reads `.nvmrc`):

```bash
make setup        # dependencies from lockfiles, env examples
make infra-up     # no local services; succeeds and says so
make migrate
make verify       # lint, format-check, typecheck, test, e2e, build, check-docs
make dev          # in another terminal; then:
make smoke
make audit        # the CI dependency-scan gate
make scan-secrets # the CI secret-scan gate
make tripwire     # the CI tripwire jobs, all five gates
make check-docs   # needs Python 3 only
```

`make clean-start` runs the same sequence from a fresh environment and tears it down afterwards. Evidence recorded in this file names the command, the date and what it proved; a reviewer must be able to repeat it from this section.
