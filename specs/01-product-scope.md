# 01 — Product Scope

What Emberglass is for, who uses it, and what each release contains.

## 1. Vision and definition of done

- The MVP is done when the DM can prepare a session in advance and run it on a TV or projector, operating everything alone. [input]
- Use context: in-person play at one table of up to about eight people, all on the same Wi-Fi network. [input]
- Motivation: a free, self-hosted alternative to virtual tabletops with limited free plans. [input]
- Differentiator: a session is a series of scenes the DM prepares in advance, with pre-placed and hidden tokens. [input]
- Rules baseline: D&D 5e, 2014 edition (SRD 5.1); every campaign carries `rules_version = 5e-2014` (`03` §8). [input]
- The MVP MUST NOT encode game rules beyond the token size table (`05` §2) and the ruler's diagonal rules (`06` §5). [input]
- One server hosts one game at a time: at most one scene is live per server. [input]

## 2. Actors

| Actor | Device | Access | Can |
| --- | --- | --- | --- |
| DM | laptop or desktop browser (`08` §7) | DM view, after the PIN (`07` §1) | prepare everything, run the live scene |
| Player screen | TV or projector browser | player view, no credential (`07` §3) | display the visible state of the live scene |
| Players | none in the MVP | — | look at the player screen |

- The MVP MUST NOT provide player devices, player accounts or per-player views. [input]
- Any browser on the LAN MAY open the player view; it is read-only. [Q-010, recommendation accepted]

## 3. MVP capabilities

The MVP MUST provide: [input]

- a local Node server serving the React client and the WebSocket (`02` §2);
- SQLite storage and an images folder (`02` §7);
- joining from the LAN with a QR code and a typed URL (`08` §5);
- a PIN protecting the DM view (`07` §1);
- automatic reconnection with snapshot and versioning (`04` §5, `04` §6);
- Campaign → Sessions → Scenes (`03` §1);
- a background map image with zoom and pan (`08` §3);
- grid calibration with three methods (`06` §1);
- a shared asset library with tags and search (`05` §1);
- tokens with drag, snap-to-grid and automatic numbering (`05` §3, `06` §4);
- hidden tokens filtered on the server (`04` §4);
- a ruler with the PHB 2014 diagonal rule and the optional DMG rule as a setting (`06` §5);
- independent DM and player cameras, with the live scene separate from the scene being edited (`04` §9, `08` §2);
- duplicating a scene (`03` §7);
- undo for the DM on the live scene (`04` §8);
- upload limits on file types and size (`05` §6).

The MVP MUST also provide deleting a token on the live scene (`04` §2). [Q-014, recommendation accepted]

The MVP MUST also allow editing the live scene's setup while it is live (`04` §10). [Q-015, recommendation accepted]

## 4. Phase 2 (Future)

Phase 2 MUST NOT be implemented in the MVP; it covers: [input]

- characters with a join link or QR code per character;
- permissions: each player moves only their own token;
- a mobile UI;
- an initiative tracker;
- HP and conditions on tokens;
- fog of war;
- DM notes per scene;
- handouts;
- character sheets with computed derived values and manual override;
- data-driven rules in JSON, importing SRD 5.1;
- campaign export and import as a zip.

Campaign export/import is Phase 2; in the MVP a campaign moves to another PC only by copying the whole data folder (`09` §5). [Q-013, recommendation accepted]

## 5. Phase 3 (Future)

Phase 3 MUST NOT be implemented in the MVP; it covers: [input]

- guided level-up from SRD data;
- a personal screen per player with hidden messages;
- packaging as a Tauri or Electron desktop app, without changing the architecture.

## 6. Nice-to-have (Future, unscheduled)

These MUST NOT be implemented in the MVP: [input]

- the 2024 rules as a second data set;
- homebrew classes, spells and items;
- an AI assistant for the DM;
- automatic grid detection;
- physical screen scale for miniatures (1 square = 25 mm);
- a live drag preview with throttling.

Adding tokens by dragging them from a sidebar is Future, unscheduled; the MVP flow is button, picker, click on the map (`05` §5). [input]

Area-of-effect templates and a pointer/ping on the TV are nice-to-haves and MUST NOT be implemented in the MVP. [Q-016, recommendation accepted]

## 7. Out of scope

Emberglass MUST NOT implement: [input]

- custom map creation;
- remote play;
- a full effects engine;
- dynamic lighting;
- hex grids.

## 8. Name, licence and distribution

- The public product name is Emberglass. [Q-022]
- The product name, UI title and package names MUST NOT contain "D&D" or "Dungeons & Dragons"; the product MAY describe itself as compatible with 5th edition (SRD 5.1). [Q-022]
- The source is licensed under AGPL-3.0, with the licence text at the repository root. [Q-021]
- The MVP is installed from source (`09` §1). [Q-017, recommendation accepted]
- SRD 5.1 content (CC-BY-4.0) enters from Phase 2 on; its attribution is a Phase 2 obligation. [input]
