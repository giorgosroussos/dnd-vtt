# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### PRP-04 — Tokens in preparation

- **Outcome:** on a scene that is not live, the DM adds tokens through an add button, the library picker with search and filter, and a click on the map where the token goes (`05` §5); labels are numbered per scene ("Goblin 1" to "Goblin 4", a lone token keeping the bare name, freed numbers not reused, `05` §3, D-019); each token starts hidden or visible from its asset's `default_hidden` (`05` §4) and covers its size's squares (`05` §2); the DM drags tokens with snapping to whole squares (Tiny to half squares) and Alt for free placement (`06` §4, D-023), and hides, reveals, deletes, relabels and restacks them (`04` §2). Hidden tokens show semi-transparent with a marker in the DM view (`08` §9, Q-054). Positions are stored in decimal grid units, never pixels (`03` §4).
- **Specs:** `13` §5 PRP-04, `05` §2, `05` §3, `05` §4, `05` §5, `06` §4, `04` §2, `03` §1, `03` §4, `08` §9; D-019, D-020, D-023, D-094, D-096, D-099, D-100, D-101; Q-059, Q-063, Q-091, Q-092.
- **Dependencies:** PRP-03 (pull request `prp-03-grid-calibration`, D-094, D-096: calibrated grids, whose square size places a token in pixels), SRV-05 (the asset library and its picker data).
- **Acceptance (executable):**
  - Vitest against a real SQLite file: token routes under `/api/scenes/:id` create, update (position, hidden, label, stacking order) and delete tokens of a scene that is not live; numbering follows D-019 through additions and deletions; a new token's `hidden` comes from its asset; positions are kept as decimals; the live scene's tokens are refused over REST (they change only by the live commands of LIV-02, `04` §2); a browser without a DM session gets 401 and learns no token, asset or scene id; `shared` contract types updated.
  - Component tests: the add flow places a token where the map is clicked, converting screen to grid units through the calibration; snapping per size and Alt free placement; hide, reveal, delete, label and stacking order; hidden tokens drawn semi-transparent with a marker in the DM mode, and the player mode draws none of them.
  - Playwright: prepare a scene with numbered tokens, some hidden, by the picker, drag one with snap and one with Alt, reload unchanged; with PRP-03 this is Phase 2's exit test (`13` §5); the keyboard and contrast gates pass; `make verify` exit 0 on both CI runners; `TRACEABILITY.md` PRP-04 row with test names.
- **Non-goals:** live token commands and the players' projection (LIV-02); undo (LIV-05); token images changing with their asset is served already (SRV-05) and only drawn here.
- **Status:** implemented and reviewed (D-100); every acceptance item passes locally (`TRACEABILITY.md`) except `make verify` on both CI runners, which needs the branch pushed. Close-out after green CI: PRP-04 `done`, removed from here, LIV-01 becomes Now.
- **Review:** `Surfaces: data, security, scope, ux` (data since Q-091, D-102), `Touches red line: yes`, so prompt 2 (review) runs after implementation. `13` §5 marks `Contract change: no`, but D-078 deferred the token routes to this package; treat it as a contract change.

## Next

1. **LIV-01 — WebSocket rooms, snapshots and reconnection.** `dm` and `players` rooms from the session cookie, role-filtered snapshots, version numbers and gap recovery, automatic reconnection without a PIN prompt; closes G-011 and G-018 (`13` §6, `04` §1, `04` §5, `04` §6).
