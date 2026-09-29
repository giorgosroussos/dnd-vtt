# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### REL-03 — Acceptance on the owner's TV

- **Outcome:** the player view is accepted on the owner's LG TV, in its built-in webOS browser, loading the large-scene fixture, and the display-version size is confirmed or changed (`10` §4, `05` §7). The run is recorded with its result, which is Phase 4's last exit criterion and the MVP's release gate (`13` §7, `10` §5). The residuals that need the owner's hardware are closed with their evidence or kept by a recorded decision: G-002, G-031, G-040, G-041, G-042; and Q-096's answer is implemented (G-043).
- **Specs:** `13` §7 REL-03, `10` §4, `05` §7, `08` §5, `08` §7, `07` §6, `05` §3, `03` §1; Q-019, Q-036, Q-053, Q-096; G-002, G-031, G-040, G-041, G-042, G-043.
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
  - Q-096 answered B (D-137), G-043: an additive migration adds `shown` to tokens (existing visible tokens shown, hidden ones not), set in placement, reveal and numbering and never sent to a client; Vitest against a real SQLite file: a lone visible token hidden and revealed keeps its label, a token placed hidden and revealed is numbered as Q-092 says, Q-091's example still holds, and `server/src/ws/hidden-information.test.ts` unchanged; the migration tested on the generated fixture database (`14` §8).
  - `TRACEABILITY.md` REL-03 row and Phase 4's exit with the run's result; `make verify` exit 0 in CI.
- **Non-goals:** packaging (`02` §8); any feature beyond the MVP (`01` §4 to §7); acceptance on devices other than the owner's TV, PC and laptop.
- **Review:** `Surfaces` include `security` and `data`, so prompt 2 (review) runs after implementation.

## Next

None: REL-03 is the last package of `13` §7. After it, the MVP's release gate is `10` §5 with Phase 4's exit criteria.
