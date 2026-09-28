# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### LIV-07 — Ruler

- **Outcome:** a two-point ruler in the DM view measures a straight path between two square centres (Q-048) by the PHB 2014 rule, every diagonal 5 ft, or the DMG rule, diagonals alternating 5 ft and 10 ft, read from the one server-wide setting, default PHB (Q-037); distances scale with the scene's feet per square (Q-087), which becomes editable in the scene update and the DM view, a calibration's preset carrying it (G-021); on the live scene `ruler.update` and `ruler.clear` reach both rooms as `ruler.shown` and `ruler.cleared` and the TV draws the line and the distance (`04` §11, Q-027); a measurement on a scene that is not live never leaves the DM view (Q-086); measurements are never stored; what clears a measurement on the TV besides `ruler.clear` (another activation, Blank TV, a screen reconnecting) is recorded as a decision.
- **Specs:** `13` §6 LIV-07, `06` §5, `04` §2, `04` §3, `04` §11, `03` §6, `08` §3; D-045, D-119, D-120; Q-027, Q-037, Q-048, Q-086, Q-087; G-021.
- **Dependencies:** LIV-06 (the live command path and the TV's camera, D-119, D-120); the ruler commands are not undoable (`04` §2).
- **Acceptance (executable):**
  - Vitest (unit): the distance of straight, diagonal and mixed paths by the PHB and the DMG rule, at 5 and 10 ft per square; the end points taken at square centres.
  - Vitest (server, real SQLite file and socket): `grid.feet_per_square` accepted by `PATCH /api/scenes/:id` within bounds and carried by a calibration's preset; `ruler.update` and `ruler.clear` validated, strict, refused for a scene that is not live, and never stored or recorded for undo; each reaches both rooms once, one version each; a player socket's ruler commands are refused (the player-command gate still passes); the recorded-traffic gate adds a ruler step and stays equal to the session without hidden-only steps.
  - Vitest (client): the ruler in both modes shows the distance in the DM view; in prep mode nothing is sent; in live mode a measurement sends `ruler.update` and ending it `ruler.clear`; the player view draws and clears it; feet per square is edited in the scene's setup; keyboard operation of the ruler.
  - Playwright: a measurement in a DM context on the live scene shows its line and distance in a player context and clearing it removes them; a measurement in prep mode reaches no player context; `make verify` exit 0 on both CI runners; `TRACEABILITY.md` LIV-07 row with test names.
- **Non-goals:** waypoints (Q-048); the settings screen that changes the diagonal rule (REL-01); area templates and ping (`01` §6); the residuals G-032 to G-035 (REL-02).
- **Review:** `Contract change: yes` (the ruler payloads and events), so prompt 2 (review) runs after implementation.

## Next

1. **REL-01 — Operations and repository documents.** Install and start from source, migrations at start, the data directory, configuration and logging, the settings screen for the upload limit, display size and ruler rule, and the README with firewall guidance and network exposure (G-008, G-010, G-015, G-017; `13` §7, `09` §1, `09` §2, `09` §4, `09` §5, `09` §6, `09` §7, `09` §8).
2. **REL-02 — Acceptance suite and system matrix.** The acceptance scenarios, the offline run and the external-URL build check, the large-scene fixture, server acceptance on Windows and Linux and the browser matrix, and the residuals it closes or accepts (G-003, G-018, G-022, G-026, G-029, G-031 to G-035; `13` §7, `10` §3, `10` §4, `10` §5, `10` §6).
