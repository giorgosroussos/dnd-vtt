# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### FND-03 — API and WebSocket conventions

- **Outcome:** the conventions every later package builds on: REST under `/api` with bodies validated against schemas derived from `shared` and one error envelope, typed and versioned Socket.io command and event envelopes in `shared`, and structured logging that never records a credential.
- **Specs:** `13` §3 FND-03, `02` §5 (REST base path, schemas, DM session on every route but PIN entry and setup), `04` §2 (commands, rejection outside `dm`), `04` §3 (events), `04` §5 (version counter), `07` §8 and `09` §6 (logging); decisions D-015, D-029, D-035, D-047.
- **Dependencies:** FND-02, PR #1 merged after its review pass (prompt 2), which has not run yet.
- **Scope:** the error envelope and schema derivation as shared types plus a Fastify error handler; command and event envelope types with a version field and a per-process counter starting at 1; a validation function that rejects an invalid command in the envelope and changes nothing; the logger writing console lines and `logs/emberglass.log` in the data directory (JSON lines, 5 MB rotation, three old files) with PIN, session identifier and cookie redacted. No REST resource, no Socket.io room or command handler yet (SRV and LIV packages).
- **Acceptance (executable):**
  - Vitest: an unknown `/api` path and a body failing its schema both answer in the one error envelope with the right status; the envelope type is exported from `shared` and used by server and tests.
  - Vitest: a command envelope failing its schema is rejected in the error envelope and the state it targets is unchanged; the version counter starts at 1 and strictly ascends.
  - Vitest against a real temporary data directory: log lines reach console and the rotating file; a request carrying a PIN body field, a session cookie and a session identifier leaves none of them in either output.
  - `make verify` exit 0 on both CI runners; `TRACEABILITY.md` FND-03 row with test names.
- **Non-goals:** DM session and PIN logic (SRV-02), rooms, role projection and reconnection (LIV-01, LIV-02), any REST resource of `02` §5.
- **Review:** `Touches red line: yes` and `Contract change: yes`, so prompt 2 (review) runs after implementation.

## Next

1. **FND-04 — Design, localization and keyboard foundation.** View shells at `/dm` and `/`, English message catalogue, keyboard smoke gate, bundled fonts and icons (`13` §3, `08` §6, `08` §8, `02` §6).
2. **SRV-01 — Schema and migrations.** The eight entities as the first numbered migrations through the FND-01 runner (`13` §4, `03` §1, `03` §3, `03` §6).
3. **SRV-02 — PIN, DM session and guessing protection.** Loopback-only first-run setup, PIN change ending other sessions, `npm run reset-pin`, per-client lockout, Origin checks, a DM session on every `/api` route but PIN entry and setup (`13` §4, `07` §1, `07` §2, `07` §6, `07` §7, `02` §5).
