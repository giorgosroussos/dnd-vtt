# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### LIV-05 — Undo

- **Outcome:** the server keeps, in memory only, the inverse of every undoable DM command on the live scene (`token.add`, `token.move`, `token.setVisibility`, `token.delete`), bounded to the last 100, cleared when another scene is activated and on restart (`04` §8, Q-005), with what undo does after Blank TV or the live scene's deletion recorded as a decision; Ctrl+Z in the DM view's live mode sends `undo`, and the server applies the most recent inverse through the ordinary command path, so each room receives exactly what the inverse command would send (D-040); setup edits to the live scene are not undoable (Q-050); undo joins the recorded-traffic test, which then carries the hidden-information gate (`10` §3, G-028).
- **Specs:** `13` §6 LIV-05, `04` §2, `04` §3, `04` §4, `04` §8, `08` §3, `10` §2, `10` §3; D-040, D-109, D-110, D-115; Q-005, Q-050, Q-067.
- **Dependencies:** LIV-04 (live mode sends the live commands from the DM view, D-115, D-116).
- **Acceptance (executable):**
  - Vitest (server, unit): the inverse of each undoable command, a hidden token's included; the history bounded at 100; cleared on activation of another scene, and the recorded behaviour after Blank TV and deletion; `undo` with an empty history acknowledged and telling nobody.
  - Vitest (server, real SQLite file and socket): undoing each token command restores the database and sends each room what the inverse command sends: undoing the add of a hidden token, or the move of one, sends players nothing; undoing a reveal sends them `token.removed`; a player socket's `undo` is refused (the player-command gate still passes).
  - The recorded-traffic test adds undo of each token command, of a hidden token included, to its script, stays equal to the session without hidden-only steps, and carries `@gate:hidden-information`; its tripwire is promoted out of `scripts/tripwire.mjs`, CI and the README (G-028, D-110).
  - Vitest (client) and Playwright: Ctrl+Z in live mode sends `undo` and the player context's drawing follows; Ctrl+Z in prep mode sends nothing; `make verify` exit 0 on both CI runners; `TRACEABILITY.md` LIV-05 row with test names.
- **Non-goals:** undo of setup edits (Q-050) or of preparation writes; the player camera (LIV-06); the ruler (LIV-07); the LIV-04 residuals G-032 and G-033 (REL-02).
- **Review:** `Contract change: yes` (the `undo` payload), so prompt 2 (review) runs after implementation.

## Next

1. **LIV-06 — Cameras.** The player camera held in server memory, reset to fit on activation, and set from the DM view's frame of what the TV sees without moving the DM's own camera (`13` §6, `04` §9, `08` §2, Q-038).
2. **LIV-07 — Ruler.** A two-point ruler with the PHB and DMG diagonal rules and the scene's feet per square, set in the DM view, shown on the TV for the live scene and never sent for a scene that is not live (G-021; `13` §6, `06` §5, `04` §11, Q-027, Q-086, Q-087).
