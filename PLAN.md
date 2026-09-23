# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### FND-03 — Review before merge (prompt 2)

- **Outcome:** the FND-03 pull request (branch `fnd-03-api-ws-conventions`) reviewed and merged. Implementation and acceptance evidence are complete: `TRACEABILITY.md` FND-03 is `done` with CI run 35927265858 green on Linux and Windows.
- **Specs:** `14` §7 (review passes), `13` §3 FND-03, `07` §7, `07` §8; decisions D-062 to D-065.
- **Why a review:** `Touches red line: yes` and `Contract change: yes` (`AGENTS.md` "Prompt selection").
- **Acceptance (executable):**
  - Bounded passes for correctness, security and isolation (redaction in `server/src/log/redact.ts`, generic envelope messages, fail-closed command validation) and tests; findings recorded, no critical or high finding open.
  - Any fix lands with its test, CI green on the pull request again, then merge to `main`.
- **Non-goals:** new behaviour beyond fixes to findings.

## Next

1. **FND-04 — Design, localization and keyboard foundation.** View shells at `/dm` and `/`, English message catalogue, keyboard smoke gate, bundled fonts and icons (`13` §3, `08` §6, `08` §8, `02` §6).
2. **SRV-01 — Schema and migrations.** The eight entities as the first numbered migrations through the FND-01 runner (`13` §4, `03` §1, `03` §3, `03` §6).
3. **SRV-02 — PIN, DM session and guessing protection.** Loopback-only first-run setup, PIN change ending other sessions, `npm run reset-pin`, per-client lockout, Origin checks, a DM session on every `/api` route but PIN entry and setup (`13` §4, `07` §1, `07` §2, `07` §6, `07` §7, `02` §5).
