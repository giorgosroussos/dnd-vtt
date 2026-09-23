# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### FND-01 — Command contract and repository scaffold

- **Outcome:** every target in the root `Makefile` is real, a fresh clone boots and verifies with one command, and the repository layout of the architecture spec exists.
- **Specs:** `13` §3 FND-01, `02` §1 (layout), `10` §1–2 (test layers and gates the contract must expose).
- **Dependencies:** none. This is the first package.
- **Scope:** Create the `server`, `client` and `shared` npm workspaces, the `e2e` Playwright project and the layout of `02` §1, with Node 24 pinned (`09` §1). There is no local infrastructure: `infra-up`, `infra-status` and `infra-down` succeed and say so. Replace every failing placeholder body in the `Makefile` with the real command; keep `make check-docs` as it is. Record tooling choices (test runner, formatter, static analysis, generators) as `decision-added` events with alternatives, then `make rebuild-decisions`.
- **Non-goals:** CI (FND-02); any domain code; any endpoint beyond what `make smoke` needs to prove the processes start.
- **Acceptance (executable):**
  - `make help` lists every target of `AGENTS.md` "Commands" and none exits with the "not implemented" message.
  - `make setup && make infra-up && make migrate && make verify` exit 0 from a fresh clone; `make verify` runs lint, format-check, typecheck, test, e2e, build and check-docs.
  - `make test` runs integration tests against a real SQLite file in a temporary data directory (`10` §2), never a mock; a test proves it.
  - `make smoke` exit 0 against the processes `make dev` starts.
  - `make clean-start` exit 0 from an empty data directory to teardown.
  - `make check-docs` exit 0; `TRACEABILITY.md` FND-01 row set to `done` with the commands and their results as evidence; G-001 narrowed accordingly.

## Next

1. **FND-02 — CI baseline.** Every job runs one `Makefile` target on Linux and Windows runners, `check-docs` as its own job, tripwires for gates not yet implemented (`13` §3, `10` §1, `10` §4).
2. **FND-03 — API and WebSocket conventions.** `/api` base path with schema validation and one error envelope, typed Socket.io envelopes with versions in `shared`, structured logging with its exclusions (`13` §3, `02` §5, `04` §5, `07` §8).
3. **FND-04 — Design, localization and keyboard foundation.** View shells at `/dm` and `/`, English message catalogue, keyboard smoke gate, bundled fonts and icons (`13` §3, `08` §6, `08` §8, `02` §6).
