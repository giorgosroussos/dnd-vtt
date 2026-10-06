# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### UXR-01 to UXR-05

The UI/UX refinements (`13` §13; `01` §11, `08` §14; Q-121 to Q-125, D-188, D-189), on `feat/dm-toolkit`, one commit each, in the order UXR-04, UXR-01, UXR-03, UXR-02, UXR-05: the campaigns menu's icons with tooltips; the scene sidebar collapsing to an edge strip, opened on hover and pinned; a library asset dragged onto the map; several tokens selected with Ctrl and acted on together, `token.batch` one undo step on the live scene (`04` §2, §8); the player view laid out for phones, tablets and large screens, with fullscreen and its own pinch zoom on touch devices without hover (`08` §7, §9). Acceptance: each package's exit in `13` §13; the hidden-information suite with a batch in its script; `e2e/tests/multi-select.spec.ts` and `e2e/tests/player-mobile.spec.ts`. Implemented and green locally (TRACEABILITY.md; `make verify` 1883 unit and 66 end-to-end tests); and on CI: run 37430729480 on `82d0e15` (pull request #34, 2026-10-06) green on all 18 jobs, the package jobs skipped as D-179 has them, `test · windows` on its re-run after an untouched `server/src/launcher.test.ts` timed out at 5 s; left: prompt 2 (review) for UXR-02 and UXR-05 with its findings fixed on the branch, and the real-device run on a phone and a tablet owed by hand (G-053).

### DMT-05

Export and import (`13` §12; `09` §7, §9, `07` §9, `05` §6, `02` §5, `08` §13, `10` §3; Q-115, Q-119, D-181, D-187). A zip of format 1 (`manifest.json`, `data/*.json`, `images/<sha256>.<ext>`) for a campaign or library assets, streamed out by `GET /api/export/campaigns/:id` and `GET /api/export/assets`; `POST /api/import` reading it from its central directory with every refusal of `07` §9 storing nothing, a campaign always a new copy, images reused by hash, assets by identifier; migration 0013 adds the import limit, 2 GB, in Settings; Export, Import and the library's selection mode in the DM view. Acceptance: `server/src/http/archive.test.ts` (the export and import test of `10` §3 and every refusal with the database file and the images folder unchanged byte for byte), `shared/src/archive.test.ts`, `client/src/dm/archive/Archive.test.tsx`, `e2e/tests/archive.spec.ts` (a campaign with a running combat imported on a second data directory and played there; the large-scene fixture's round trip). Implemented and green locally (TRACEABILITY.md) and on CI (run 37430729480, pull request #34); left: prompt 2 (review), whose findings are fixed on the branch before DMT-05 is done.

### DMT-01 to DMT-04

Hit points and armour class (D-182), per-enemy initiative (D-183, D-184), Follow my view (Q-120, D-185) and DM notes (D-186) are implemented and green locally, their acceptance as `13` §12 states it and their evidence in TRACEABILITY.md. CI on pull request #34 is green for them too. Each waits for what DMT-05 waits for: prompt 2 (review), whose findings are fixed on the branch before the package is done.

Owed by hand, before the 1.0.0 release:

- the acceptance run on the owner's LG TV (D-151, G-043 with G-002, G-031 and G-040), following `docs/acceptance/rel-03-owner-run.md`;
- the install in Windows Sandbox from a release candidate (D-178, G-046), following `docs/acceptance/pkg-03-sandbox-run.md`.

## Next

- None: DMT-05 is the last package of Phase 7, the last phase planned. After the review and CI of `feat/dm-toolkit`, the owner decides whether the DM toolkit ships before 1.0.0 (D-181).
