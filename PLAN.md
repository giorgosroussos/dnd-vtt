# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### FND-04 — Design, accessibility and localization foundation

- **Outcome:** the DM view at `/dm` and the player view at `/` as real shells built from shared tokens and base components, with focus and error patterns; every UI string in one English message catalogue; a keyboard-operability smoke test wired as a real gate; every font and icon bundled locally.
- **Specs:** `13` §3 FND-04, `02` §2 (views and routes), `08` §6 (language and catalogue), `08` §8 (keyboard and contrast), `02` §6 (offline, bundled assets); decisions D-014, D-031, D-053.
- **Dependencies:** FND-03 (merged after the pull request from `fnd-03-api-ws-conventions`).
- **Acceptance (executable):**
  - Vitest: the message catalogue is the only source of UI text; a test fails on a string literal rendered as UI text outside it.
  - Playwright: both shells load from the production build; the keyboard smoke test reaches and operates every interactive element of the DM shell by keyboard alone, with a visible focus indicator. It runs inside `make e2e`, so CI blocks on it.
  - Playwright: loading both views requests nothing but the local origin. This is not the `offline-e2e` or `external-url-build` gate of REL-02, which stay tripwires.
  - `make verify` exit 0 on both CI runners; `TRACEABILITY.md` FND-04 row with test names.
- **Non-goals:** DM workspace layout and navigation (PRP-01), canvas (PRP-02), any REST or WebSocket use, the Connect-a-screen panel (LIV-03).
- **Review:** `Touches red line: yes`, so prompt 2 (review) runs after implementation.
- **Status (2026-09-24):** implemented on branch `fnd-04-design-foundation`, and every local acceptance runs and passes (`TRACEABILITY.md` FND-04, `in progress`). Reviewed (prompt 2) the same day: no critical or high finding, the local findings fixed, one deferred as G-007. Remaining: `make verify` green on both CI runners once the branch is pushed. Then the item is removed and SRV-01 becomes `Now`.
- **Phase 0 exit:** the owner accepted in-process evidence for "a rejected WebSocket command arrives in the shared envelope" (D-068); the over-the-wire proof belongs to LIV-01.

## Next

1. **SRV-01 — Schema and migrations.** The eight entities as the first numbered migrations through the FND-01 runner (`13` §4, `03` §1, `03` §3, `03` §6).
2. **SRV-02 — PIN, DM session and guessing protection.** Loopback-only first-run setup, PIN change ending other sessions, `npm run reset-pin`, per-client lockout, Origin checks, a DM session on every `/api` route but PIN entry and setup, checked in `onRequest` before parsing (G-005), rejected-request log lines limited per client (G-006) (`13` §4, `07` §1, `07` §2, `07` §6, `07` §7, `02` §5).
3. **SRV-03 — Campaigns, sessions and scenes over REST.** CRUD, ordering, duplication and cascading deletion with confirmation (`13` §4, `02` §5, `03` §5, `03` §7).
