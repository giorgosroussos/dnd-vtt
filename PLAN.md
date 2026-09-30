# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### UIX-01 — The redesign of both views

- **Outcome:** the DM view and the player view in the 2026-09-30 redesign (`01` §9, `08` §11): palette and bundled fonts with the Greek subsets, the header with the live indicator, Go idle and the screens counter, the session's scene list with Next up (Shift+N), the TV camera controls with Lock, the tool rail and shortcut bar, the token popover, the right panel's tabs, the new token visuals, and on the TV the vignette, the scene's name, readable labels, fades and the new idle screen. Redo beside undo. Every MVP flow (prep, calibration, library, live play, reconnect, undo) still works in it.
- **Specs:** `13` §10 UIX-01, `08` §1, `08` §2, `08` §4, `08` §11, `01` §9, `04` §3, `04` §8 (redo, screens count and the scene's name are amended into `04` with the code); Q-100, D-139; inputs `docs/inputs/requirements/2026-09-30-ui-redesign-brief.md`, `docs/inputs/Design.html`.
- **Acceptance:**
  - Unit and component tests for redo (server and client), the screens count, the scene name and category in the players' projection, and the new components; existing tests changed only where the DOM they drive changed, never weakened.
  - `make e2e` green, the journeys driving the new layout; a spec capturing the three screens at 1440 × 900 and 1920 × 1080, and the TV at 1280 × 720 with 2.5× zoom, compared with the boards.
  - `make verify` exit 0; `TRACEABILITY.md` UIX-01 row with the evidence.
- **Non-goals:** ping, markers and fog (TBL-01 to TBL-03: their rail buttons are present and disabled); rename and stacking on the live scene (`04` §2).
- **Review:** `Surfaces` include `security` and `data`, so prompt 2 (review) runs after implementation.

## Next

- **TBL-01 — Ping** (`13` §10): the `ping` command and event, grid units, stored nowhere; the P tool.
- **TBL-02 — Condition markers** (`13` §10): migration 0004, `token.setMarkers` with undo and redo, the popover's chips and the markers drawn on both views.
- **TBL-03 — Manual fog regions** (`13` §10): migration 0005, Region commands and REST, the player-visibility rule in snapshots, events, numbering and image files, the fog tool; the hidden-information suite extended; review prompt 2.
- **REL-03 — Acceptance on the owner's TV**, after Phase 5, unchanged:

  ### REL-03 — Acceptance on the owner's TV

  - **Outcome:** the player view is accepted on the owner's LG TV, in its built-in webOS browser, loading the large-scene fixture, and the display-version size is confirmed or changed (`10` §4, `05` §7). The run is recorded with its result, which is Phase 4's last exit criterion and the MVP's release gate (`13` §7, `10` §5). The residuals that need the owner's hardware are closed with their evidence or kept by a recorded decision: G-002, G-031, G-040, G-041, G-042.
  - **Specs:** `13` §7 REL-03, `10` §4, `05` §7, `08` §5, `08` §7, `07` §6; Q-019, Q-036, Q-053; G-002, G-031, G-040, G-041, G-042.
  - **Dependencies:** REL-02 (done, D-127 to D-136): the large-scene fixture (`node e2e/fixtures/large-scene.ts <folder>`), the acceptance journeys and the browser matrix.
  - **Owner run needed:** the TV's model and webOS version, and access to the TV and to the owner's Windows PC and laptop; the run is the owner's, with the steps and what to record written for them first.
  - **Acceptance (executable where it can be):**
    - The TV's model and webOS version recorded in `docs/inputs/` (G-002), with an authority entry.
    - On the TV: the Connect TV journey by the typed URL and by the QR code; the large-scene fixture's map and 50 tokens drawn; Go live, a move, a reveal, Blank TV and a network cut and restore followed; the ruler's distance label read from across the room; each with its result recorded.
    - The display-version size confirmed on the TV, or the default changed with a decision and its test (`05` §7).
    - The connect panel's prominent address checked on the owner's PC with its adapters (G-031): closed by an owner decision card and its test, or accepted by a recorded decision.
    - A first load of the LAN address in Firefox on the owner's Windows PC timed (G-040), with the cause fixed or the wait accepted by a decision.
    - The DM view at the owner's laptop window (about 1,280 × 620 at 150% scaling, G-041): an end-to-end layout check at that size for calibration, token placement and the PIN change, or a recorded decision on the narrowest supported window.
    - The pause's refusal naming the server PC (G-042): a distinct error code in the shared contract with its message and component test, or a recorded decision accepting the README's explanation.
    - `TRACEABILITY.md` REL-03 row and Phase 4's exit with the run's result; `make verify` exit 0 in CI.
  - **Non-goals:** packaging (`02` §8); any feature beyond the MVP (`01` §4 to §7); acceptance on devices other than the owner's TV, PC and laptop.
  - **Review:** `Surfaces` include `security` and `data`, so prompt 2 (review) runs after implementation.
