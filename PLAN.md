# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### DMT-04

DM notes (`13` §12; `02` §5, `03` §1, `03` §7, `03` §10, `04` §2, `04` §3, `04` §4, `04` §16, `08` §13, `10` §3; Q-114, D-181, D-186). Migration 0012 adds `notes` to scenes and tokens, empty by default, at most 20,000 characters; `PUT /api/scenes/:id/notes` and `PUT /api/tokens/:id/notes` on any scene, live included, not undoable, the live scene's telling the DM room alone by `notes.updated`; a duplicated scene copying its notes and its tokens' (with their hit points); the DM view saving as typed with nothing typed ever lost, the Notes tab and N, a token's notes in its popover beside its asset's, the marks on the map, the rows and the scene list, and the turn's initiative row opening them. Acceptance: `server/src/ws/notes.test.ts` covers the REST edits on a live and a prepared scene, `notes.updated` reaching only the DM room and the duplication; the hidden-information suite passes with notes in its script and finds none in any player message; `client/src/dm/notes/*.test.tsx` cover the autosave, a failed save, the limit, another window's change and text-only rendering; `e2e/tests/notes.spec.ts` with a DM and a player context. Implemented and green locally (TRACEABILITY.md); left: CI on the pull request and prompt 2 (review), whose findings are fixed on the branch before DMT-04 is done.

### DMT-01 to DMT-03

Hit points and armour class (D-182), per-enemy initiative (D-183, D-184) and Follow my view (Q-120, D-185) are implemented and green locally, their acceptance as `13` §12 states it and their evidence in TRACEABILITY.md. Each waits for what DMT-04 waits for: CI on the pull request of `feat/dm-toolkit` and prompt 2 (review), whose findings are fixed on the branch before the package is done.

Owed by hand, before the 1.0.0 release:

- the acceptance run on the owner's LG TV (D-151, G-043 with G-002, G-031 and G-040), following `docs/acceptance/rel-03-owner-run.md`;
- the install in Windows Sandbox from a release candidate (D-178, G-046), following `docs/acceptance/pkg-03-sandbox-run.md`.

## Next

- DMT-05 Export and import (`13` §12; `09` §9, `07` §9; Q-115, Q-119), last so that its format carries every field above.
