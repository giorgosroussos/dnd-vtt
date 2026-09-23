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
- All state lives in one data directory; backup is a folder copy (`09` §5). [input]

## 2. Security

- The server is the only source of truth and derives roles only from the DM session (`02` §3, `07` §7). [input]
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

## 3. Scope

- The MVP covers preparation and display for in-person play by a DM alone; players and rules come in Phase 2 (`01` §1, `01` §4). [input]
- No player devices, character sheets, remote play or map creation in the MVP (`01` §2, `01` §7). [input]
- No game rules in code beyond the token size table and the ruler's diagonal rules (`01` §1). [input]
- The MVP capability list of `01` §3 is the release content. [input]
- Campaign export/import is Phase 2 (`01` §4). [Q-013, recommendation accepted]
- Live token commands are add, move, visibility and delete (`04` §2). [input, Q-014, recommendation accepted]
- The live scene's setup can be edited while live and is pushed as a snapshot (`04` §10). [Q-015, recommendation accepted]
- No area-of-effect templates or ping in the MVP (`01` §6). [Q-016, recommendation accepted]
- Installed from source with Node; nothing published to a registry (`09` §1). [Q-017, recommendation accepted]
- Windows and Linux verified; macOS best-effort (`09` §3). [Q-018, recommendation accepted]
- Player view accepted on evergreen browsers and the owner's LG TV built-in browser (`10` §4). [Q-019, recommendation accepted]

## 4. External commitments

- Stack fixed by the owner: Node single process, React, Socket.io, SQLite, sharp (`specs/README.md`). [input]
- The running application contacts nothing outside the LAN and works offline (`02` §6). [Q-020]
- Source licensed under AGPL-3.0 (`01` §8). [Q-021]
- Public name Emberglass; no "D&D" or "Dungeons & Dragons" in names; described as 5e SRD 5.1 compatible (`01` §8). [Q-022]
- SRD 5.1 content and its CC-BY-4.0 attribution arrive with Phase 2 (`01` §8). [input]

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

## 6. Change control

These decisions are implementation constraints. A proposed change requires:

1. a short ADR describing the problem;
2. alternatives and security/data/scope impact;
3. migration and testing implications;
4. Product Owner approval before code changes.

The ADR is a `DECISIONS.md` entry of type `adr` carrying `Owner approval: pending` until the owner grants or rejects it. Agents MUST NOT reopen decisions merely because a different framework or pattern is familiar. Small implementation details may be decided locally if they preserve the locked behavior and are recorded in `DECISIONS.md`. [D-002]
