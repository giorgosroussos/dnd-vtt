# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### DMT-05

Export and import (`13` §12; `09` §7, §9, `07` §9, `05` §6, `02` §5, `08` §13, `10` §3; Q-115, Q-119, D-181, D-187). A zip of format 1 (`manifest.json`, `data/*.json`, `images/<sha256>.<ext>`) for a campaign or library assets, streamed out by `GET /api/export/campaigns/:id` and `GET /api/export/assets`; `POST /api/import` reading it from its central directory with every refusal of `07` §9 storing nothing, a campaign always a new copy, images reused by hash, assets by identifier; migration 0013 adds the import limit, 2 GB, in Settings; Export, Import and the library's selection mode in the DM view. Acceptance: `server/src/http/archive.test.ts` (the export and import test of `10` §3 and every refusal with the database file and the images folder unchanged byte for byte), `shared/src/archive.test.ts`, `client/src/dm/archive/Archive.test.tsx`, `e2e/tests/archive.spec.ts` (a campaign with a running combat imported on a second data directory and played there; the large-scene fixture's round trip). Implemented and green locally (TRACEABILITY.md); left: CI on the pull request and prompt 2 (review), whose findings are fixed on the branch before DMT-05 is done.

### DMT-04

DM notes (`13` §12; `02` §5, `03` §1, `03` §7, `03` §10, `04` §2, `04` §3, `04` §4, `04` §16, `08` §13, `10` §3; Q-114, D-181, D-186). Migration 0012 adds `notes` to scenes and tokens, empty by default, at most 20,000 characters; `PUT /api/scenes/:id/notes` and `PUT /api/tokens/:id/notes` on any scene, live included, not undoable, the live scene's telling the DM room alone by `notes.updated`; a duplicated scene copying its notes and its tokens' (with their hit points); the DM view saving as typed with nothing typed ever lost, the Notes tab and N, a token's notes in its popover beside its asset's, the marks on the map, the rows and the scene list, and the turn's initiative row opening them. Acceptance: `server/src/ws/notes.test.ts` covers the REST edits on a live and a prepared scene, `notes.updated` reaching only the DM room and the duplication; the hidden-information suite passes with notes in its script and finds none in any player message; `client/src/dm/notes/*.test.tsx` cover the autosave, a failed save, the limit, another window's change and text-only rendering; `e2e/tests/notes.spec.ts` with a DM and a player context. Implemented and green locally (TRACEABILITY.md); left: CI on the pull request and prompt 2 (review), whose findings are fixed on the branch before DMT-04 is done.

### DMT-01 to DMT-03

Hit points and armour class (D-182), per-enemy initiative (D-183, D-184) and Follow my view (Q-120, D-185) are implemented and green locally, their acceptance as `13` §12 states it and their evidence in TRACEABILITY.md. Each waits for what DMT-04 waits for: CI on the pull request of `feat/dm-toolkit` and prompt 2 (review), whose findings are fixed on the branch before the package is done.

Owed by hand, before the 1.0.0 release:

- the acceptance run on the owner's LG TV (D-151, G-043 with G-002, G-031 and G-040), following `docs/acceptance/rel-03-owner-run.md`;
- the install in Windows Sandbox from a release candidate (D-178, G-046), following `docs/acceptance/pkg-03-sandbox-run.md`.

## Next

- None: DMT-05 is the last package of Phase 7, the last phase planned. After the review and CI of `feat/dm-toolkit`, the owner decides whether the DM toolkit ships before 1.0.0 (D-181).
