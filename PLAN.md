# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### SRV-02 — PIN, DM session and guessing protection

- **Outcome:** a DM can set the PIN only from the server machine, enter it from any LAN browser to get a DM session that lasts until restart, change it (ending every other session), sign a browser out, and reset it with `npm run reset-pin`; every `/api` route but PIN entry and setup refuses a request without a DM session.
- **Specs:** `13` §4 SRV-02, `07` §1, `07` §2, `07` §6, `07` §7, `07` §8, `02` §5, `09` §2; D-076.
- **State:** implemented; every local acceptance criterion ran and passed on 2026-09-24 (the SRV-02 row of `TRACEABILITY.md` names the tests, the mutations and the live run). G-005 and G-006 are closed; G-008 is left with its README half for REL-01.
- **Acceptance still to run (executable):**
  - `make verify` exit 0 on both CI runners, from a pull request of this change: all 23 jobs green on `ubuntu-latest` and `windows-latest`, the `test` job including `server/src/http/auth.test.ts` (it spawns `npm run reset-pin`, which on Windows goes through `shell: true`).
  - Review (prompt 2), because `Surfaces: data, security`, `Touches red line: yes`, `Contract change: yes`: correctness, security and isolation, and tests passes; no critical or high finding left open.
  - Then the SRV-02 row of `TRACEABILITY.md` moves to `done` with the run links, and this item leaves the plan.
- **Non-goals:** the DM view screens for PIN entry and settings (PRP-01, REL-01), changing the other settings over REST (REL-01), WebSocket handshake checks (LIV-01), README text on transport exposure and backups (REL-01).

## Next

1. **SRV-03 — Campaigns, sessions and scenes over REST.** CRUD, ordering (two-step reorder under the unique order, D-075), duplication and cascading deletion with confirmation, reading and writing through explicit column lists (`13` §4, `02` §5, `03` §5, `03` §7).
2. **SRV-04 — Image upload pipeline.** PNG, JPEG and WebP judged by content under the configurable limit, a rejection storing nothing, sha256 identity with duplicate reuse, WebP display and thumbnail variants that validate against `ImageVariantsSchema` (G-009) (`13` §4, `05` §6, `05` §7, `03` §7).
3. **SRV-05 — Asset library over REST.** Search and tag filter, create, update, delete refused while in use with the scenes listed, tag case decided (G-009) (`13` §4, `05` §1, `05` §2, `05` §4, `05` §5).
