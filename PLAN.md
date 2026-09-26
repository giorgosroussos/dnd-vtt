# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### LIV-04 — Live and prep modes

- **Outcome:** the DM view's one canvas shows the live scene in live mode, with a persistent live indicator around it, and any other scene in prep mode, where nothing reaches the TV (`08` §2, Q-024); the live bar returns the canvas to the live scene in one click; "Go live" on the scene being edited sends `scene.activate` and "Blank TV" sends `scene.deactivate` (`04` §2, Q-025); in live mode the token controls send the live commands `token.add`, `token.move`, `token.setVisibility` and `token.delete` instead of REST writes (D-100, D-109), and the DM view applies the `dm` room's snapshots and events, so its live bar and live canvas follow another DM browser (G-018); changing the live scene's map, calibration or players' grid over REST, or the image or size of an asset with a visible token on the live scene, pushes a fresh `scene.snapshot` to both rooms (`04` §10, Q-015, G-019); deleting the live scene or an ancestor over REST sends both rooms the idle state (`03` §7, Q-031, G-012).
- **Specs:** `13` §6 LIV-04, `08` §2, `04` §2, `04` §3, `04` §4, `04` §10, `03` §7, `05` §5; D-100, D-104, D-109, D-112; Q-015, Q-024, Q-025, Q-031.
- **Dependencies:** LIV-03 (the player view draws and follows the live scene, D-112).
- **Acceptance (executable):**
  - Vitest (server, real SQLite file and socket): a REST change to the live scene's map, calibration or grid visibility, and an asset change affecting a visible live token, each send both rooms a fresh snapshot, the players' one with no hidden token; a change to a scene that is not live sends nothing; deleting the live scene, its session or its campaign sends both rooms the idle state and no id of the deleted scene (G-012, G-019).
  - Vitest (client): prep mode and live mode on one canvas, the live indicator only in live mode; Go live and Blank TV send their commands; in live mode no REST token write is made (G-024); the live bar's return selects the live scene; a `dm` snapshot or event from another browser updates the live bar and the live canvas (G-018).
  - Playwright: Go live from the DM view makes a player context draw the scene; moving, hiding, revealing and deleting a token in live mode change the player context's drawing and never show a hidden token; Blank TV shows the idle screen; the keyboard smoke test covers the new controls; `make verify` exit 0 on both CI runners; `TRACEABILITY.md` LIV-04 row with test names.
  - Owner answer on G-030 (reveal stacking order) recorded, with its test; G-027 handled or accepted by a recorded decision.
- **Non-goals:** the player camera frame (LIV-06); undo (LIV-05); the ruler (LIV-07); settings screen (REL-01).
- **Review:** `Surfaces: security, scope, ux` and `Touches red line: yes`, so prompt 2 (review) runs after implementation.

## Next

1. **LIV-05 — Undo.** The in-memory inverse history of the live scene, Ctrl+Z through the ordinary command path, bounded and cleared on activation; undo joins the recorded-traffic test, which then carries the hidden-information gate (G-028; `13` §6, `04` §8, `10` §3).
2. **LIV-06 — Cameras.** The player camera held in server memory, reset to fit on activation, and set from the DM view's frame of what the TV sees without moving the DM's own camera (`13` §6, `04` §9, `08` §2, Q-038).
