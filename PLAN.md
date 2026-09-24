# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### FND-03 — Review before merge (prompt 2)

- **Outcome:** the FND-03 pull request (branch `fnd-03-api-ws-conventions`) reviewed and merged. Implementation and acceptance evidence are complete (CI run 35927265858 green on Linux and Windows); `TRACEABILITY.md` FND-03 moves from `in progress` to `done` when the review passes.
- **Specs:** `14` §7 (review passes), `13` §3 FND-03, `07` §7, `07` §8; decisions D-063, D-064, D-066, D-067.
- **Why a review:** `Touches red line: yes` and `Contract change: yes` (`AGENTS.md` "Prompt selection").
- **Acceptance (executable):**
  - Done 2026-09-24: bounded passes for correctness, security and isolation, and tests; both high findings and the medium and local low ones fixed with tests (D-066, D-067); two deferred to SRV-02 (G-005, G-006). No critical or high finding open.
  - Remaining: CI green on the pull request for the fix commit, recorded in `TRACEABILITY.md` (FND-03 moves to `done` and leaves this plan), then merge to `main`.
- **Non-goals:** new behaviour beyond fixes to findings.

## Next

1. **FND-04 — Design, localization and keyboard foundation.** View shells at `/dm` and `/`, English message catalogue, keyboard smoke gate, bundled fonts and icons (`13` §3, `08` §6, `08` §8, `02` §6).
2. **SRV-01 — Schema and migrations.** The eight entities as the first numbered migrations through the FND-01 runner (`13` §4, `03` §1, `03` §3, `03` §6).
3. **SRV-02 — PIN, DM session and guessing protection.** Loopback-only first-run setup, PIN change ending other sessions, `npm run reset-pin`, per-client lockout, Origin checks, a DM session on every `/api` route but PIN entry and setup (`13` §4, `07` §1, `07` §2, `07` §6, `07` §7, `02` §5).
