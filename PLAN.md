# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### LIV-06 — Cameras

- **Outcome:** the DM view and the player view have independent cameras (`04` §9); the player camera is held in server memory for the live scene and reset to fit-to-map, or to the grid extent of a map-less scene, on every activation (Q-038, D-018); `camera.setPlayer` sets it from the DM view and reaches both rooms as `camera.player` (`04` §2, §3); in live mode the DM view shows the frame of what the TV sees, which the DM moves and resizes to steer the player camera without changing the DM's own camera (`08` §2, Q-080); a player view connecting or reconnecting receives the current player camera with its snapshot (`04` §5, §6); how the frame's shape follows the TV's viewport, with several screens connected, is recorded as a decision.
- **Specs:** `13` §6 LIV-06, `04` §2, `04` §3, `04` §5, `04` §6, `04` §9, `08` §2, `08` §8; D-018, D-104, D-109, D-115; Q-038, Q-080.
- **Dependencies:** LIV-05 (the live command path with undo, D-117, D-118); `camera.setPlayer` is not undoable (`04` §2).
- **Acceptance (executable):**
  - Vitest (server, unit): the fit-to-map camera of a scene with a map and of a map-less scene; the camera reset on activation of any scene and kept on a command that does not change it; the `camera.setPlayer` payload validated, strict, and a camera outside sane bounds refused.
  - Vitest (server, real SQLite file and socket): `camera.setPlayer` reaches both rooms as `camera.player` with one version each; a player socket's `camera.setPlayer` is refused (the player-command gate still passes); a connecting player view receives the current camera; nothing about hidden tokens changes what players receive (the recorded-traffic gate adds a camera step and stays equal to the session without hidden-only steps).
  - Vitest (client): the player view applies `camera.player` and its reset; the DM view's frame is shown only in live mode, moving or resizing it sends `camera.setPlayer`, and the DM's own camera does not change; the frame follows another DM browser's camera; keyboard operation of the frame.
  - Playwright: moving and resizing the frame in a DM context changes what a player context shows, and the DM's view does not move; activating another scene resets the TV to fit; `make verify` exit 0 on both CI runners; `TRACEABILITY.md` LIV-06 row with test names.
- **Non-goals:** a stored player camera (Q-038); the ruler (LIV-07); the LIV-05 residuals G-034 and the LIV-04 residuals G-032 and G-033 (REL-02).
- **Review:** `Contract change: yes` (the `camera.setPlayer` and `camera.player` payloads), so prompt 2 (review) runs after implementation.
- **Status (2026-09-28):** implemented on branch `liv-06-cameras` (D-119); every acceptance item above passes locally (`TRACEABILITY.md` LIV-06). Remaining before it is done: `make verify` green on both CI runners and the review (prompt 2).

## Next

1. **LIV-07 — Ruler.** A two-point ruler with the PHB and DMG diagonal rules and the scene's feet per square, set in the DM view, shown on the TV for the live scene and never sent for a scene that is not live (G-021; `13` §6, `06` §5, `04` §11, Q-027, Q-086, Q-087).
2. **REL-01 — Operations and repository documents.** Install and start from source, migrations at start, the data directory, configuration and logging, the settings screen for the upload limit, display size and ruler rule, and the README with firewall guidance and network exposure (G-008, G-010, G-015, G-017; `13` §7, `09` §1, `09` §2, `09` §4, `09` §5, `09` §6, `09` §7, `09` §8).
