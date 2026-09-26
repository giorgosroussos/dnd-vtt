# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### LIV-03 — Player view and connecting a screen

- **Outcome:** the player view at `/` shows the dark idle screen with the product name while nothing is live and switches to the live scene when one is activated, fitted to the map, drawing the map's display version, the grid only when the scene shows it to players, and the visible tokens with their labels (`08` §4, `04` §4, `04` §9, Q-025, Q-032, Q-038); it keeps that picture in step from the players' events as `shared/src/live.ts` states them (an added token inserted at its rank, a removed one gone, a moved one replaced, a renamed one relabelled; D-109) and returns to the idle screen on `scene.cleared`; it has no controls and hides the cursor after two seconds still (`08` §9, Q-054); the server console at start and a "Connect a screen" panel in the DM view show a QR code and a short URL that open the player view, never the DM view, listing every non-internal IPv4 address with the first private-range one prominent (`08` §5, Q-026, Q-053); both views have a loading and a load-failure state of their own (G-007).
- **Specs:** `13` §6 LIV-03, `08` §4, `08` §5, `08` §9, `04` §4, `04` §5, `04` §6, `04` §9, `09` §4, `02` §6; D-090, D-104, D-105, D-109; Q-025, Q-026, Q-032, Q-038, Q-053, Q-054, Q-076.
- **Dependencies:** LIV-02 (live commands, players' events and image entitlement, D-109 to D-111).
- **Acceptance (executable):**
  - Vitest (client): the player view renders the idle screen for a `null` scene and the live scene for a players' snapshot, through `MapCanvas` in its player mode (D-090), fitted to the map; applying each players' event to the drawn state gives what a fresh snapshot would, including a reveal between visible tokens and a relabelled token (the rank rule of D-109); `scene.cleared` returns to the idle screen; the grid follows `grid.visible`; no control is rendered and the cursor is hidden after two seconds without movement; a DM snapshot is never drawn (D-105).
  - Vitest (server): the LAN addresses listed are every non-internal IPv4 address with the first private-range one first; the console line and the QR code carry the player view's URL and never `/dm`; the QR code is generated on the server or bundled, fetching nothing outside the LAN (`02` §6).
  - Loading and load-failure states for both views from the catalogue, the DM's failure state reached and operated in the keyboard smoke test (G-007).
  - Playwright: a DM context activates a scene through the socket and a player context draws its map and visible tokens with their labels and no hidden token; hiding, revealing, moving and deleting a token over the socket change the player context's drawing; deactivating shows the idle screen; the "Connect a screen" panel shows the QR code and the URL; `make verify` exit 0 on both CI runners; `TRACEABILITY.md` LIV-03 row with test names.
- **Non-goals:** Go live, Blank TV and live mode in the DM view (LIV-04); the player camera and the TV frame beyond fitting to the map on activation (LIV-06); the ruler on the TV (LIV-07); undo (LIV-05).
- **Review:** `Surfaces: data, security, ux`, so prompt 2 (review) runs after implementation.

## Next

1. **LIV-04 — Live and prep modes.** One canvas with the live indicator, the live bar's return, Go live and Blank TV, live setup edits pushed as snapshots, an asset's image or size change on the live scene pushed too, and deleting the live scene reaching the TV; closes G-012, G-018, G-019, G-024 and G-027, and takes the owner's answer on G-030 (`13` §6, `08` §2, `04` §2, `04` §10).
2. **LIV-05 — Undo.** The in-memory inverse history of the live scene, Ctrl+Z through the ordinary command path, bounded and cleared on activation; undo joins the recorded-traffic test, which then carries the hidden-information gate (G-028; `13` §6, `04` §8, `10` §3).
