# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### TBL-06 — Initiative tracker

- **Outcome:** one encounter per scene, an entry per player character and one Enemies entry, ordered by the numbers the table rolled or by dragging, turns and rounds passed with Enter and Shift+Enter, in the DM view's Initiative tab and a strip along the top of the TV that names no enemy (Q-104, Q-105, Q-106, D-160).
- **Specs:** `13` §10 TBL-06, `01` §9, `03` §1, `03` §7, `04` §2, `04` §3, `04` §4, `04` §8, `04` §14, `08` §12, `10` §3, `12`.
- **Acceptance:** `make verify` green locally, including the hidden-information gate with an encounter in its script and an e2e combat run end to end, then CI green on every job of the pull request from `tbl-06-initiative`; security and isolation review (prompt 2) with no critical or high left.
- **Also owed by hand:** the acceptance run on the owner's LG TV, deferred by the owner (D-151), tracked as G-043 with G-002, G-031 and G-040; follow `docs/acceptance/rel-03-owner-run.md` and hand the record back.

## Next

- None: REL-03 was the last package of `13` §7 and §10.
