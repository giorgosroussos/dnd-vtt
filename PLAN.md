# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### TBL-04 — Painted fog

- **Outcome:** the DM paints fog with a round brush and reveals it with an eraser, the radius on a slider, with Fog all and Clear all, in preparation and on the live scene, each live stroke one undoable step; the fog regions of TBL-03 and their table are gone (Q-101, D-154, D-155).
- **Specs:** `13` §10 TBL-04, `01` §9, `03` §1, `03` §7, `04` §2, `04` §3, `04` §4, `04` §8, `04` §13, `07` §5, `08` §11, `10` §3.
- **Acceptance:** `make verify` green locally (done, see TRACEABILITY.md), then CI green on every job of the pull request from `tbl-04-fog-brush`. The owner's TV run (`docs/acceptance/rel-03-owner-run.md` step 5) now paints and erases fog.
- **Also owed by hand:** the acceptance run on the owner's LG TV, deferred by the owner (D-151), tracked as G-043 with G-002, G-031 and G-040; follow `docs/acceptance/rel-03-owner-run.md` and hand the record back.

## Next

- None: REL-03 was the last package of `13` §7 and §10.
