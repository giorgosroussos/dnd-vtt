# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### SRV-01 — Schema and migrations

- **Outcome:** the eight entities of `03` §1 as the first numbered SQL migrations, applied by the FND-01 runner at start-up and by `make migrate`, with their contract types in `shared`.
- **Specs:** `13` §4 SRV-01, `03` §1 (entities), `03` §2 (relationships, nullable map, order), `03` §3 (UUIDs from the server, Image keyed by sha256), `03` §4 (positions in decimal grid units), `03` §6 (map-less extent, 30 × 20 default), `03` §8 (prepared fields), `09` §2 (migrations at start after a dated backup), `14` §8 (additive, UUID-only keys, fixture database).
- **Dependencies:** Phase 0 (FND-01 to FND-04 done).
- **Acceptance (executable):**
  - Vitest against a real SQLite file in a temporary data directory: a fresh database migrates to the eight tables with the fields, foreign keys and orders of `03` §1–§2; a second run applies nothing and changes nothing.
  - Constraints refuse what the specs forbid: a token without a scene or asset, a `grid.type` other than `square`, a `rules_version` other than `5e-2014`, a non-empty `character_id`; a scene without a map stores `columns` × `rows`, defaulting to 30 × 20; token `x`/`y` keep decimal grid units.
  - Keys are UUIDs, with Image keyed by sha256; no sequential key column exists (`14` §8).
  - Migrations run on the generated fixture database; `make verify` exit 0 on both CI runners; `TRACEABILITY.md` SRV-01 row with test names.
- **Non-goals:** REST resources (SRV-03, SRV-05), PIN storage behaviour (SRV-02), upload pipeline (SRV-04).
- **Review:** `Surfaces: data`, `Touches red line: yes`, `Contract change: yes`, so prompt 2 (review) runs after implementation.
- **Remaining (2026-09-24):** implemented and verified locally (`TRACEABILITY.md` SRV-01, D-074), not yet committed. Still open: CI green on both runners for the pull request, then the review (prompt 2), whose critical and high findings block `done`.

## Next

1. **SRV-02 — PIN, DM session and guessing protection.** Loopback-only first-run setup, PIN change ending other sessions, `npm run reset-pin`, per-client lockout, Origin checks, a DM session on every `/api` route but PIN entry and setup, checked in `onRequest` before parsing (G-005), rejected-request log lines limited per client (G-006) (`13` §4, `07` §1, `07` §2, `07` §6, `07` §7, `02` §5).
2. **SRV-03 — Campaigns, sessions and scenes over REST.** CRUD, ordering, duplication and cascading deletion with confirmation (`13` §4, `02` §5, `03` §5, `03` §7).
3. **SRV-04 — Image upload pipeline.** PNG, JPEG and WebP judged by content under the configurable limit, a rejection storing nothing, sha256 identity with duplicate reuse, WebP display and thumbnail variants (`13` §4, `05` §6, `05` §7, `03` §7).
