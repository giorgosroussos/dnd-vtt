# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### FND-02 — CI baseline

- **Outcome:** a GitHub Actions pipeline in which every job runs exactly one root `Makefile` target, on Linux and Windows runners, so "CI is green" and "`make verify` is green" are the same statement.
- **Specs:** `13` §3 FND-02, `10` §1 (gates), `10` §2 (real SQLite file), `10` §4 (Windows and Linux), `12` §4 (GitHub and GitHub Actions, Q-066).
- **Dependencies:** FND-01 (done). The public repository `giorgosroussos/dnd-vtt` is the `origin` remote.
- **State:** written and verified locally (`TRACEABILITY.md` FND-02; D-058, D-059): `.github/workflows/ci.yml` with nine gate jobs on each runner and five tripwire jobs, `make tripwire`, `README.md` "Continuous integration". No run on GitHub yet: nothing has been pushed.
- **Remaining (executable):**
  - Push a branch and open a pull request; every job runs green on both runners, each job's command a single `make <target>`. Any Windows failure is fixed in the target, never by a CI-only workaround.
  - On a throwaway branch, a deliberately failing Vitest test turns `test · linux` and `test · windows` red; the branch is then deleted.
  - Each tripwire job passes and prints its promotion condition (already true locally).
  - `TRACEABILITY.md` FND-02 row `done` with the run URLs; G-003 narrowed to `dev` and `clean-start`; `make check-docs` exit 0.
  - The owner turns on branch protection for `main` requiring the CI jobs (G-004).
- **Non-goals:** any product code; the browser matrix of `10` §4 (REL-02).
- **Review:** `Touches red line: yes`, so prompt 2 (review) runs after the remote runs are green.

## Next

1. **FND-03 — API and WebSocket conventions.** `/api` base path with schema validation and one error envelope, typed Socket.io envelopes with versions in `shared`, structured logging with its exclusions (`13` §3, `02` §5, `04` §5, `07` §8).
2. **FND-04 — Design, localization and keyboard foundation.** View shells at `/dm` and `/`, English message catalogue, keyboard smoke gate, bundled fonts and icons (`13` §3, `08` §6, `08` §8, `02` §6).
3. **SRV-01 — Schema and migrations.** The eight entities as the first numbered migrations through the FND-01 runner (`13` §4, `03` §1, `03` §3, `03` §6).
