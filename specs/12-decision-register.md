# Locked Decision Register

Each bullet below is an owner decision: stated in the requirements (`[input]`) or made by answering a question card (`[Q-NNN]`, see `QUESTIONS.md`). Nothing else appears here; `make check-docs` fails on any other provenance. Bullets are compressions of statements in the domain specifications, grouped by the surface they fix.

## 1. Data

- Eight entities in SQLite: Image, Asset, AssetTag, Campaign, Session, Scene, Token, Settings (`03` §1). [input]
- UUIDs for every entity except Image, which is identified by the sha256 of its original; duplicate uploads reuse the stored image (`03` §3). [input]
- Token positions are decimal grid units; recalibration or a new map resolution never moves a token (`03` §4). [input]
- Grid size and offsets are stored in original-image dimensions (`06` §2). [input]
- A new scene copies its map's grid preset; calibrating updates the preset for later scenes and never changes other existing scenes (`03` §5). [Q-001]
- An image no longer referenced by any asset or scene is removed with its files and preset (`03` §7). [Q-002]
- Deleting a campaign cascades to sessions, scenes and tokens after a confirmation; sessions and scenes cascade as well (`03` §7). [input, Q-003]
- Deletions are permanent once confirmed; no trash (`03` §7). [Q-004]
- An asset in use cannot be deleted; the refusal lists the scenes using it (`03` §7). [input]
- Undo history lives in memory for the live scene only, cleared on activation of another scene or restart, last 100 commands (`04` §8). [Q-005]
- A scene may have no map; it then stores its grid extent in columns and rows (`03` §6). [Q-006]
- Deleting the live scene or an ancestor is allowed after a warning and blanks the TV (`03` §7). [Q-031, recommendation accepted]
- `Token.character_id` exists and stays empty; `grid.type` accepts only `square`; `rules_version` is `5e-2014` (`03` §8). [input]
- All state lives in one data directory; backup is a folder copy (`09` §5). [input, Q-039]
- A map-less scene defaults to 30 × 20 squares and can receive a map later (`03` §6). [Q-034, recommendation accepted]
- A rejected upload stores nothing (`05` §6). [Q-035, recommendation accepted]
- Display versions and thumbnails are WebP, regenerated when the display size changes (`05` §7). [Q-036, recommendation accepted]
- The diagonal rule is one server-wide setting (`06` §5). [Q-037, recommendation accepted]
- The player camera is not stored; it resets to fit-to-map on every activation (`04` §9). [Q-038, recommendation accepted]
- The data directory defaults to the per-user application-data folder (`09` §5). [Q-039, recommendation accepted]
- Logs go to the console and a rotating file, and record client addresses of connections and failed PIN attempts (`09` §6, `07` §8). [Q-040, Q-041, recommendation accepted]
- UUIDs are generated only by the server (`03` §3). [Q-055, recommendation accepted]
- The live version counter lives in memory and restarts at 1 (`04` §5). [Q-056, recommendation accepted]
- Pending migrations run automatically at start, after a dated backup copy of the database (`09` §2). [Q-075, recommendation accepted]
- Schema changes are additive first; destructive steps need an approved plan (`14` §8). [Q-081, recommendation accepted]
- Migrations are tested on a generated fixture database; no real campaign data enters the repository or CI (`14` §8). [Q-082, recommendation accepted]
- UUIDs (sha256 for Image) are the only keys; no internal sequential key exists (`14` §8). [Q-084, recommendation accepted]

## 2. Security

- The server is the only source of truth, checking every command before applying it (`02` §3). [input]
- Filtering by role happens on the server; a player client never learns that a hidden token exists (`04` §4). [input]
- No accounts; a PIN protects the DM view (`07` §1). [input]
- The PIN is first set from the server machine only, changed in the DM view, and reset by a command on the server machine (`07` §1). [Q-007, recommendation accepted]
- A DM session lasts until the server restarts and is never written to disk (`07` §2). [Q-008, recommendation accepted]
- The PIN is 4–8 digits with per-client lockout after 5 failures, doubling (`07` §6). [Q-009, recommendation accepted]
- The player view is open to any LAN browser, read-only, any number of screens (`07` §3). [Q-010, recommendation accepted]
- Plain HTTP and WebSocket on the LAN; the README states the exposure (`07` §4). [Q-011, recommendation accepted]
- Players may fetch only the display version of the live map and of visible tokens' images (`07` §5). [Q-012, recommendation accepted]
- Uploads are PNG, JPEG or WebP by content, up to a configurable limit defaulting to 50 MB (`05` §6). [input]
- Changing the PIN ends every other DM session (`07` §2). [Q-033, recommendation accepted]
- The PIN is stored only as a salted slow hash (`07` §1). [Q-042, recommendation accepted]
- The DM session is an HttpOnly, SameSite=Strict cookie, with Origin checks on REST writes and WebSocket handshakes (`07` §2). [Q-043, recommendation accepted]
- Logs never contain a PIN, session identifier or cookie (`07` §8). [Q-044, recommendation accepted]
- New npc and object assets default to visible (`05` §4). [Q-045, recommendation accepted]
- The DM session is the only source of DM rights: every REST route but PIN entry and setup, and the `dm` room (`02` §5, `04` §1, `07` §7). [Q-046, recommendation accepted]
- A player client receives only the rendering fields of visible tokens (`04` §4). [Q-047, recommendation accepted]
- Image URLs carry the sha256 of the original; access depends on entitlement (`05` §7). [Q-057, recommendation accepted]
- The DM can sign a browser out of the DM view (`07` §2). [Q-058, recommendation accepted]
- The release is gated on a recorded-traffic test proving no hidden token reaches a player view (`10` §3). [Q-067, recommendation accepted]
- A test proves every player-view command is rejected (`10` §3). [Q-068, recommendation accepted]
- Security and hidden-information rules override convenience (`specs/README.md`). [Q-069, recommendation accepted]
- The DM is told to allow the server on private networks only (`09` §4). [Q-076, recommendation accepted]
- Hiding and deleting a token reach players as the same event (`04` §3). [Q-083, recommendation accepted]
- `/api/auth` tells a browser only whether it itself holds a DM session (`02` §5). [Q-085, recommendation accepted]
- Measurements on a scene that is not live never leave the DM view (`04` §11). [Q-086, recommendation accepted]

## 3. Scope

- The MVP covers preparation and display for in-person play by a DM alone; players and rules come in Phase 2 (`01` §1, `01` §4). [input]
- No player devices, character sheets, remote play or map creation in the MVP (`01` §2, `01` §7). [input]
- No game rules in code (`01` §1). [input]
- The MVP capability list of `01` §3 is the release content. [input]
- Campaign export/import is Phase 2 (`01` §4). [Q-013, recommendation accepted]
- Live token commands are add, move, visibility and delete (`04` §2). [input, Q-014, recommendation accepted]
- The live scene's setup can be edited while live and is pushed as a snapshot (`04` §10). [Q-015, recommendation accepted]
- No area-of-effect templates or ping in the MVP (`01` §6). [Q-016, recommendation accepted]
- Installed from source with Node; nothing published to a registry (`09` §1). [Q-017, recommendation accepted]
- Windows and Linux verified; macOS best-effort (`09` §3). [Q-018, recommendation accepted]
- Player view accepted on evergreen browsers and the owner's LG TV built-in browser (`10` §4). [Q-019, recommendation accepted]
- The ruler measures two points, without waypoints (`06` §5). [Q-048, recommendation accepted]
- The MVP stays hostable by a later desktop wrapper, with no packaging work (`02` §8). [Q-049, recommendation accepted]
- Undo does not cover live setup edits (`04` §8). [Q-050, recommendation accepted]
- Settings are changed from a DM-view settings screen without restarting (`09` §7). [Q-051, recommendation accepted]
- Alt while dropping places a token off the grid (`06` §4). [Q-059, recommendation accepted]
- The MVP is accepted against a 10,000 × 7,000 px map with 50 tokens (`10` §3). [Q-060, recommendation accepted]
- The MVP is accepted by the five critical journeys plus the automated gates (`10` §5). [Q-061, recommendation accepted]
- Every MUST not labelled Future is part of MVP acceptance (`specs/README.md`). [Q-062, recommendation accepted]
- Future items are anticipated in the architecture but not implemented (`specs/README.md`). [Q-070, recommendation accepted]
- Ambiguities affecting data, security or scope become an ADR for owner approval before code (`specs/README.md`). [Q-071, recommendation accepted]
- Changing a locked decision needs an ADR with alternatives, impact, migration and testing, and owner approval (`12` §6). [Q-072, recommendation accepted]
- Small implementation details may be decided locally if recorded in `DECISIONS.md` and the locked behaviour is kept (`12` §6). [Q-073, recommendation accepted]
- New product promises are classified in the traceability matrix before implementation (`11` §Coverage rule). [Q-074, recommendation accepted]
- The register and the product statement override conflicting detail (`specs/README.md`). [Q-077, recommendation accepted]
- Everything labelled MVP is required before the first release (`specs/README.md`). [Q-078, recommendation accepted]
- Out of Scope items are excluded unless reclassified through the matrix (`specs/README.md`). [Q-079, recommendation accepted]
- Ruler distances scale with the scene's feet per square (`06` §5). [Q-087, recommendation accepted]

## 4. External commitments

- Stack fixed by the owner: Node single process, React, Socket.io, SQLite, sharp (`specs/README.md`). [input]
- The running application contacts nothing outside the LAN and works offline (`02` §6). [Q-020]
- Source licensed under AGPL-3.0 (`01` §8). [Q-021]
- Public name Emberglass; no "D&D" or "Dungeons & Dragons" in names; described as 5e SRD 5.1 compatible (`01` §8). [Q-022]
- The repository is public on GitHub, with CI on GitHub Actions (Linux and Windows runners) (`13` §3). [Q-066, recommendation accepted]
- Test maps and tokens are generated; no third-party art enters the repository (`10` §3). [Q-088, recommendation accepted]
- SRD 5.1 content (CC-BY-4.0) arrives with Phase 2 (`01` §8). [input]

## 5. Product identity and UX

- One DM workspace: scene tree left, canvas centre, library right, live bar on top (`08` §1). [Q-023]
- One canvas with an unmistakable live mode and a prep mode that never reaches the TV (`08` §2). [Q-024]
- Independent DM and player cameras; the DM steers the player camera through a frame (`04` §9). [input]
- The player view shows a dark idle screen with the product name when nothing is live (`08` §4). [Q-025]
- The QR code and short URL open the player view, in the console and a "Connect a screen" panel; never the DM view (`08` §5). [Q-026]
- Ruler measurements on the live scene are shown on the TV (`04` §11). [Q-027]
- English UI with a single message catalogue (`08` §6). [Q-028]
- DM view for laptop and desktop with mouse and keyboard only (`08` §7). [Q-029]
- No formal accessibility target; keyboard-operable core actions and readable contrast (`08` §8). [Q-030]
- Visible tokens' labels are shown on the TV (`04` §4). [Q-032, recommendation accepted]
- The player view is at `/` and the DM view at `/dm` (`02` §2). [Q-052, recommendation accepted]
- The connect panel lists every LAN address and highlights the first private-range one (`08` §5). [Q-053, recommendation accepted]
- Hidden tokens are semi-transparent with a marker in the DM view; the player view has no controls (`08` §9). [Q-054, recommendation accepted]
- Token numbers are per scene, never reused; a lone token keeps the bare name (`05` §3). [Q-063, recommendation accepted]
- Tag filters narrow (all selected tags match); results sorted by name (`05` §1). [Q-064, recommendation accepted]
- The critical journeys are First run, Prepare, Connect TV, Run and Recover (`08` §10). [Q-065, recommendation accepted]
- The DM steers the TV camera by dragging and resizing the TV frame (`08` §2). [Q-080, recommendation accepted]
- Sessions and scenes are reordered by dragging in the sidebar, with a keyboard alternative (`08` §1). [Q-089, recommendation accepted]

## 6. Change control

These decisions are implementation constraints. A proposed change requires: [Q-072]

1. a short ADR describing the problem;
2. alternatives and security/data/scope impact;
3. migration and testing implications;
4. Product Owner approval before code changes.

The ADR is a `DECISIONS.md` entry of type `adr` carrying `Owner approval: pending` until the owner grants or rejects it. Agents MUST NOT reopen decisions merely because a different framework or pattern is familiar. Small implementation details may be decided locally if they preserve the locked behavior and are recorded in `DECISIONS.md`. [D-002, Q-072, Q-073]
