# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### FND-03 — API and WebSocket conventions (implemented; CI evidence and review remaining)

- **Outcome:** the conventions every later package builds on: REST under `/api` with bodies validated against schemas derived from `shared` and one error envelope, typed and versioned Socket.io command and event envelopes in `shared`, and structured logging that never records a credential.
- **Specs:** `13` §3 FND-03, `02` §5, `04` §2, `04` §3, `04` §5, `07` §7, `07` §8, `09` §6; decisions D-015, D-017, D-029, D-035, D-047, and D-062 to D-065 which record the implementation.
- **State:** implemented and green locally on 2026-09-24 (`make verify`, `make audit`, `make scan-secrets`, `make tripwire`, `make smoke` against `make dev` and against the production build); evidence and test names in the `TRACEABILITY.md` FND-03 row. Not yet pushed.
- **Remaining acceptance (executable):**
  - `make verify` exit 0 on both CI runners: push the branch, open a pull request, and record the green run (Linux and Windows) in `TRACEABILITY.md`, which then moves FND-03 to `done`.
  - Review (prompt 2), required because `Touches red line: yes` and `Contract change: yes`: bounded passes for correctness, security and isolation (redaction, envelope messages, fail-closed command validation) and tests; no critical or high finding open at merge.
- **Non-goals:** DM session and PIN logic (SRV-02), rooms, role projection and reconnection (LIV-01, LIV-02), any REST resource of `02` §5, command payload schemas and handlers (LIV packages).

## Next

1. **FND-04 — Design, localization and keyboard foundation.** View shells at `/dm` and `/`, English message catalogue, keyboard smoke gate, bundled fonts and icons (`13` §3, `08` §6, `08` §8, `02` §6).
2. **SRV-01 — Schema and migrations.** The eight entities as the first numbered migrations through the FND-01 runner (`13` §4, `03` §1, `03` §3, `03` §6).
3. **SRV-02 — PIN, DM session and guessing protection.** Loopback-only first-run setup, PIN change ending other sessions, `npm run reset-pin`, per-client lockout, Origin checks, a DM session on every `/api` route but PIN entry and setup (`13` §4, `07` §1, `07` §2, `07` §6, `07` §7, `02` §5).
