# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### FND-02 — CI baseline

- **Outcome:** a GitHub Actions pipeline in which every job runs exactly one root `Makefile` target, on Linux and Windows runners, so "CI is green" and "`make verify` is green" are the same statement.
- **Specs:** `13` §3 FND-02, `10` §1 (gates), `10` §2 (real SQLite file), `10` §4 (Windows and Linux), `12` §4 (GitHub and GitHub Actions, Q-066).
- **Dependencies:** FND-01 (done). The public GitHub repository of Q-066 must exist and be the `origin` remote; none is configured in this clone yet, and creating it is the owner's act.
- **Scope:** a workflow triggered on every pull request and every push to the default branch; one job per target (`lint`, `format-check`, `typecheck`, `test`, `e2e`, `build`, `check-docs`, `audit`, `scan-secrets`) on `ubuntu-latest` and `windows-latest`, `check-docs` as its own job; npm and Playwright caches keyed on the lockfile; no job retries. Failing-forward tripwires for the gates `10` §3 and `10` §6 require and nothing implements yet (hidden-information suite, player-command rejection, offline end-to-end run, external-URL build check): each passes only while its gate is provably absent and fails with promotion instructions once it becomes runnable. `README.md` maps job to command. Close or narrow G-003 by making the Windows jobs run the targets.
- **Non-goals:** any product code; the browser matrix of `10` §4 (REL-02); branch protection settings on the remote beyond recording what is required.
- **Acceptance (executable):**
  - The pipeline runs green on a pull request on both runners; each job's command is a single `make <target>`.
  - A deliberately failing test on a branch turns the `test` job red.
  - Each tripwire job passes today and its promotion condition is stated in the job.
  - `make check-docs` exit 0; `README.md` "Continuous integration" maps every job; `TRACEABILITY.md` FND-02 row `done` with the run URLs as evidence.
- **Review:** `Touches red line: yes`, so prompt 2 (review) runs after implementation.

## Next

1. **FND-03 — API and WebSocket conventions.** `/api` base path with schema validation and one error envelope, typed Socket.io envelopes with versions in `shared`, structured logging with its exclusions (`13` §3, `02` §5, `04` §5, `07` §8).
2. **FND-04 — Design, localization and keyboard foundation.** View shells at `/dm` and `/`, English message catalogue, keyboard smoke gate, bundled fonts and icons (`13` §3, `08` §6, `08` §8, `02` §6).
3. **SRV-01 — Schema and migrations.** The eight entities as the first numbered migrations through the FND-01 runner (`13` §4, `03` §1, `03` §3, `03` §6).
