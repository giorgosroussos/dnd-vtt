# DECISIONS

Generated file. The source of truth is the append-only, hash-chained event log at `.log/events.jsonl`; this file is its projection. Do not edit it by hand: an edit here does not change what was decided, and `make check-docs` fails until the file equals a fresh rebuild (`projection-fresh`). To record a decision, append an event with `scripts/log-append.py` and run `make rebuild-decisions`.

Nothing in the log is ever rewritten or deleted. A record is retired by appending a `decision-superseded` event, which renders as a `Status: superseded by D-MMM` line on the superseded entry; its text stays readable, because the alternatives it weighed are the only record of why the decision reads as it does. Types: `implementation` (latitude the specs allow), `spec-amendment` (a non-locked spec text change made in the same commit), `adr` (a change to a locked decision or red line; carries `Owner approval: pending | granted YYYY-MM-DD | rejected`). An implementation session reads the index below and the entries its `PLAN.md` item cites, not the whole file. `make check-docs` verifies the IDs, the fields, the index, the chain and this projection.

Entry format:

```
## D-NNN (YYYY-MM-DD) — Title
Type: …
Decision: …
Why: …
Alternatives: …
Affected specs: …
```

## Index

- D-001 — Repository documentation regime — implementation
- D-002 — Spec amendment regime — implementation
- D-003 — Authority of non-authoritative inputs — implementation
- D-004 — Division of labour between spec documents and living documents — implementation
- D-005 — Agent execution contract — implementation
- D-006 — Canvas library — implementation
- D-007 — Language and repository shape — implementation
- D-008 — HTTP server framework — implementation
- D-009 — SQLite access and migrations — implementation
- D-010 — Client build tool — implementation
- D-011 — Test tooling — implementation
- D-012 — Node version — implementation
- D-013 — Repository layout — implementation
- D-014 — Port and view routes — implementation
- D-015 — REST base path and resource shape — implementation
- D-016 — Grid of a scene without a map — implementation
- D-017 — Live event version counter — implementation
- D-018 — Player camera on activation — implementation
- D-019 — Automatic token numbering — implementation
- D-020 — Default visibility of npc and object assets — implementation
- D-021 — Image variants and display size setting — implementation
- D-022 — Library search and filter — implementation
- D-023 — Snapping rules — implementation
- D-024 — Ruler setting scope and defaults — implementation
- D-025 — Ruler geometry — implementation
- D-026 — Grid overlay in the DM view — implementation
- D-027 — PIN storage and DM session mechanics — implementation
- D-028 — PIN reset command — implementation
- D-029 — What logs contain — implementation
- D-030 — LAN address shown for connecting — implementation
- D-031 — Presentation details of the two views — implementation
- D-032 — Upload rejection behaviour — implementation
- D-033 — Install and start commands — implementation
- D-034 — Data directory and configuration — implementation
- D-035 — Log output — implementation
- D-036 — Test fixtures for load and acceptance — implementation
- D-037 — Work packages that change a contract — implementation
- D-038 — Who generates UUIDs — implementation
- D-039 — Snapshot on scene activation — implementation
- D-040 — Undo mechanism — implementation
- D-041 — Firewall guidance — implementation
- D-042 — Test gates beyond the inputs — implementation
- D-043 — Recording new product promises — implementation
- D-044 — Upload size enforced while receiving — implementation
- D-045 — Ruler distance unit — implementation
- D-046 — Steering the player camera — implementation
- D-047 — Validating WebSocket commands — implementation
- D-048 — Current role on the auth resource — implementation
- D-049 — Event names for moves, deletions and the camera — implementation
- D-050 — Reordering in the sidebar — implementation
- D-051 — Static analysis and formatting — implementation
- D-052 — TypeScript builds and type checking of the workspaces — implementation
- D-053 — Development server on one port — implementation
- D-054 — Migration runner mechanics — implementation
- D-055 — Test runner layout — implementation
- D-056 — Dependency and secret scanning — implementation
- D-057 — Development environment, smoke check and clean start — implementation
- D-058 — CI pipeline mechanics on Linux and Windows — implementation — superseded by D-060
- D-059 — Failing-forward tripwires for missing gates — implementation — superseded by D-061
- D-060 — CI pipeline mechanics on Linux and Windows (after review) — implementation
- D-061 — Failing-forward tripwires for missing gates (after review) — implementation
- D-062 — Contract schemas in shared and one strict validator — implementation — superseded by D-067
- D-063 — REST error envelope — implementation
- D-064 — WebSocket envelopes, acknowledgements and the version counter — implementation
- D-065 — Logger mechanics and redaction — implementation — superseded by D-066
- D-066 — Logger mechanics and redaction (after review) — implementation
- D-067 — Contract schemas in shared and one strict validator (after review) — implementation
- D-068 — Phase 0 evidence for a rejected WebSocket command — implementation
- D-069 — Design tokens, base components, focus and error patterns — implementation
- D-070 — Message catalogue and the check that it is the only UI text — implementation — superseded by D-073
- D-071 — Bundled font and icons — implementation
- D-072 — Keyboard, focus and contrast smoke tests, and jsdom for component tests — implementation
- D-073 — Message catalogue and the check that it is the only UI text (after review) — implementation
- D-074 — SQLite schema of the eight entities, its constraints and the fixture database — implementation — superseded by D-075
- D-075 — SQLite schema of the eight entities, its constraints and the fixture database (after review) — implementation
- D-076 — PIN, DM session, guessing protection and the /api session guard — implementation

## D-001 (2026-09-23) — Repository documentation regime
Type: implementation
Decision: `AGENTS.md` at repository root is the single entry point for agents; `CLAUDE.md` and any per-directory agent file are thin pointers to it with tool- or directory-specific notes only, never a second source of rules. Living documents (`PLAN.md`, `DECISIONS.md`, `GAPS.md`, `QUESTIONS.md`, `TRACEABILITY.md`) live at the root. Raw requirements live under `docs/inputs/` with their authority declared in `docs/inputs/README.md`. Agent decisions are recorded as events in the append-only, hash-chained log `.log/events.jsonl`, and `DECISIONS.md` is its projection: rebuilt by `scripts/rebuild-decisions.py`, never authored, and compared against the log on every run of the gate. The root `Makefile` is the command contract from the first commit: `make check-docs` (`scripts/check-docs.py`) is real and enforces the mechanical consistency of these documents; every other target fails with a message naming its work package until that package delivers it. `docs/` is otherwise reserved for runbooks and long-form ADRs once code exists.
Why: a fresh agent session must find one file and be unable to miss the current state. A rule that is checked mechanically does not need to be remembered, so every rule that can be a `check-docs` assertion is one and is not repeated in prose. A placeholder target that fails loudly keeps "the contract exists" and "the contract works" distinguishable. A record whose integrity is checked mechanically does not depend on anyone remembering not to edit it, which is why the decision stream is a log with a projection rather than a file that everyone promises to append to.
Alternatives: living documents under `docs/` (rejected: discoverability); a single combined status document (rejected: mixes history with current state); no `Makefile` until FND-01 (rejected: `check-docs` must run from day one and the contract's target list must be visible to the first implementation session); silently passing placeholder targets (rejected: indistinguishable from a working contract). `DECISIONS.md` itself as the source of truth (rejected: a changed body under an unchanged ID is invisible to any check that reads only the current state).
Affected specs: none.

## D-002 (2026-09-23) — Spec amendment regime
Type: implementation
Decision: agents may amend non-locked text in `specs/` when implementation requires it, provided the same change adds a dated `spec-amendment` entry here and the amended statement carries a provenance tag. Spec sections are never renumbered; new content is appended. Every bullet in `specs/12-decision-register.md` and every red line listed in `AGENTS.md` is excluded from delegation and requires an `adr` entry with owner approval before code changes.
Why: keeps the spec pack accurate as implementation reveals defects, without weakening the change control that `12` §6 requires for locked decisions. Stable numbering keeps every citation in the living documents resolving, which `make check-docs` verifies.
Alternatives: no agent spec edits at all (rejected: specs drift from code); full delegation including locked decisions (rejected: contradicts the register's change control).
Affected specs: operationalizes `specs/README.md` §Conflict resolution and `12` §6; no text changed.

## D-003 (2026-09-23) — Authority of non-authoritative inputs
Type: implementation
Decision: No non-authoritative input was received. Any mockup, competitor reference or prior draft added later receives an authority row in docs/inputs/README.md and a superseding entry before an agent may use it.
Why: an input without a declared authority level becomes a requirements source by default, silently.
Alternatives: treat all inputs as authoritative (rejected: direction and requirements would blend).
Affected specs: none.

## D-004 (2026-09-23) — Division of labour between spec documents and living documents
Type: implementation
Decision: `specs/11-traceability.md` remains the owner-maintained product-intent scope matrix; root `TRACEABILITY.md` records implementation status and evidence per work package and critical journey, with status set only from evidence that ran and passed. `specs/12-decision-register.md` remains the locked register of owner decisions with their provenance; the event log records implementation decisions, spec amendments and ADR proposals as events, and root `DECISIONS.md` is the projection an agent reads. `specs/13-implementation-plan.md` remains the phase plan; root `PLAN.md` holds only the current slice and the next few. `QUESTIONS.md` holds the decision cards, open and resolved; a resolved card is cited by the spec statement it produced.
Why: avoids duplicating or silently editing spec documents while still giving agents a truthful, frequently updated status surface. Keeping the cards in one place with their answers preserves the alternatives the owner saw when deciding.
Alternatives: editing status into the spec files (rejected: churns the contract); no implementation traceability (rejected: the playbook's Definition of Done requires reproducible verification); deleting answered cards (rejected: the alternatives considered are the only record of why the locked decision reads as it does).
Affected specs: none.

## D-005 (2026-09-23) — Agent execution contract
Type: implementation
Decision: Every implementation agent works under the execution contract of `specs/14-agent-playbook.md` §3: inspect before editing, restate assumptions and flag conflicts with locked decisions, implement the smallest coherent slice, add or update tests in the same change, run targeted then broader suites, keep contract artifacts and docs in step, and report changed behaviour, migration and rollback implications and remaining risks; and never changes scope or a locked decision, introduces an excluded capability, trusts a client-supplied ownership identifier, weakens a test to pass CI, edits or reformats unrelated code, builds speculative abstractions, commits secrets or sample personal data, or runs a destructive migration without an approved plan. The contract binds the agent's method, not the product: it touches no data, security, scope, external or UX decision, which is why it is a recorded default and not a card.
Why: an agent without a stated method fills the gaps with habit, and the habits that cost most (widening scope, weakening a test, trusting the client) are the ones no spec statement names because they are not about the product. Stating the method once, in the playbook, with a provenance tag, keeps it out of `AGENTS.md` prose and lets `make check-docs` hold the playbook to the same rule as every other spec: no normative statement without a home.
Alternatives: no explicit contract (rejected: the method drifts per session); the contract as red lines in `AGENTS.md` (rejected: red lines are product constraints with spec citations, and the file has a size ceiling); tagging the contract `[input]` (rejected: the owner never said it; it is the pack's default and must read as one).
Affected specs: `14` §3 carries the tag; no text changed.

## D-006 (2026-09-23) — Canvas library
Type: implementation
Decision: The map canvas of both views is built with react-konva (Konva) on React.
Why: the input offers "react-konva (or PixiJS)"; react-konva is declarative React, matches the drag, zoom and layer needs the input names, and the token counts of one table are far below where a WebGL renderer pays off.
Alternatives: PixiJS with @pixi/react (rejected: WebGL renderer adds a second rendering model for no need at this scale, and weaker built-in hit testing and transformer tools); plain Canvas 2D (rejected: re-implements layers, hit testing and drag).
Affected specs: `specs/README.md` §Technology baseline.

## D-007 (2026-09-23) — Language and repository shape
Type: implementation
Decision: TypeScript on both server and client, in one repository with npm workspaces: `server`, `client`, and `shared` for the types of the REST and WebSocket contracts.
Why: one set of contract types shared by both sides removes a class of sync bugs in the command/event protocol; npm ships with Node, so no extra tool is needed.
Alternatives: plain JavaScript (rejected: the command and event protocol is the core contract and benefits most from types); separate repositories (rejected: contract changes would span two repositories); pnpm or yarn workspaces (rejected: an extra install step for DMs running from source).
Affected specs: `specs/README.md` §Technology baseline.

## D-008 (2026-09-23) — HTTP server framework
Type: implementation
Decision: Fastify serves the REST API and the built React client, with Socket.io attached to the same HTTP server, in one Node process.
Why: built-in schema validation for REST bodies and multipart upload support via a first-party plugin; one process as the input requires.
Alternatives: Express (rejected: validation and upload handling are all third-party middleware); Koa (rejected: smaller ecosystem for the same need); Node's http module alone (rejected: re-implements routing and validation).
Affected specs: `specs/README.md` §Technology baseline.

## D-009 (2026-09-23) — SQLite access and migrations
Type: implementation
Decision: better-sqlite3 with hand-written SQL and numbered SQL migration files applied at server start.
Why: synchronous, fast, and the most used SQLite binding for Node; plain SQL keeps the eight-entity schema readable and migrations reviewable.
Alternatives: node:sqlite (rejected: younger API surface); Prisma (rejected: a generator and engine binary for eight tables); Drizzle or Knex (rejected: a query-builder layer the schema's size does not need).
Affected specs: `specs/README.md` §Technology baseline.

## D-010 (2026-09-23) — Client build tool
Type: implementation
Decision: Vite builds the React client; the production build is static files served by the Node server.
Why: the standard React build tool, fast dev server with proxying to the API and WebSocket.
Alternatives: webpack (rejected: more configuration for the same output); Next.js (rejected: a server framework of its own, conflicting with the single Node process that serves everything).
Affected specs: `specs/README.md` §Technology baseline.

## D-011 (2026-09-23) — Test tooling
Type: implementation
Decision: Vitest for unit and integration tests on both sides; Playwright for end-to-end tests that drive a DM view and a player view in two browser contexts against a running server.
Why: Vitest shares Vite's configuration and runs TypeScript natively; Playwright can open two contexts at once, which the visibility and live-sync acceptance scenarios need.
Alternatives: Jest (rejected: separate TypeScript transform); Cypress (rejected: one browser context per test makes the DM/player pair awkward).
Affected specs: `specs/README.md` §Technology baseline.

## D-012 (2026-09-23) — Node version
Type: implementation
Decision: Node.js 24 LTS, declared in `engines` and `.nvmrc`; the server refuses to start on an older major.
Why: the active LTS line at the time of writing, supported beyond the MVP.
Alternatives: Node 22 (rejected: shorter remaining support); the current non-LTS line (rejected: short support window for DMs who install once).
Affected specs: `specs/README.md` §Technology baseline.

## D-013 (2026-09-23) — Repository layout
Type: implementation
Decision: Top-level workspaces `server/`, `client/`, `shared/`, plus `e2e/` for Playwright tests and `scripts/` for tooling; server code under `server/src/` split into `http/`, `ws/`, `domain/`, `db/`, `images/`, with SQL migrations in `server/migrations/`; client code under `client/src/` split into `dm/`, `player/`, `canvas/`, `ui/`.
Why: mirrors the REST/WebSocket split and the two views the specs define, so a work package touches a predictable set of directories.
Alternatives: feature folders across server and client (rejected: the contract boundary between server and client is the most important seam); a single package (rejected: server-only dependencies such as sharp would leak into the client build).
Affected specs: `specs/02-architecture.md` §1.

## D-014 (2026-09-23) — Port and view routes
Type: implementation
Decision: The server listens on TCP port 3000 by default (configurable). The player view is served at `/` and the DM view at `/dm`, from the same client build.
Why: the player view is the address typed into a TV browser, so it gets the shortest URL; the DM reaches `/dm` from the "Connect a screen" panel or localhost.
Alternatives: DM view at `/` and player view at `/tv` (rejected: longer URL on the device with the worst keyboard); separate ports per view (rejected: two firewall prompts on Windows).
Affected specs: `specs/02-architecture.md` §2.

## D-015 (2026-09-23) — REST base path and resource shape
Type: implementation
Decision: REST endpoints live under `/api`, JSON bodies, resource-oriented paths nested only one level (e.g. `/api/campaigns/:id/sessions`), request bodies validated by Fastify JSON schemas generated from the `shared` types.
Why: conventional, easy to test with plain HTTP, and the validation schemas stay in step with the shared contract types.
Alternatives: versioned `/api/v1` (rejected: one client ships with the server, so there is no second consumer to version for); RPC-style endpoints (rejected: the preparation side is plain CRUD).
Affected specs: `specs/02-architecture.md` §5.

## D-016 (2026-09-23) — Grid of a scene without a map
Type: implementation
Decision: A scene without a map stores an explicit grid extent in columns and rows (default 30 x 20) and renders on a neutral dark background that is not configurable in the MVP; calibration methods apply only to scenes with a map. A map may be attached to a map-less scene later, after which the grid is calibrated to that map.
Why: the owner's answer to Q-006 requires an explicit extent; the default and the background colour touch no surface.
Alternatives: an unbounded grid (rejected: fit-to-map and the player camera need an extent); a configurable background colour (rejected: not in the inputs).
Affected specs: `specs/03-domain-model.md` §6.

## D-017 (2026-09-23) — Live event version counter
Type: implementation
Decision: One monotonic version counter per server process, incremented on every event emitted for the live scene and carried by every event and snapshot; it restarts at 1 when the server starts, and every client treats a lower version than its last seen as a gap.
Why: the input requires ascending version numbers with gap detection; nothing needs to survive a restart because every client takes a fresh snapshot on reconnect.
Alternatives: a persisted counter (rejected: no consumer needs continuity across restarts); a counter per scene (rejected: scene activation would need its own ordering).
Affected specs: `specs/04-live-sync.md` §5.

## D-018 (2026-09-23) — Player camera on activation
Type: implementation
Decision: The player camera is held in server memory for the live scene and reset to fit-to-map (fit to the grid extent for a map-less scene) whenever a scene is activated.
Why: the input says the player view starts with fit-to-map; a camera position has no value once the scene changes.
Alternatives: store the last player camera per scene (rejected: adds stored state the inputs do not ask for); keep the previous camera across scenes (rejected: maps differ in size).
Affected specs: `specs/04-live-sync.md` §9.

## D-019 (2026-09-23) — Automatic token numbering
Type: implementation
Decision: Numbering is per scene: when a token of an asset is added and the scene already holds tokens of that asset, the new token's label is the asset name followed by the next free number ("Goblin 5" after "Goblin 1" to "Goblin 4"); the first token of an asset on a scene carries the bare name until a second one is added, at which point the first becomes "<name> 1". Numbers freed by deletion are not reused within the scene.
Why: the input fixes the outcome (4 goblins become Goblin 1-4); the per-scene scope and the reuse rule touch no surface.
Alternatives: numbering per session (rejected: labels are scene-local); always numbering from 1 even for a single token (rejected: "Goblin 1" alone is noise); reusing freed numbers (rejected: a player's "Goblin 3" could silently become a different token).
Affected specs: `specs/05-assets-and-images.md` §3.

## D-020 (2026-09-23) — Default visibility of npc and object assets
Type: implementation
Decision: A new asset's `default_hidden` starts from its category: `monster` hidden; `pc`, `npc` and `object` visible. The DM can change it per asset.
Why: the input fixes monster (hidden) and player characters (visible); the stored per-asset flag makes the other two a starting value only.
Alternatives: npc hidden by default (rejected: npcs are usually introduced openly, and the per-asset flag covers the exceptions).
Affected specs: `specs/05-assets-and-images.md` §4.

## D-021 (2026-09-23) — Image variants and display size setting
Type: implementation
Decision: On upload the server keeps the original and writes a display variant whose long edge is at most the display-size setting (default 4096 px, never upscaled) and a 256 px thumbnail, both WebP. Changing the setting regenerates every display variant in the background. Files are served at `/images/<sha256>/<variant>`.
Why: the input names the display size as an open question to be tested on the owner's TV; a setting lets that test tune it without code, and WebP keeps transfers small for TV browsers.
Alternatives: a fixed size (rejected: the input says it needs testing); 2048 or 8192 px defaults (rejected: 2048 blurs large battlemaps when zoomed, 8192 is the size range the input says crashes TV browsers); keeping the original format for variants (rejected: larger files for no gain).
Affected specs: `specs/05-assets-and-images.md` §7.

## D-022 (2026-09-23) — Library search and filter
Type: implementation
Decision: The picker and the library search by case-insensitive substring over asset name and tags, filter by category and by one or more tags (all must match), and sort by name.
Why: the input asks for search and filter without further detail; this is the simplest behaviour that covers both.
Alternatives: full-text search with ranking (rejected: a personal library is small); any-tag matching (rejected: filtering narrows, it does not widen).
Affected specs: `specs/05-assets-and-images.md` §1.

## D-023 (2026-09-23) — Snapping rules
Type: implementation
Decision: Snap-to-grid is on by default: a dropped token's footprint aligns to whole squares (Tiny tokens to half squares). Holding Alt while dropping places the token freely, keeping the decimal position.
Why: positions are stored as decimal grid units, so free placement costs nothing; a modifier keeps the default fast.
Alternatives: a toolbar toggle (rejected: an extra control on a crowded canvas); no free placement (rejected: objects often sit between squares).
Affected specs: `specs/06-grid-and-measurement.md` §4.

## D-024 (2026-09-23) — Ruler setting scope and defaults
Type: implementation
Decision: The diagonal rule (PHB: every diagonal 5 ft; DMG: alternating 5/10 ft) is one server-wide setting, default PHB. A new scene's feet per square defaults to 5.
Why: the input calls the DMG rule "a setting" and the server hosts one game; 5 ft is the rules' square.
Alternatives: per-campaign setting (rejected: adds a Campaign field for a setting the input places under settings).
Affected specs: `specs/06-grid-and-measurement.md` §5.

## D-025 (2026-09-23) — Ruler geometry
Type: implementation
Decision: The ruler measures a straight path between two points, both snapped to square centres, and reports the distance in feet under the active diagonal rule; it has no waypoints.
Why: the smallest ruler that answers "how far can I move" on a square grid.
Alternatives: waypoints (rejected: not in the inputs); Euclidean distance (rejected: contradicts both rules the input names).
Affected specs: `specs/06-grid-and-measurement.md` §5.

## D-026 (2026-09-23) — Grid overlay in the DM view
Type: implementation
Decision: The DM view always draws the grid overlay (faintly when it is hidden for players); a scene's `grid.visible` governs the player view only.
Why: the DM needs the grid to place tokens even on maps with a drawn grid.
Alternatives: one flag for both views (rejected: hiding it for players would hide it from the DM).
Affected specs: `specs/06-grid-and-measurement.md` §2.

## D-027 (2026-09-23) — PIN storage and DM session mechanics
Type: implementation
Decision: The PIN is stored only as a scrypt hash with a random salt in Settings. A DM session is a random 256-bit identifier held in server memory and sent as an HttpOnly, SameSite=Strict cookie; the Socket.io handshake reads the same cookie. REST writes and WebSocket handshakes with an Origin header that does not match the server's own host are refused.
Why: implements the owner's choices on PIN and session lifetime with standard primitives; the Origin check stops another page in the DM's browser from driving the API.
Alternatives: bcrypt or argon2 (rejected: native dependencies where Node's built-in scrypt suffices); a signed token instead of a server-held session (rejected: sessions end at restart by design, so there is nothing to sign for).
Affected specs: `specs/07-security-and-access.md` §1, §2.

## D-028 (2026-09-23) — PIN reset command
Type: implementation
Decision: `npm run reset-pin`, run on the server machine, clears the PIN hash; the next DM view opened from localhost shows the first-run PIN setup.
Why: the owner chose reset by a command on the server machine; the command name is not a surface.
Alternatives: a flag on the start command (rejected: easy to leave in a start script by mistake).
Affected specs: `specs/07-security-and-access.md` §1.

## D-029 (2026-09-23) — What logs contain
Type: implementation
Decision: Logs record start-up, the LAN addresses served, connections by role, failed PIN attempts with client address, lockouts and errors; they never contain a PIN, a session identifier or a cookie.
Why: enough to diagnose a game night; nothing that grants access.
Alternatives: no logging (rejected: failed PIN attempts should be visible); request logging of every call (rejected: noise and cookie exposure risk).
Affected specs: `specs/07-security-and-access.md` §8.

## D-030 (2026-09-23) — LAN address shown for connecting
Type: implementation
Decision: The server lists every non-internal IPv4 address; the connect panel and the console show the first private-range address prominently with the player-view URL and QR code, and list the others below it.
Why: PCs often have several interfaces (VPN, virtual adapters); showing all avoids a dead URL.
Alternatives: only the first address (rejected: often a virtual adapter); IPv6 addresses (rejected: long to type on a TV).
Affected specs: `specs/08-ux-journeys.md` §5.

## D-031 (2026-09-23) — Presentation details of the two views
Type: implementation
Decision: In the DM view a hidden token is drawn semi-transparent with a hidden marker. The player view has no controls or menus and hides the mouse cursor after two seconds of inactivity.
Why: the DM must see at a glance what the TV does not; the TV shows only the table.
Alternatives: hidden tokens in a separate layer toggle (rejected: the DM needs them in place to reveal them); a player view toolbar (rejected: nobody operates the TV).
Affected specs: `specs/08-ux-journeys.md` §9.

## D-032 (2026-09-23) — Upload rejection behaviour
Type: implementation
Decision: A rejected upload returns HTTP 415 (type) or 413 (size) with an error naming the reason, and nothing is written to the images folder or the database; files are received into a temporary location and moved into place only after validation and processing succeed.
Why: the input fixes what is rejected; how the rejection is reported and that it leaves no trace touch no surface.
Alternatives: a generic 400 (rejected: the DM needs to know whether to convert or shrink the file); writing then deleting (rejected: a crash mid-way would leave orphans).
Affected specs: `specs/05-assets-and-images.md` §6.

## D-033 (2026-09-23) — Install and start commands
Type: implementation
Decision: A DM installs with `npm install` at the repository root and starts with `npm start`, which builds the client if no build exists, applies pending migrations and starts the server; `npm run dev` runs server and Vite dev server with reload for development.
Why: the owner chose installation from source; two commands are the smallest documented path, and npm ships with Node.
Alternatives: a separate build step the DM must remember (rejected: a forgotten build serves nothing); a shell or batch script per OS (rejected: duplicates npm scripts and diverges on Windows).
Affected specs: `specs/09-operations.md` §1.

## D-034 (2026-09-23) — Data directory and configuration
Type: implementation
Decision: The data directory defaults to `%APPDATA%\Emberglass` on Windows, `~/Library/Application Support/Emberglass` on macOS and `$XDG_DATA_HOME/emberglass` (else `~/.local/share/emberglass`) on Linux, and holds `emberglass.db`, `images/` and `logs/`. Port and data directory are set by the environment variables `EMBERGLASS_PORT` and `EMBERGLASS_DATA_DIR`; everything else configurable lives in Settings, edited from the DM view. The README tells the DM to stop the server before copying the folder.
Why: per-user application data locations survive a fresh clone of the repository; environment variables need no config file format.
Alternatives: a `data/` folder inside the repository (rejected: a re-clone or `git clean` would delete the DM's campaigns); a config file (rejected: two settings do not need one).
Affected specs: `specs/09-operations.md` §5, §7.

## D-035 (2026-09-23) — Log output
Type: implementation
Decision: Logs go to the console and to `logs/emberglass.log` in the data directory, rotated at 5 MB with three old files kept, as one JSON object per line in the file and human-readable lines on the console.
Why: the console is what the DM sees; the file is what a bug report needs.
Alternatives: console only (rejected: lost when the window closes); no rotation (rejected: unbounded growth on a PC that runs for years).
Affected specs: `specs/09-operations.md` §6.

## D-036 (2026-09-23) — Test fixtures for load and acceptance
Type: implementation
Decision: Acceptance and end-to-end tests use a 10,000 x 7,000 px map and a scene of 50 tokens as the large-scene fixture, plus a map-less scene, generated by a script so no third-party art enters the repository.
Why: the input names 5,000-10,000 px battlemaps as the stress case; 50 tokens is above a busy encounter for one table.
Alternatives: real battlemaps from the web (rejected: licences); smaller fixtures (rejected: would not exercise the display-variant path the input worries about).
Affected specs: `specs/10-testing-acceptance.md` §3.

## D-037 (2026-09-23) — Work packages that change a contract
Type: implementation
Decision: Contract change is yes for FND-03, SRV-01, SRV-02, SRV-03, SRV-04, SRV-05, LIV-01, LIV-02, LIV-04, LIV-05, LIV-06, LIV-07 and REL-01, and no for every other package.
Why: these packages define the SQLite schema, a REST resource (including the settings resource of REL-01) or a WebSocket command or event in `shared`; the others consume contracts that already exist.
Alternatives: marking the PRP packages yes because they call REST (rejected: calling a contract does not change it); marking LIV-03 yes (rejected: the player view renders events defined by LIV-01 and LIV-02); marking REL-01 no (rejected: it adds the settings resource).
Affected specs: `specs/13-implementation-plan.md` §3-§7.

## D-038 (2026-09-23) — Who generates UUIDs
Type: implementation
Decision: UUIDs (v4) are generated by the server when it creates an entity; clients never supply identifiers for new entities.
Why: the input fixes UUIDs; generating them in one place keeps validation simple and needs no trust in client-supplied IDs.
Alternatives: client-generated UUIDs (rejected: the server would have to validate uniqueness and format of identifiers it did not create, for no offline benefit on a LAN app).
Affected specs: `specs/03-domain-model.md` §3.

## D-039 (2026-09-23) — Snapshot on scene activation
Type: implementation
Decision: Activating a scene sends every client a fresh `scene.snapshot` for its role, rather than a stream of per-token events.
Why: the input sends a snapshot on connection and events afterwards; an activation replaces the whole scene, which is what a snapshot carries.
Alternatives: a `scene.activated` event followed by one `token.added` per token (rejected: more messages and a window where the client shows a partial scene).
Affected specs: `specs/04-live-sync.md` §5.

## D-040 (2026-09-23) — Undo mechanism
Type: implementation
Decision: Ctrl+Z sends an `undo` command; the server takes the most recent inverse from its history and applies it through the ordinary command path, emitting the ordinary events.
Why: the input keeps the inverse history on the server and requires the inverse to travel as an ordinary command so sync is unchanged; applying it server-side avoids the client needing a copy of the history.
Alternatives: the client keeps its own inverse history and sends the inverse command itself (rejected: two histories that can diverge across several DM devices and after reconnects).
Affected specs: `specs/04-live-sync.md` §8.

## D-041 (2026-09-23) — Firewall guidance
Type: implementation
Decision: The start-up console and the README tell the DM to allow Node on private networks when Windows asks, and show how to open the port with a common Linux host firewall.
Why: the input warns that Windows asks for firewall permission on first start; a wrong answer there silently breaks the TV connection.
Alternatives: no guidance (rejected: the most likely first-run failure); configuring the firewall automatically (rejected: needs elevated rights).
Affected specs: `specs/08-ux-journeys.md` §5, `specs/09-operations.md` §4.

## D-042 (2026-09-23) — Test gates beyond the inputs
Type: implementation
Decision: The hidden-information suite records everything a player view receives across a scripted session and asserts no hidden token leaks; a test asserts that every players-room command is rejected; acceptance is run as the five critical journeys of `08` §10.
Why: the input's success criterion and its hidden-token principle need tests that would catch a regression; the journeys decompose the success criterion into runnable scenarios.
Alternatives: unit tests of the projection only (rejected: a leak through a new event type would pass them); a single happy-path end-to-end test (rejected: misses first run and recovery).
Affected specs: `specs/10-testing-acceptance.md` §3, §5.

## D-043 (2026-09-23) — Recording new product promises
Type: implementation
Decision: Any new commercial or product promise is added to the product-intent matrix and classified MVP, Future or Out of Scope before it is implemented; a code change alone never changes scope.
Why: keeps the owner-maintained matrix the single place where scope is read.
Alternatives: scope tracked only in the plan (rejected: the plan records work, not intent).
Affected specs: `specs/11-traceability.md` §Coverage rule.

## D-044 (2026-09-23) — Upload size enforced while receiving
Type: implementation
Decision: The upload size limit is enforced while the request body is received: the upload is aborted as soon as it exceeds the limit, before any image processing.
Why: the input fixes the limit; enforcing it while receiving keeps an oversized file from consuming memory or disk.
Alternatives: checking after the whole file is received (rejected: a 2 GB upload would be buffered first).
Affected specs: `specs/05-assets-and-images.md` §6.

## D-045 (2026-09-23) — Ruler distance unit
Type: implementation
Decision: Ruler distances are counted in squares under the active diagonal rule and multiplied by the scene's feet per square; with 5 ft squares this is exactly the PHB and DMG rules as written.
Why: the input stores feet per square on every scene and states the rules for 5 ft squares; scaling generalises them without changing them.
Alternatives: always 5 ft per square (rejected: the stored field would be ignored).
Affected specs: `specs/06-grid-and-measurement.md` §5.

## D-046 (2026-09-23) — Steering the player camera
Type: implementation
Decision: The frame showing what the TV sees is the steering control: dragging it pans the player camera and resizing it zooms, keeping the TV's aspect ratio.
Why: the input gives the frame as the way the DM sets the TV camera; direct manipulation needs no extra controls.
Alternatives: separate pan and zoom buttons for the player camera (rejected: slower and less exact than moving the frame).
Affected specs: `specs/08-ux-journeys.md` §2.

## D-047 (2026-09-23) — Validating WebSocket commands
Type: implementation
Decision: Every WebSocket command is validated against a schema derived from the `shared` command types before the server applies it; an invalid command is rejected with the shared error envelope and changes nothing.
Why: the input has the server check every command; the same schemas as REST keep one definition of the contract.
Alternatives: ad-hoc checks per handler (rejected: drifts from the shared types).
Affected specs: `specs/07-security-and-access.md` §7.

## D-048 (2026-09-23) — Current role on the auth resource
Type: implementation
Decision: `GET /api/auth` tells the calling browser whether it holds a DM session, so the client can show the PIN screen or the DM view; it reveals nothing about other sessions.
Why: the client needs to know which screen to show without trying a protected route and handling the failure.
Alternatives: probing a protected route and treating 401 as "not signed in" (rejected: conflates errors with state).
Affected specs: `specs/02-architecture.md` §5.

## D-049 (2026-09-23) — Event names for moves, deletions and the camera
Type: implementation
Decision: A move is announced as `token.updated`, a deletion as `token.removed`, and a player-camera change as `camera.player`, reusing the event names the input already defines where they fit.
Why: the input names token.added, token.updated and token.removed; reusing them keeps the protocol small.
Alternatives: separate `token.moved` and `token.deleted` events (rejected: the player client would need to treat deletion and hiding differently, which could reveal that a token was hidden rather than removed).
Affected specs: `specs/04-live-sync.md` §3.

## D-050 (2026-09-23) — Reordering in the sidebar
Type: implementation
Decision: The DM changes the order of sessions within a campaign and of scenes within a session by dragging them in the sidebar tree; the new order is saved to the entities' `order` fields.
Why: the input stores an `order` on sessions and scenes; the sidebar (Q-023) is where they are listed, so it is where they are reordered.
Alternatives: up/down buttons (rejected: slower for long lists); a separate ordering dialog (rejected: another screen for a one-step action).
Affected specs: `specs/08-ux-journeys.md` §1.

## D-051 (2026-09-23) — Static analysis and formatting
Type: implementation
Decision: `make lint` runs ESLint with typescript-eslint's type-aware recommended rules over every workspace and the repository scripts, plus the React hooks rules in the client, with zero warnings allowed. `make format` and `make format-check` run Prettier over code and configuration only; Markdown, the event log, `specs/`, `docs/` and `.githooks/` are excluded because the documentation pack has its own gate and several of its files are generated or hard-locked. TypeScript is pinned to the 6.0 line (`~6.0.3`).
Why: Type-aware rules such as floating-promise detection catch the async mistakes a Fastify and Socket.io server invites; Prettier ends formatting review. TypeScript 7 (the native compiler) is the current release, but typescript-eslint supports TypeScript below 6.1 only, so the newest TypeScript the linter can read is the one pinned.
Alternatives: Biome for both lint and format (rejected: no type-aware rules); oxlint (rejected: same gap); TypeScript 7 with linting of syntax only (rejected: gives up the type-aware rules for compiler speed the project does not need at its size); Prettier over Markdown too (rejected: it would rewrite generated and locked documents).
Affected specs: `10` §1.

## D-052 (2026-09-23) — TypeScript builds and type checking of the workspaces
Type: implementation
Decision: `make typecheck` is `tsc -b` over a solution `tsconfig.json` referencing `shared`, `server`, `client` and `e2e`; each workspace's `tsconfig.json` checks sources, tests and tool configs without emitting. `shared` also has a composite `tsconfig.build.json` that emits JavaScript and declarations to `shared/dist`, referenced by server and client. The server is compiled by `tsc` (`server/tsconfig.build.json`, tests excluded) to `server/dist` and run by Node; the client is built by Vite. `shared` exports its source under the `development` condition and its build otherwise, so Vite, Vitest and the development server (`tsx --conditions=development`) use the source with no build step while production uses `dist`.
Why: Project references make the contract types in `shared` one compiled unit that both sides depend on, which is the reason the workspace exists (D-007). Plain `tsc` output keeps the production server free of a TypeScript runtime.
Alternatives: Bundling the server with esbuild or tsup (rejected: an extra tool for a server that needs no bundling); running TypeScript in production through tsx (rejected: a transpiler as a runtime dependency on the DM's PC); Node's built-in type stripping (rejected: it refuses files reached through `node_modules`, which is how workspaces link `shared`); path aliases instead of package exports (rejected: every tool would need the aliases repeated).
Affected specs: `02` §1, `10` §1.

## D-053 (2026-09-23) — Development server on one port
Type: implementation
Decision: `npm run dev` (and `make dev`) runs the Fastify server under `tsx watch` with Vite in middleware mode inside it, so the client, its hot reload and the API share one origin on the configured port, exactly as in production. The client tree is excluded from tsx's watcher; Vite reloads client changes itself.
Why: The DM session cookie is SameSite=Strict and REST writes and the WebSocket handshake check the Origin (`07` §2): a separate Vite port would make development differ from production on exactly the checks that matter, and a TV on the LAN would need a different URL in development. One port also keeps the Windows firewall to one prompt (D-014).
Alternatives: Vite's own dev server on a second port proxying `/api` and `/socket.io` to the server (rejected: two origins, so the Origin and cookie behaviour under test is not the one that ships); serving a watched client build from the server (rejected: no hot reload).
Affected specs: `09` §1, `02` §2.

## D-054 (2026-09-23) — Migration runner mechanics
Type: implementation
Decision: Migrations are files `server/migrations/NNNN_name.sql`, numbered from 0001 without gaps. The applied version is SQLite's `PRAGMA user_version`; each migration runs in one transaction with its version bump. The runner refuses a database whose version is newer than the code. When an existing, non-empty database has pending migrations, it first writes `emberglass-backup-<UTC time to the millisecond>-v<version>.db` in the data directory with `VACUUM INTO`. The server runs the runner before it listens, and `make migrate` runs it against the configured data directory.
Why: The locked data model has exactly eight entities (`03` §1), so the runner keeps its state in the database header instead of adding a ninth table. `VACUUM INTO` produces a consistent copy that includes pages still in a write-ahead log, which a plain file copy can miss. Refusing a newer database stops an older checkout from damaging a DM's data.
Alternatives: A migrations bookkeeping table (rejected: a table outside the eight entities); a third-party runner such as umzug or node-pg-migrate (rejected: a dependency for about forty lines); copying the file with the file system (rejected: misses a write-ahead log); a `backups/` subfolder (rejected: `09` §5 lists what the data directory holds, and a dated copy beside the database is what `09` §2 asks for).
Affected specs: `09` §2, `09` §5, `03` §1.

## D-055 (2026-09-23) — Test runner layout
Type: implementation
Decision: `make test` runs Vitest once from the root over the projects `shared`, `server` and `client`, each with its own `vitest.config.ts`. Integration tests create a temporary data directory with a real SQLite file and remove it afterwards. `make e2e` runs Playwright from the `e2e` workspace; its web server builds the product and starts it with `npm start` on port 3107 (`EMBERGLASS_E2E_PORT`) with a fresh temporary data directory that a global teardown removes, so end-to-end tests exercise the build a DM runs. Chromium only until the browser matrix of `10` §4 arrives with REL-02.
Why: One Vitest run gives one pass/fail for `make test`; testing the production build rather than the development server is what the TV will load.
Alternatives: One Vitest invocation per workspace (rejected: three reports for one gate); end-to-end tests against the development server (rejected: tests a different client than the one shipped); every browser from the start (rejected: the matrix is REL-02's scope and needs runners FND-02 provides).
Affected specs: `10` §1, `10` §2, `10` §4.

## D-056 (2026-09-23) — Dependency and secret scanning
Type: implementation
Decision: `make audit` is `npm audit --audit-level=high` over the whole lockfile, development dependencies included. `make scan-secrets` runs secretlint with its recommended preset over every file Git tracks plus untracked files that are not ignored.
Why: High and critical advisories block; moderate ones in a LAN-only app's tooling would stop work for issues that rarely apply. Development dependencies are audited because they build what ships. Scanning untracked files too catches a secret before its first commit, not after. secretlint installs from the lockfile like every other tool, on Linux and Windows alike.
Alternatives: gitleaks (rejected: a separate binary outside the lockfile, with its own install per OS); `--audit-level=moderate` or low (rejected: noise without a matching risk); auditing production dependencies only (rejected: the build toolchain produces the shipped files); scanning tracked files only (rejected: a secret would be caught only once committed).
Affected specs: `13` §3.

## D-057 (2026-09-23) — Development environment, smoke check and clean start
Type: implementation
Decision: `make setup` runs `npm ci`, installs Playwright's Chromium and copies `.env.example` to `.env` when missing. `.env` is read by the Makefile only and points `EMBERGLASS_DATA_DIR` at `.dev-data/` in the clone; a value already in the environment wins, and the product reads only real environment variables. Node 24 is enforced by `engines` with `engine-strict`, `.nvmrc`, a Makefile check before every Node target, `scripts/start.mjs` (in syntax an old Node can parse) and the server entry. `make smoke` has no health route: it loads `/` and `/dm` and their entry scripts and expects a 404 from an unknown `/api` path, retrying for `SMOKE_WAIT` seconds. `make clean-start` copies the files Git tracks plus untracked unignored files into a temporary directory, writes a `.env` with an empty temporary data directory and port 3207, runs setup, infra-up, migrate and verify, starts `make dev`, runs `make smoke` against it, and removes both directories.
Why: The owner is both developer and DM: without a development data directory, `make dev` would open the real campaigns. A health route under `/api` would be reachable without a DM session, which `02` §5 forbids for every route but PIN entry and setup, and loading the two views is what a TV and a DM do anyway. Copying the working tree lets clean-start judge the change about to be committed, not only the last commit.
Alternatives: The per-user default data directory in development (rejected: development would touch real campaign data); `/api/health` (rejected: an unauthenticated route `02` §5 does not allow); a health route outside `/api` (rejected: a public endpoint with no product purpose); `git clone` of HEAD for clean-start (rejected: it cannot verify uncommitted work).
Affected specs: `09` §1, `09` §7, `02` §5, `13` §3.

## D-058 (2026-09-23) — CI pipeline mechanics on Linux and Windows
Status: superseded by D-060
Type: implementation
Decision: `.github/workflows/ci.yml` runs on every pull request, every push to `main` and on demand. Two jobs, `linux` (`ubuntu-latest`) and `windows` (`windows-latest`), each a matrix over the gate targets `lint`, `format-check`, `typecheck`, `test`, `e2e`, `build`, `check-docs`, `audit` and `scan-secrets`, one job per target per runner, `fail-fast` off. A job provisions the machine (checkout, Node from `.nvmrc`, `make setup`) and then runs exactly one `make <target>`; `check-docs` skips Node and `make setup` because it needs Python only. On Windows, where the image has no `make`, the steps run in the image's preinstalled MSYS2 (via `msys2/setup-msys2`, `path-type: inherit`, packages `make` and `python`), so `make` and bash come from MSYS2 while node, npm and git stay the native Windows ones the product runs on. `make setup` gains `SETUP_BROWSERS` (default `chromium`); CI sets it empty on jobs without a browser and to `--with-deps chromium` for the Linux `e2e` job. Caches: npm through `setup-node` and Playwright browsers through `actions/cache`, both keyed on `package-lock.json`; the `e2e` job uploads `e2e/test-results/` for seven days when it fails. No job retries, Playwright keeps `retries: 0`, and a newer push cancels an older run of the same pull request. Every action is pinned to a commit SHA with its tag in a comment, and the workflow token is read-only. `.gitattributes` normalizes text to LF, and the tracked `*:Zone.Identifier` file (Windows download metadata, whose `:` no Windows checkout accepts) is removed and ignored. `scripts/scan-secrets.mjs` quotes file names and batches them under the 8191-character command line of `cmd.exe` on Windows.
Why: One target per job is what makes a green pipeline mean a green `make verify` (`10` §1), and running the same targets on Windows is the only automatic verification of `09` §3 and `10` §4 before release. MSYS2 is already on the image, so no Windows port of the Makefile is needed, and the product still runs on native Node. Without LF normalization a Windows checkout would fail `format-check` and change the bytes the event log's hash chain covers. The unquoted file list broke `scan-secrets` on Windows at the first file name containing `&`, and a longer list would pass the `cmd.exe` limit. SHA pinning keeps a moved tag from changing what CI runs.
Alternatives: Git Bash with a native Windows `make` from Chocolatey (rejected: a native `make` does not resolve `SHELL := /bin/bash`); MSYS2 `make` called from Git Bash (rejected: two MSYS runtimes in one process tree); a PowerShell port of the command contract (rejected: a second contract that could pass where the Makefile fails); a single `make verify` job per runner (rejected: one red job hides which gate failed, and `check-docs` must be its own job); actions pinned to major tags (rejected: a moved tag changes CI silently); `.gitattributes` left out and `core.autocrlf false` set in the workflow (rejected: a Windows developer's clone would still get CRLF).
Affected specs: `13` §3, `10` §1, `10` §2, `10` §4, `09` §3.

## D-059 (2026-09-23) — Failing-forward tripwires for missing gates
Status: superseded by D-061
Type: implementation
Decision: `make tripwire GATE=<id>` (no `GATE`: all) runs `scripts/tripwire.mjs`, which holds the registry of gates the testing specification requires and nothing implements yet: `hidden-information`, `player-command-rejection`, `image-revocation` (`10` §3) and `offline-e2e`, `external-url-build` (`10` §6). A gate announces itself with the marker `@gate:<id>` in the code that implements it, normally its test title, so `--grep @gate:<id>` also selects it. The tripwire scans every code file Git tracks or would track, except its own registry and tests, and passes only when no file carries the marker and the scan covered both the Playwright and the Vitest test roots; a scan that saw neither fails rather than passes. When a marker appears the job fails and prints the promotion steps: run the gate inside a real gate target, remove its registry entry and CI job, update `README.md` and `TRACEABILITY.md`. CI runs one tripwire job per gate on Linux, named `tripwire · <id> (absent)`. `make test` gains a `scripts` Vitest project for the tooling's own tests.
Why: `13` §3 FND-02 requires that a missing gate and a silently passing gate never look alike: the job name and output say the gate is absent, and the first implementation turns the job red instead of letting a tripwire keep passing beside a real gate. A marker in the implementing test is cheap to add and cannot drift from the gate it names. `image-revocation` is included because `10` §3 requires that test as well, beside the two gates the plan lists. The tripwires read text only, so a second runner adds nothing.
Alternatives: Detecting a gate by fixed file paths (rejected: dictates layout to REL-02 and misses a gate written elsewhere); detecting it by product surface, such as the existence of a `players` room (rejected: would turn red with LIV-01, before the gate's own package, and block unrelated work); one job running every tripwire (rejected: one red job would hide which gate arrived); tripwires as skipped tests inside `make test` (rejected: a skipped test looks like a passing gate in the summary, which is what `13` §3 forbids); a separate `make` target per gate (rejected: five targets in the command contract for one mechanism).
Affected specs: `13` §3, `10` §3, `10` §6.

## D-060 (2026-09-23) — CI pipeline mechanics on Linux and Windows (after review)
Type: implementation
Decision: `.github/workflows/ci.yml` runs on every pull request, every push to `main` and on demand. Two jobs, `linux` (`ubuntu-latest`) and `windows` (`windows-latest`), each a matrix over the gate targets `lint`, `format-check`, `typecheck`, `test`, `e2e`, `build`, `check-docs`, `audit` and `scan-secrets`, one job per target per runner, `fail-fast` off. A job provisions the machine (checkout, Node from `.nvmrc`, `make setup`) and then runs exactly one `make <target>`; `check-docs` skips Node and `make setup` because it needs Python only. On Windows, where the image has no `make`, the steps run in the image's preinstalled MSYS2 (via `msys2/setup-msys2`, `path-type: inherit`, packages `make` and `python`), so `make` and bash come from MSYS2 while node, npm and git stay the native Windows ones the product runs on. `make setup` gains `SETUP_BROWSERS` (default `chromium`); CI sets it empty on jobs without a browser and to `--with-deps chromium` for the Linux `e2e` job. Caches: npm through `setup-node` and Playwright browsers through `actions/cache`, both keyed on `package-lock.json`; the `e2e` job uploads `e2e/test-results/` for seven days when it fails. No job retries, Playwright keeps `retries: 0`, and a newer push cancels an older run of the same pull request. Every action is pinned to a commit SHA with its tag in a comment, the workflow token is read-only, and checkout does not persist it (`persist-credentials: false`). `.gitattributes` normalizes text to LF, and the tracked `*:Zone.Identifier` file (Windows download metadata, whose `:` no Windows checkout accepts) is removed and ignored. `scripts/scan-secrets.mjs` runs secretlint's JavaScript entry under the current Node with no shell, so no file name is interpreted, and batches the list under Windows' 32767-character command line. The development server's close waits for Vite's first dependency optimization, each step bounded at 4 s. `scripts/ci-consistency.test.mjs` (in `make test`) asserts that both gate matrices are equal, contain every `make verify` prerequisite and name real targets, and that `README.md` maps every job.
Why: One target per job is what makes a green pipeline mean a green `make verify` (`10` §1), and running the same targets on Windows is the only automatic verification of `09` §3 and `10` §4 before release. MSYS2 is already on the image, so no Windows port of the Makefile is needed, and the product still runs on native Node. Without LF normalization a Windows checkout would fail `format-check` and change the bytes the event log's hash chain covers. The unquoted file list broke `scan-secrets` on Windows at the first file name containing `&`, and a longer list would pass the `cmd.exe` limit. SHA pinning keeps a moved tag from changing what CI runs. The FND-02 review (2026-09-23) found that `cmd.exe` expands `%NAME%` inside quotes, so a file name could escape the Windows scan; that nothing checked the Makefile, workflow and README against each other, so CI and `make verify` could drift apart unnoticed; and that an unbounded wait before Vite's close could hang the first Ctrl-C of `make dev`, whose signal handler closes the app. Vite 8 hangs in close when an optimization is cancelled while requests wait on it, which the CI runners hit and a fast machine does not.
Alternatives: Git Bash with a native Windows `make` from Chocolatey (rejected: a native `make` does not resolve `SHELL := /bin/bash`); MSYS2 `make` called from Git Bash (rejected: two MSYS runtimes in one process tree); a PowerShell port of the command contract (rejected: a second contract that could pass where the Makefile fails); a single `make verify` job per runner (rejected: one red job hides which gate failed, and `check-docs` must be its own job); actions pinned to major tags (rejected: a moved tag changes CI silently); `.gitattributes` left out and `core.autocrlf false` set in the workflow (rejected: a Windows developer's clone would still get CRLF).; keeping `cmd.exe` with stricter quoting (rejected: `%` cannot be escaped reliably inside quotes); a check-docs rule for CI consistency (rejected: the check parses code and configuration, which the test suite already covers on both runners); raising the test hook timeout instead of fixing close (rejected: hides a real hang in `make dev`).
Affected specs: `13` §3, `10` §1, `10` §2, `10` §4, `09` §3.

## D-061 (2026-09-23) — Failing-forward tripwires for missing gates (after review)
Type: implementation
Decision: `make tripwire GATE=<id>` (no `GATE`: all) runs `scripts/tripwire.mjs`, which holds the registry of gates the testing specification requires and nothing implements yet: `hidden-information`, `player-command-rejection`, `image-revocation` (`10` §3) and `offline-e2e`, `external-url-build` (`10` §6). A gate announces itself with the marker `@gate:<id>` in the code that implements it, normally its test title, so `--grep @gate:<id>` also selects it. The tripwire scans every text file Git tracks or would track, whatever its language (binary files, `*.md`, `.log/`, `specs/`, `docs/` and its own registry and tests excepted), and passes only when no file carries the marker and the scan covered both the Playwright and the Vitest test roots; a scan that saw neither fails rather than passes. When a marker appears the job fails and prints the promotion steps: run the gate inside a real gate target and show with `--grep @gate:<id> --list` that a test runs, since a skipped placeholder is not a gate; remove its registry entry, CI job and required check in the ruleset on `main`; update `README.md` and `TRACEABILITY.md`. `scripts/ci-consistency.test.mjs` fails if the tripwire matrix differs from the registry, or if any of the five gates is neither a tripwire nor present in the repository. CI runs one tripwire job per gate on Linux, named `tripwire · <id> (absent)`. `make test` gains a `scripts` Vitest project for the tooling's own tests. The entry check compares `process.argv[1]` with the module path, because `import.meta.main` is missing before Node 24.2 and would skip the check silently.
Why: `13` §3 FND-02 requires that a missing gate and a silently passing gate never look alike: the job name and output say the gate is absent, and the first implementation turns the job red instead of letting a tripwire keep passing beside a real gate. A marker in the implementing test is cheap to add and cannot drift from the gate it names. `image-revocation` is included because `10` §3 requires that test as well, beside the two gates the plan lists. The tripwires read text only, so a second runner adds nothing. The FND-02 review (2026-09-23) showed that scanning JavaScript and TypeScript only would keep a correctly marked Python or shell gate reporting "absent", that dropping a gate from both the registry and the workflow went unnoticed, and that a skipped test would count as present at promotion.
Alternatives: Detecting a gate by fixed file paths (rejected: dictates layout to REL-02 and misses a gate written elsewhere); detecting it by product surface, such as the existence of a `players` room (rejected: would turn red with LIV-01, before the gate's own package, and block unrelated work); one job running every tripwire (rejected: one red job would hide which gate arrived); tripwires as skipped tests inside `make test` (rejected: a skipped test looks like a passing gate in the summary, which is what `13` §3 forbids); a separate `make` target per gate (rejected: five targets in the command contract for one mechanism).; an extension allowlist widened to Python, shell and YAML (rejected: the next language would repeat the blind spot); rejecting markers inside `.skip` or `.todo` in the tripwire (rejected: a text scan cannot judge that reliably; the promotion step proves a test runs instead).
Affected specs: `13` §3, `10` §3, `10` §6.

## D-062 (2026-09-24) — Contract schemas in shared and one strict validator
Status: superseded by D-067
Type: implementation
Decision: Every REST body and WebSocket envelope is defined once in `shared` as a TypeBox schema (`typebox` 1.x); its TypeScript type is `Static<typeof Schema>`, so the JSON Schema Fastify validates with and the type server and client compile against come from the same definition. `server/src/validation.ts` holds one Ajv 8 instance (`ajv` a direct server dependency) with `coerceTypes: false`, `removeAdditional: false`, `useDefaults: false`, `allErrors: false` and `strict: true`; it is Fastify's validator compiler (`setValidatorCompiler`) and validates WebSocket commands, so REST and WebSocket reject exactly the same input. Schemas that forbid unknown fields say so with `additionalProperties: false`. Ajv errors become envelope details `{ path, message }`, `path` a JSON Pointer to the offending value.
Why: D-015 asks for schemas generated from the `shared` types and D-047 for the same schemas on the WebSocket; a schema-first definition gives both with no build step and no generated files to keep fresh. Fastify's default Ajv options coerce `"2"` to `2` and strip unknown fields silently, which would let a malformed body pass and would differ from how a command is judged; `07` §7 asks for every body to be validated, not repaired.
Alternatives: zod with a JSON Schema converter or a zod type provider (rejected: a second schema dialect beside the Ajv Fastify already runs, and WebSocket validation would use a different engine from REST); generating JSON Schema from TypeScript interfaces with `ts-json-schema-generator` (rejected: a codegen step and committed artifacts that can drift); TypeBox's own compiler for WebSocket commands (rejected: two engines, two sets of edge cases); Fastify's default Ajv options (rejected: coercion and silent stripping).
Affected specs: `02` §5, `07` §7, `13` §3.

## D-063 (2026-09-24) — REST error envelope
Type: implementation
Decision: Every error response, and every rejected WebSocket command, is `{ error: { code, message, details? } }` (`ErrorEnvelopeSchema` and `errorEnvelope()` in `shared/src/errors.ts`). `code` is a closed set: `not_found` (404), `validation_failed` (400, with `details`), `malformed_body` (400, invalid or empty JSON), `bad_request` (any other 4xx, such as a malformed URL), `unsupported_media_type` (415), `payload_too_large` (413), `command_unsupported` (WebSocket only) and `internal_error` (500); later packages add codes to the set (SRV-02 `unauthorized`, SRV-04 upload rejections). `message` is a fixed English diagnostic that never echoes the request and never carries a stack; the client maps `code` to its message catalogue (`08` §6). One not-found handler answers every unknown path, under `/api` or not, and Fastify's `frameworkErrors` routes router errors through the same handler. Fastify parses a body before routing to the not-found handler, so a POST with malformed JSON to an unknown path answers 400 `malformed_body` rather than 404.
Why: `13` §3 FND-03 asks for one error envelope for REST, and D-047 for the same envelope on a rejected command. A closed code set lets tests and the client switch on it; generic messages keep request data, which may include a PIN, out of responses and logs.
Alternatives: RFC 9457 problem details (rejected: `type` URIs and `application/problem+json` add nothing for one client that ships with the server); Fastify's default `{ statusCode, error, message }` (rejected: its message can echo validation input and it has no stable code); an HTML 404 for paths outside `/api` (rejected: two shapes for one server, and the client never renders a server 404 page).
Affected specs: `02` §5, `07` §7, `08` §6.

## D-064 (2026-09-24) — WebSocket envelopes, acknowledgements and the version counter
Type: implementation
Decision: A DM client sends every command on the Socket.io event `command` as `{ type, payload }`, `type` one of the commands of `04` §2 exactly (`COMMAND_TYPES`); the server answers through the Socket.io acknowledgement with `{ ok: true }` or the error envelope (`CommandAck`). The server sends every event on the Socket.io event `event` as `{ type, version, payload }`, `type` one of the events of `04` §3 exactly (`EVENT_TYPES`) and `version` an integer from 1. Only events carry a version: commands resolve last-write-wins (`04` §2), so a command version would suggest a concurrency check the specifications do not have. `server/src/domain/commands.ts` validates the envelope, then the payload against the schema registered for its type, and `dispatchCommand` calls the apply step only for a valid command; a type with no registered payload schema is refused as `command_unsupported`, so a command cannot run before the package that implements it defines its payload. No payload schema is registered in FND-03. `server/src/domain/version.ts` holds the process counter `liveVersion` (first `next()` is 1, strictly ascending, in memory only). `shared/src/live.test.ts` reads the tables of `04` §2 and §3 and fails when the name sets differ.
Why: `13` §3 FND-03 asks for typed, versioned command and event envelopes in `shared`, and D-017 and Q-056 fix one in-memory counter from 1. One channel per direction gives one validation point and one place for gap detection. An acknowledgement returns a rejection to the sender alone without adding an event to the normative table of `04` §3. Payload shapes depend on the entities SRV-01 creates and belong to the packages that implement each command (LIV-01, LIV-02, LIV-05, LIV-06, LIV-07); failing closed keeps an unfinished command from running unvalidated.
Alternatives: One Socket.io event name per command (rejected: ten validation entry points and ten listeners for the room check of LIV-01); a `command.rejected` event (rejected: an event outside `04` §3's table, reaching the sender through a room); a client-chosen command id for correlation (rejected: the acknowledgement already correlates); a version or base version on commands (rejected: implies optimistic concurrency, contrary to last-write-wins); defining every payload now (rejected: fixes token and scene field shapes before SRV-01 and LIV-02 own them); accepting any payload for unregistered types (rejected: fails open).
Affected specs: `04` §2, `04` §3, `04` §5, `07` §7.

## D-065 (2026-09-24) — Logger mechanics and redaction
Status: superseded by D-066
Type: implementation
Decision: `server/src/log/logger.ts` is a small in-house logger: `info`, `warn` and `error`, each with an event name, a message and fields. Each line is appended synchronously to `logs/emberglass.log` in the data directory as one JSON object (`time`, `level`, `event`, `msg`, then fields, which cannot overwrite those four) and written to the console as `time LEVEL message {fields}`, errors to stderr with their stack indented. Before an append that would pass 5 MB the file rotates to `.1`, `.2`, `.3`, the oldest dropped, renaming only while no handle is open; a line longer than the limit is written whole into a fresh file. If the file cannot be written the console still gets every line and stderr says so once. Redaction happens inside the logger for every caller: a field whose key starts with `pin`, ends in `Pin`, `_pin` or `-pin`, is `sid`, or contains `session`, `cookie`, `authorization`, `password` or `secret` is replaced by `[redacted]` at any depth; strings, error messages and stacks are scrubbed of `key=value`, `key: value` and `"key":"value"` pairs for the same words. `token` is not redacted: it is a game piece. Fastify's own logger stays off; the error handler logs 5xx at `error` with the error and other 4xx except 404 at `warn`, with method and path only, never a query string, header or body. 404s are not logged. Start-up (`server.started`, with port and data directory), the pre-migration backup (`db.backup`) and a failed start (`server.failed`) go through the logger.
Why: D-035 fixes the outputs, the 5 MB rotation and three old files; D-029 and Q-044 forbid a PIN, a session identifier or a cookie in any log line and rejected request logging. Redacting in the logger rather than at each call site keeps a later package's careless field or error message from leaking a credential, which the FND-03 integration test proves with an error that echoes the Cookie header. Synchronous appends suit a log of rare events and keep the line written before a crash. 404s are routine (a TV browser asks for `/favicon.ico`) and would bury the rest.
Alternatives: pino with pino-pretty and pino-roll (rejected: three dependencies and worker-thread transports for about 120 lines, and asynchronous writes that can lose the last line before a crash); Fastify's request logger (rejected by D-029: noise and cookie exposure); redaction by an allowlist of loggable fields (rejected: every new event would need a list entry, and error messages are free text anyway); rotating by date (rejected: D-035 chose size); logging 404s (rejected: noise).
Affected specs: `07` §8, `09` §6, `09` §5.

## D-066 (2026-09-24) — Logger mechanics and redaction (after review)
Type: implementation
Decision: `server/src/log/logger.ts` keeps D-065's outputs: synchronous appends to `logs/emberglass.log`, one JSON object per line (`time`, `level`, `event`, `msg`, then fields; a field never overwrites those four, checked with `Object.hasOwn`), human-readable console lines, errors on stderr with their stack indented, rotation at 5 MB keeping `.1` to `.3`. The file's size is read from disk before each append. A rotation first renames the live file to `emberglass.log.rotating`, so a refused rename (Windows, when another program holds the file open) changes nothing. Old files then shift only up to the first free slot, and the oldest is deleted only when every slot is taken, so a rotation interrupted part-way is finished by the next attempt without losing another file. After a failed rotation the logger keeps appending to the live file, says so once on stderr, and retries after 60 s. The console escapes control characters in the message and stack (newlines kept in the stack, every stack line indented), so no message forges a line or reaches the terminal as an escape sequence. Redaction in `server/src/log/redact.ts`: a key is sensitive when one of its words (split at camelCase humps and non-alphanumerics) contains `session`, `sessid`, `cookie`, `authorization`, `password`, `passwd` or `secret`, ends in `sid`, or starts or ends with `pin` other than `spin`, `spins`, `spinner`, `spinning`, `pinned` and `pinch`. `token` stays readable. In free text, everything after `Cookie:`, `Set-Cookie:`, `Authorization:` or `Proxy-Authorization:` to the end of the line is replaced. Values of sensitive `key=value`, `key: value`, `"key":"value"`, `'key': 'value'` and `key%3Dvalue` pairs are replaced, whether the value is quoted (with escapes), an array, an object or bare. Every string is cut to 2,048 characters before any pattern runs. Every pattern runs in linear time: a key starts only where a run of key characters starts; sensitivity is decided in code, not by the pattern; values are bounded at 256 characters; after a pair whose key is not sensitive, the scan resumes at its value, so nested pairs are still seen. Buffers and typed arrays are logged as `[binary N bytes]`, Maps and Sets as their size, Dates as ISO strings. The HTTP error handler logs 5xx at `error` with the error, and other 4xx except 404 at `warn` with method, path without query string, status, envelope code and Fastify's error code as `reason`, never Fastify's message, which for a malformed URL quotes the raw URL. One logger per data directory is assumed; since sizes are read from disk, a second writer cannot make the file outgrow the limit, though two loggers could rotate more often than one.
Why: The FND-03 review (2026-09-24) found that the first pattern backtracked in roughly cubic time: 4,000 characters of `pinpin…` took 9 s, so one unauthenticated LAN request could stall the server for minutes. It also found that a refused rename deleted one old log file per logged line and dropped the lines themselves, that Fastify's bad-URL message put the query string back into the log, and that free-text scrubbing missed later cookies in a header, bearer credentials, arrays, escaped quotes, single-quoted and URL-encoded pairs, pairs nested in the value of a non-sensitive key, and keys such as `dmPIN` and `connect.sid`. `07` §8 forbids a PIN, a session identifier or a cookie in any log line; D-035 fixes the outputs and the rotation.
Alternatives: Dropping free-text scrubbing and relying on callers (rejected: error messages are free text written by later code); a pattern that names the sensitive words inside the key (rejected: it is what backtracked); rotating by copy and truncate (rejected: a truncate can lose lines another program is reading and still needs a handle); retrying rotation on every line (rejected: a lock held for minutes would retry thousands of times); logging Fastify's message with the query cut off (rejected: a code says as much and quotes nothing); rate-limiting rejected-request lines now (deferred to SRV-02 with the per-client lockout, G-006).
Affected specs: `07` §8, `09` §6, `09` §5.

## D-067 (2026-09-24) — Contract schemas in shared and one strict validator (after review)
Type: implementation
Decision: As D-062: every REST body and WebSocket envelope is a TypeBox schema in `shared`, its type `Static<typeof Schema>`, and one Ajv 8 instance in `server/src/validation.ts` is Fastify's validator compiler and validates WebSocket commands. Its options are `coerceTypes: false`, `removeAdditional: false`, `useDefaults: false`, `allErrors: false`, `strict: true` and now `ownProperties: true`, so `required` is met only by a value's own properties. Envelope detail paths are JSON Pointers with `~` and `/` escaped; a property name the client chose is cut to 64 characters. `createCommandValidator` refuses at registration any payload schema that is not an object schema with `additionalProperties: false`, so a loose schema cannot admit `__proto__` or other keys that Socket.io's `JSON.parse` delivers as own properties. It also rejects any command or payload that is not a plain object (prototype `Object.prototype` or null), such as a Buffer from a binary attachment, before Ajv runs. The same strict compiler also judges `params`, `querystring` and `headers`, which arrive as strings: a package that declares a number or boolean there declares it as a string pattern and converts it in the handler, or adds a separate coercing compiler for those parts in a recorded decision.
Why: The FND-03 review (2026-09-24) found: - an inherited property satisfied `required`; - a registered payload schema without `additionalProperties: false` would accept a JSON-parsed `__proto__` key and a Buffer, which REST's parser rejects, contrary to D-062's promise that REST and WebSocket reject the same input; - unescaped property names made detail paths ambiguous; - the strict compiler would reject every numeric `params` or `querystring` value unless someone knows to plan for it.
Alternatives: Coercing `params` and `querystring` now (rejected: no route declares one yet, and coercion is a choice for the package that needs it); checking payload strictness only in tests (rejected: a mistake would reach the server); stripping unknown keys instead of refusing them (rejected by D-062).
Affected specs: `02` §5, `07` §7, `13` §3.

## D-068 (2026-09-24) — Phase 0 evidence for a rejected WebSocket command
Type: implementation
Decision: For the Phase 0 exit criterion of `13` §3 ("A REST error and a rejected WebSocket command both arrive in the shared envelope"), the owner accepts in-process evidence for the WebSocket half: `server/src/domain/commands.test.ts` shows that `dispatchCommand` answers every invalid command with the shared error envelope, the acknowledgement Socket.io will return (D-064), and changes nothing. The over-the-wire proof, a rejected command arriving at a real Socket.io client in the envelope, belongs to LIV-01, which creates the Socket.io server and its rooms.
Why: No Socket.io server exists before LIV-01 (Phase 3). A transport built only for this criterion would anticipate LIV-01's rooms and handshake, which must check the DM session and Origin (`07` §2), before SRV-02 provides them. Decided by the owner on 2026-09-24 when asked.
Alternatives: A minimal Socket.io transport test in Phase 0 (rejected by the owner: it would build a room-less server that LIV-01 replaces); leaving Phase 0 unexited until LIV-01 (rejected: it would block the phase on work planned for Phase 3).
Affected specs: `13` §3, `04` §2, `07` §7.

## D-069 (2026-09-24) — Design tokens, base components, focus and error patterns
Type: implementation
Decision: The shared design tokens are CSS custom properties on `:root` in `client/src/ui/tokens.css`, imported once by `client/src/main.tsx` and used by both views: one dark palette (background, surface, border, text, muted text, accent with its text colour, danger, focus), a type scale, spacing and radius. The focus pattern is one global `:focus-visible` outline in the focus colour (3 px, 2 px offset) that no component removes; a landmark reached through the skip link (`tabindex=-1`) shows none. The base components are `Button` (a native button, `type=button` unless asked), `TextField` (a visible label; a refusal sets `aria-invalid` and is tied to the input with `aria-describedby`), `Notice` (`role=alert` for page- and form-level errors), `SkipLink` (the first Tab stop of the DM view; moves focus to `main` explicitly) and `ErrorBoundary`, which replaces a view that throws with a fallback that never receives the error: the DM view's `DmErrorScreen` explains and offers Reload, the player view falls back to its idle screen. The DM shell is a banner (product name, "DM view"), the skip link and a focusable `main`; the player shell is the idle screen of `08` §4, the product name only, with no control.
Why: The idle screen is dark (`08` §4) and the DM works at the same table, so one palette serves both and keeps the tokens shared. CSS custom properties need no runtime and are readable by the palette contrast test. Native elements get keyboard operation from the browser, which is what `08` §8 asks for. A fallback that never sees the error cannot put a path or stack on the TV or the DM's screen. The components are the ones PRP-01 and SRV-02 need first (PIN entry, renames, refusals); nothing else is built ahead.
Alternatives: A light DM palette beside the dark TV (rejected: two palettes to keep readable for no stated need); a CSS-in-JS or utility-class library (rejected: a dependency and a runtime for a handful of tokens); a component library such as a headless UI kit (rejected: a large dependency before any consumer needs more than native elements); showing the error message in the fallback (rejected: leaks internal detail to whoever looks at the screen); a player-view error message (rejected: the TV has no controls and nobody reads an error there; the DM's view is where recovery happens).
Affected specs: `08` §4, `08` §8, `08` §9, `02` §2.

## D-070 (2026-09-24) — Message catalogue and the check that it is the only UI text
Status: superseded by D-073
Type: implementation
Decision: Every UI string lives in one flat JSON catalogue per language, `client/src/ui/messages/en.json`, with dotted keys and `{name}` placeholders. `client/src/ui/messages.ts` exports `t(key, params)`, typed so that an unknown key fails `make typecheck`; the locale is fixed to `en`. The page's `<title>` and `lang` are placeholders in `client/index.html` filled from the catalogue by a `transformIndexHtml` plugin in `client/vite.config.ts`, which the development server also runs. `client/src/ui/messages.test.tsx` enforces the rule twice: a static scan with the TypeScript compiler API of every shipped client source (`client/src/ui/testing/uiTextScan.ts`) fails on JSX text, a literal child expression (including either branch of a conditional, `&&`, `||`, `??`, `+` and templates), a literal in a text-bearing attribute or prop (`aria-label`, `aria-description`, `aria-roledescription`, `aria-valuetext`, `aria-placeholder`, `alt`, `title`, `placeholder`, `label`, `error`), a literal assigned to `title`, `textContent`, `innerText`, `innerHTML` or `outerHTML`, and a literal given to `alert`, `confirm` or `prompt`, and on a title or body text written into `index.html`; and a runtime check renders both views and both fallbacks in jsdom and requires every text node and text-bearing attribute to match a catalogue text, placeholders matching any value. The scanner is tested against a planted literal of each kind. The same test file forbids "D&D" and "Dungeons & Dragons" in the catalogue (`01` §8). Whitespace-only literals, error messages thrown to the console and tests are not UI text.
Why: `08` §6 asks for every UI string in one catalogue so that a translation needs no code change; a JSON file is data, and a new language is another file with the same keys. A static scan catches literals in states no test renders; the runtime check catches text that reaches the screen by a path the scan does not model, such as a literal held in a variable. Together they make the acceptance of FND-04 ("a test fails on a string literal rendered as UI text outside it") executable.
Alternatives: An i18n library such as i18next or FormatJS (rejected: plurals and locale negotiation have no MVP consumer and the dependency would outweigh the code; revisit when a second language arrives); the catalogue as a TypeScript object (rejected: a translation would be a code change); an ESLint rule such as `react/jsx-no-literals` (rejected: a new plugin, and it covers JSX text but not DOM assignments, dialogs or the HTML page; the acceptance names a Vitest test); only the runtime check (rejected: misses states that are not rendered, such as error fallbacks added later); a hard-coded `<title>` compared with the catalogue by a test (rejected: still a second place the text is written).
Affected specs: `08` §6, `01` §8.

## D-071 (2026-09-24) — Bundled font and icons
Type: implementation
Decision: Both views render with Inter Variable, from the npm package `@fontsource-variable/inter` (SIL Open Font License 1.1), imported by `client/src/ui/tokens.css` so that Vite copies its woff2 files into `client/dist/assets` and the server serves them from its own origin; the font stack falls back to the system UI font. Icons are SVG files or inline SVG kept in the repository and bundled by Vite; the only one today is the favicon `client/public/favicon.svg`, an original mark, declared in `client/index.html` so the browser has no reason to ask for `/favicon.ico`. No icon library is added until a view needs an icon. `e2e/tests/views.spec.ts` shows that both views request only the local origin, that the font files are among those requests and answer 200, that the page renders with the bundled face, and that the declared icon is local and served as SVG.
Why: `02` §6 requires fonts and icons bundled so both views work offline. A bundled font makes the text look the same on the owner's TV browser, whose fonts are unknown (G-002), as on the DM's laptop. The OFL permits bundling and redistribution with AGPL software. An icon library with no icon to draw would be a dependency without a consumer (`14` §3).
Alternatives: The system font stack only (rejected: nothing to bundle, but the TV's fonts are unknown and text would look different on each screen); a font from a CDN such as Google Fonts (rejected: forbidden by `02` §6); copying font files into the repository (rejected: the npm package carries the licence and updates with the lockfile); an icon set such as Lucide now (rejected: no consumer yet; when one arrives it must be bundled the same way, which is tree-shaken SVG components).
Affected specs: `02` §6, `10` §6.

## D-072 (2026-09-24) — Keyboard, focus and contrast smoke tests, and jsdom for component tests
Type: implementation
Decision: `e2e/tests/keyboard.spec.ts` is the keyboard-operability gate of FND-04 and runs in `make e2e` against the production build. It is generic: it collects every element of `/dm` that sequential navigation can reach (links, enabled buttons and form fields, non-negative tabindex, contenteditable), fails if there is none or if any positive tabindex exists, and for each element reloads the page, presses Tab until the element is reached and asserts that it is focused, that its focused outline or shadow is visible and differs from its unfocused state, that it is in the viewport, and that Enter (and Space for a button) activates it; an in-page link must also move focus to its target. A second test computes the WCAG contrast of every element with its own text against its effective background in both views and requires 4.5:1; `client/src/ui/tokens.test.ts` checks the palette's text pairs (4.5:1) and the focus colour (3:1). Component tests in Vitest render into jsdom, selected per file with `// @vitest-environment jsdom`, through the small helper `client/src/ui/testing/render.ts` built on React's `act`; the client project's default environment stays `node`. The e2e workspace's TypeScript configuration gains the DOM library for code that runs inside the page.
Why: `08` §8 asks that core DM actions are keyboard-operable and text keeps readable contrast, and `13` §3 asks for the keyboard test to be a real gate. A test that walks whatever is on the page covers each control a later package adds without being edited, so the gate grows with the DM view instead of staying a check of today's single skip link. Deliberate mutations turned each test red: removing the focus outline, adding an external font import, and a muted text colour of 2:1.
Alternatives: A fixed list of elements to tab through (rejected: it would pass while new controls stay unreachable); an accessibility engine such as axe-core in Playwright (rejected for now: a dependency whose rules go beyond the no-formal-target decision of `08` §8, Q-030; the checks the spec asks for are written directly); Testing Library for component tests (rejected: `act` and the DOM are enough for the handful of tests, one dependency fewer); happy-dom instead of jsdom (rejected: jsdom is the more complete DOM for focus behaviour). Known limit: an element made clickable without being focusable, such as a `div` with a click handler, is invisible to the walk; native elements from the base components avoid it, and the UX review of PRP-01 checks for it.
Affected specs: `08` §8, `13` §3, `10` §1.

## D-073 (2026-09-24) — Message catalogue and the check that it is the only UI text (after review)
Type: implementation
Decision: Every UI string lives in one flat JSON catalogue per language, `client/src/ui/messages/en.json`, with dotted keys and `{name}` placeholders. `client/src/ui/messages.ts` exports `t(key, params)`, typed so that an unknown key fails `make typecheck`; the locale is fixed to `en`. The page's `<title>` and `lang` are placeholders in `client/index.html` filled from the catalogue by a `transformIndexHtml` plugin in `client/vite.config.ts`, which the development server also runs, and HTML-escapes what it inserts. `client/src/ui/messages.test.tsx` enforces the rule twice: a static scan with the TypeScript compiler API of every shipped client source (`client/src/ui/testing/uiTextScan.ts`) fails on JSX text, a literal child expression (including either branch of a conditional, `&&`, `||`, `??`, `+` and templates), a literal in a text-bearing attribute or prop (`aria-label`, `aria-description`, `aria-roledescription`, `aria-valuetext`, `aria-placeholder`, `alt`, `title`, `placeholder`, `label`, `error`, `children`), the `value` of an `input` of type submit, button or reset, the text props and literal children given to `createElement`, `jsx`, `jsxs` or `jsxDEV`, a literal assigned to `title`, `textContent`, `innerText`, `innerHTML` or `outerHTML`, and a literal given to `alert`, `confirm` or `prompt`, and on a title or body text written into `index.html`; and a runtime check renders both views and both fallbacks in jsdom and requires every text node and text-bearing attribute to match a catalogue text, placeholders matching any value. The scanner is tested against a planted literal of each kind. The same test file forbids "D&D" and "Dungeons & Dragons" in the catalogue (`01` §8). Whitespace-only literals, error messages thrown to the console and tests are not UI text. The same test requires every catalogue text to hold literal text besides its placeholders, because a text made only of placeholders would let the rendered-view check match anything. A literal held in a variable is seen only by the rendered-view check, so each package that adds a screen or state adds it to that check.
Why: `08` §6 asks for every UI string in one catalogue so that a translation needs no code change; a JSON file is data, and a new language is another file with the same keys. A static scan catches literals in states no test renders; the runtime check catches text that reaches the screen by a path the scan does not model, such as a literal held in a variable. Together they make the acceptance of FND-04 ("a test fails on a string literal rendered as UI text outside it") executable. The FND-04 review (2026-09-24) found that the scan missed a `children` prop, `createElement` arguments (already used by `client/src/views.ts`) and the label of a submit input, each of which reached the screen unflagged in a probe.
Alternatives: An i18n library such as i18next or FormatJS (rejected: plurals and locale negotiation have no MVP consumer and the dependency would outweigh the code; revisit when a second language arrives); the catalogue as a TypeScript object (rejected: a translation would be a code change); an ESLint rule such as `react/jsx-no-literals` (rejected: a new plugin, and it covers JSX text but not DOM assignments, dialogs or the HTML page; the acceptance names a Vitest test); only the runtime check (rejected: misses states that are not rendered, such as error fallbacks added later); a hard-coded `<title>` compared with the catalogue by a test (rejected: still a second place the text is written).; resolving variables to their literal values in the scan (rejected: needs the type checker's data flow for little gain over the rendered-view check).
Affected specs: `08` §6, `01` §8.

## D-074 (2026-09-24) — SQLite schema of the eight entities, its constraints and the fixture database
Status: superseded by D-075
Type: implementation
Decision: Migration `server/migrations/0001_initial_schema.sql` creates one table per entity of `03` §1, named in singular snake case (`image`, `asset`, `asset_tag`, `campaign`, `session`, `scene`, `token`, `settings`), with the specification's field names as columns, including a quoted `"order"`. A scene's grid is stored as `grid_type`, `grid_size`, `grid_offset_x`, `grid_offset_y`, `grid_visible`, `grid_feet_per_square`, `grid_columns` and `grid_rows`, and an image's preset as the same eight fields prefixed `grid_preset_`, wholly absent or wholly present and calibrated: the preset is the template a new scene copies (Q-001, answer A). Every table is `STRICT, WITHOUT ROWID`, keyed by a text `id`: a lowercase UUID checked by a GLOB pattern, and for Image the lowercase hex sha256. AssetTag and Settings carry a UUID `id` too, because `03` §3 names every entity but Image; AssetTag is also unique on (`asset_id`, `tag`). Foreign keys follow `03` §2 and the deletion rules of `03` §7: session, scene, token and asset tag cascade from their parent; an asset used by a token, and an image used by an asset or a scene, are restricted; `settings.live_scene_id` is set to NULL when the live scene or an ancestor is deleted. Every foreign key is indexed. Sessions and scenes are unique on (parent, `order`), so SRV-03 reorders in two steps (SQLite checks uniqueness row by row). `grid_size` is NULL until a square size is calibrated, which a map-less scene never has; the extent defaults to 30 x 20, feet per square to 5, offsets to 0 and player visibility to on. `session.date` is an optional `YYYY-MM-DD`. `image.variants` is a JSON object, empty until SRV-04 writes it. `asset.default_hidden` has no default, because D-020 derives it from the category. `token.character_id` must be NULL; the empty string is refused too, so that empty has one representation. Settings is one row, inserted by the migration under a version 4 UUID built with `randomblob`, and held at one row by triggers. Its defaults are PHB, 50 MiB (52,428,800 bytes) and 4,096 px, and `pin_hash` is NULL until SRV-02 sets it. The three fields prepared for later phases (`03` §8: `character_id` empty, `grid.type` and the preset type `square`, `rules_version` `5e-2014`) are held by BEFORE INSERT and BEFORE UPDATE triggers rather than CHECK constraints. Permanent invariants are CHECK constraints, each written so that a NULL cannot pass it. The runner (D-054) now turns foreign keys off while migrations run and runs `PRAGMA foreign_key_check` inside each migration's transaction, rolling back one that leaves a dangling reference; `openDatabase` turns them on for every other connection. The contract types are TypeBox schemas in `shared/src/entities.ts`, with the same field names, booleans for 0/1, the grid and the preset nested, and the PIN hash left out. The generated fixture database is `server/src/db/testing/fixture.ts`, excluded from the build: made-up rows in every table, written against schema version 1 (`FIXTURE_VERSION`, never edited afterwards). Every later migration is tested by migrating it from that version, keeping every row, reference and contract shape.
Why: Exact field names let a test read `03` §1 and compare it with the tables, so the schema cannot drift from the specification unnoticed. A rowid is an internal sequential key, which `14` §8 forbids (Q-084), and STRICT is the only way SQLite refuses text in a REAL column such as a token's `x` (`03` §4). Database constraints for key invariants are what `14` §8 asks for. The foreign-key actions make the cascades, the refusals and the blanking of a deleted live scene (Q-031) hold even if a later route forgets them. The input says `character_id` exists so that Phase 2 can link characters "without a painful migration". Removing a trigger takes one statement, while removing a CHECK in SQLite means rebuilding the table, so the prepared fields get triggers. SQLite's documented procedure for changing a table's schema requires foreign keys off. With them on, rebuilding `scene` would cascade-delete every token, and the check before commit replaces the enforcement that is switched off. A preset shaped like the grid needs no rule about which fields a copy takes. 50 MiB is the size Windows Explorer labels "50 MB". Keeping the PIN hash out of the shared contract means no type a client compiles against can carry it (`07` §1).
Alternatives: Plural or `Pascal` table names (rejected: SQLite convention is lower case, and singular matches the entity names); a `sort_order` or `position` column (rejected: renames a field the specification names); the grid and preset as JSON columns (rejected: no constraint could check a value inside them); rowid tables with a UUID column (rejected: a rowid is a sequential key); plain type affinity (rejected: SQLite would store `'2.5px'` in a REAL column); a composite key for AssetTag and an integer check for the one Settings row (rejected: `03` §3 gives every entity but Image a UUID); CHECK constraints for the three prepared fields (rejected: each Phase 2 or 3 change would rebuild a table); enforcing everything in application code only (rejected: `14` §8 prefers database constraints, and one forgotten route would break an invariant); no uniqueness on `order` (rejected: two scenes at one position would have no defined order); a non-null default square size such as 70 px (rejected: invents a calibration no one made); 50,000,000 bytes (rejected: shown to the DM as 47.7 MB by Windows); foreign keys left on during migrations (rejected: a table rebuild would cascade-delete children, shown by a test); an empty fixture or one generated at the latest version (rejected: it would not exercise the path a DM's existing data takes); the fixture as a committed `.db` file (rejected: generated data is reviewable as code, and Q-082 asks for a generated fixture).
Affected specs: `03` §1, `03` §2, `03` §3, `03` §4, `03` §6, `03` §7, `03` §8, `05` §6, `05` §7, `06` §2, `06` §5, `07` §1, `09` §2, `14` §8.

## D-075 (2026-09-24) — SQLite schema of the eight entities, its constraints and the fixture database (after review)
Type: implementation
Decision: Migration `server/migrations/0001_initial_schema.sql` creates one table per entity of `03` §1, named in singular snake case (`image`, `asset`, `asset_tag`, `campaign`, `session`, `scene`, `token`, `settings`), with the specification's field names as columns, including a quoted `"order"`. A scene's grid is stored as `grid_type`, `grid_size`, `grid_offset_x`, `grid_offset_y`, `grid_visible`, `grid_feet_per_square`, `grid_columns` and `grid_rows`, and an image's preset as the same eight fields prefixed `grid_preset_`, wholly absent or wholly present and calibrated: the preset is the template a new scene copies (Q-001, answer A). Every table is `STRICT, WITHOUT ROWID`, keyed by a text `id`: a lowercase UUID checked by a GLOB pattern, and for Image the lowercase hex sha256. AssetTag and Settings carry a UUID `id` too, because `03` §3 names every entity but Image; AssetTag is also unique on (`asset_id`, `tag`). Foreign keys follow `03` §2 and the deletion rules of `03` §7: session, scene, token and asset tag cascade from their parent; an asset used by a token, and an image used by an asset or a scene, are restricted; `settings.live_scene_id` is set to NULL when the live scene or an ancestor is deleted. Every foreign key is indexed. Sessions and scenes are unique on (parent, `order`), so SRV-03 reorders in two steps (SQLite checks uniqueness row by row). `grid_size` is NULL until a square size is calibrated, and a CHECK keeps it NULL on a scene without a map; the extent defaults to 30 x 20, feet per square to 5, offsets to 0 and player visibility to on. `session.date` is an optional `YYYY-MM-DD`. `image.variants` is a JSON object, empty until SRV-04 writes it. `asset.default_hidden` has no default, because D-020 derives it from the category. `token.character_id` must be NULL; the empty string is refused too, so that empty has one representation. Settings is one row, inserted by the migration under a version 4 UUID built with `randomblob`, and held at one row by triggers. Its defaults are PHB, 50 MiB (52,428,800 bytes) and 4,096 px, and `pin_hash` is NULL until SRV-02 sets it. The three fields prepared for later phases (`03` §8: `character_id` empty, `grid.type` and the preset type `square`, `rules_version` `5e-2014`) are held by BEFORE INSERT and BEFORE UPDATE triggers rather than CHECK constraints. Permanent invariants are CHECK constraints, each written so that a NULL cannot pass it; every REAL column refuses infinity (`abs(v) < 9e999`), which JSON cannot carry, and a NaN bound by a driver arrives as NULL. A trigger keeps `settings.id` from changing. The settings UUID's variant digit uses `random() & 3`, which cannot overflow. The runner (D-054) now turns foreign keys off while migrations run and runs `PRAGMA foreign_key_check` inside each migration's transaction, rolling back one that leaves a dangling reference. Each migration's transaction is `BEGIN IMMEDIATE` and re-reads `user_version` under that write lock, skipping a migration another process has applied meanwhile; the backup (`VACUUM INTO`, which cannot run inside a transaction) is taken before, so two processes may each write one. A `target` below the database's version is refused with its own message. `INSERT OR REPLACE` is never used on an entity table, because its implicit delete fires the cascades; `openDatabase` turns them on for every other connection. The contract types are TypeBox schemas in `shared/src/entities.ts`, with the same field names, booleans for 0/1, the grid and the preset nested, and the PIN hash left out. The generated fixture database is `server/src/db/testing/fixture.ts`, excluded from the build: made-up rows in every table, written against schema version 1 (`FIXTURE_VERSION`, never edited afterwards). Every later migration is tested by migrating it from that version, keeping every row, reference and contract shape; until a second migration exists, a test migrates it through an additive probe migration so the path is exercised now.
Why: Exact field names let a test read `03` §1 and compare it with the tables, so the schema cannot drift from the specification unnoticed. A rowid is an internal sequential key, which `14` §8 forbids (Q-084), and STRICT is the only way SQLite refuses text in a REAL column such as a token's `x` (`03` §4). Database constraints for key invariants are what `14` §8 asks for. The foreign-key actions make the cascades, the refusals and the blanking of a deleted live scene (Q-031) hold even if a later route forgets them. The input says `character_id` exists so that Phase 2 can link characters "without a painful migration". Removing a trigger takes one statement, while removing a CHECK in SQLite means rebuilding the table, so the prepared fields get triggers. SQLite's documented procedure for changing a table's schema requires foreign keys off. With them on, rebuilding `scene` would cascade-delete every token, and the check before commit replaces the enforcement that is switched off. A preset shaped like the grid needs no rule about which fields a copy takes. 50 MiB is the size Windows Explorer labels "50 MB". Keeping the PIN hash out of the shared contract means no type a client compiles against can carry it (`07` §1). The SRV-01 review (2026-09-24) found: two processes migrating one file (`make migrate` while the server starts) both applied the same migration, because the version was read before a deferred transaction, which a data migration would turn into silent double application (high, reproduced by a test with a second process); an infinite REAL was stored though the contract refuses it; the settings id could change; a map-less scene could hold a square size; the forward-migration test applied nothing at version 1; several CHECK constraints, column types and defaults had no test.
Alternatives: Plural or `Pascal` table names (rejected: SQLite convention is lower case, and singular matches the entity names); a `sort_order` or `position` column (rejected: renames a field the specification names); the grid and preset as JSON columns (rejected: no constraint could check a value inside them); rowid tables with a UUID column (rejected: a rowid is a sequential key); plain type affinity (rejected: SQLite would store `'2.5px'` in a REAL column); a composite key for AssetTag and an integer check for the one Settings row (rejected: `03` §3 gives every entity but Image a UUID); CHECK constraints for the three prepared fields (rejected: each Phase 2 or 3 change would rebuild a table); enforcing everything in application code only (rejected: `14` §8 prefers database constraints, and one forgotten route would break an invariant); no uniqueness on `order` (rejected: two scenes at one position would have no defined order); a non-null default square size such as 70 px (rejected: invents a calibration no one made); 50,000,000 bytes (rejected: shown to the DM as 47.7 MB by Windows); foreign keys left on during migrations (rejected: a table rebuild would cascade-delete children, shown by a test); an empty fixture or one generated at the latest version (rejected: it would not exercise the path a DM's existing data takes); the fixture as a committed `.db` file (rejected: generated data is reviewable as code, and Q-082 asks for a generated fixture). For the concurrent run: an exclusive lock for the whole run (rejected: `VACUUM INTO` cannot run in a transaction, and a per-migration lock with a re-read gives the same guarantee); a lock file in the data directory (rejected: a stale file after a crash would stop the server, and `09` §5 lists what the directory holds). Moving the PIN hash to its own table so that `SELECT *` on settings cannot return it (rejected: `03` §1 places it in Settings and the register fixes eight entities; explicit column lists in SRV-02 cover it, G-008).
Affected specs: `03` §1, `03` §2, `03` §3, `03` §4, `03` §6, `03` §7, `03` §8, `05` §6, `05` §7, `06` §2, `06` §5, `07` §1, `09` §2, `14` §8.

## D-076 (2026-09-24) — PIN, DM session, guessing protection and the /api session guard
Type: implementation
Decision: Routes (`shared/src/auth.ts`): `POST /api/auth` enters the PIN, `DELETE /api/auth` signs the calling browser out, `GET /api/auth` answers `{ dm }` for that browser only (D-048, Q-085), `GET /api/setup` answers `{ pin_set, local }` so that a DM view opened from the LAN can say setup happens on the server PC, `POST /api/setup` sets the first PIN, `GET /api/settings` returns the settings, and `PUT /api/settings/pin` changes the PIN given the current one. These five auth and setup operations are the only `/api` routes reachable without a DM session (`PUBLIC_API_ROUTES`). New error codes: `unauthorized` (401), `forbidden` (403: a foreign Origin, or setup from a LAN address), `pin_incorrect` (401), `locked_out` (429 with `Retry-After` in seconds), `pin_not_set` and `pin_already_set` (409). Guard: one root `onRequest` hook, which Fastify runs before body parsing and also for paths no route matches, treats a request as an API request when its matched route or, failing one, its raw path is `/api` or under `/api/`. It sets `Cache-Control: no-store`, refuses a POST, PUT, PATCH or DELETE whose Origin is present and is not `http://` plus the request's own Host (so `Origin: null`, another port or `https` are refused, and a request without an Origin is accepted), lets the public routes through by matched route and method, and otherwise answers 401 `unauthorized` unless a valid session cookie is present. A protected route and an unknown `/api` path therefore get byte-identical answers whatever the body (G-005). Setup refuses a non-loopback client (127.0.0.0/8, ::1, IPv4-mapped forms normalised) in a route-level `onRequest` hook, before the body is read. PIN: scrypt with N = 2^15, r = 8, p = 1, a 16-byte random salt and a 32-byte key, stored as `scrypt$N$r$p$salt$key` in base64url so a later cost change still verifies old hashes; hashed asynchronously on libuv's thread pool; compared with `timingSafeEqual`. `settings` is read and written in `server/src/db/settings.ts` through explicit column lists, the hash by its own functions only; setup is `UPDATE ... WHERE pin_hash IS NULL` and a change is compare-and-swap on the old hash, so two concurrent writers cannot both win. Sessions: 32 random bytes as 64 hex characters in an in-memory set; cookie `emberglass_dm` with `Path=/; Max-Age=34560000; HttpOnly; SameSite=Strict`, no `Secure` (plain HTTP, `07` §4); PIN entry always issues a fresh identifier and ends the one the browser brought; a successful setup signs its browser in and ends every existing session; a PIN change ends every session but the caller's. Guessing protection: per normalised client address, an attempt is counted as a failure when it starts, before hashing, and forgiven if the PIN is right; every fifth failure starts a lockout of 60 s times 2^(n-1) for the n-th lockout, the exponent capped at 30; attempts during a lockout are refused without counting; a correct PIN clears the address; at most 10,000 addresses are remembered, the oldest dropped first. A wrong current PIN in a PIN change counts towards the same lockout. `npm run reset-pin` (`server/src/auth/reset-pin-cli.ts`, run through tsx like `npm run migrate`) refuses a data directory without a database, applies pending migrations, clears the hash and logs `pin.reset`; the server reads the hash on every check, so it takes effect in a running server at once, and sessions that server holds last until the new PIN is set or the server restarts. Start-up logs `pin.unset` with the setup URL while no PIN is set. Logging: `pin.failed` (address, failure count), `pin.locked` (address, seconds), `pin.set`, `pin.changed` (sessions ended), `auth.signed_in`, `auth.signed_out`, `pin.reset`; a wrong PIN is logged once as `pin.failed`, not also as `http.rejected`. Rejected-request lines (`http.rejected`, which now carry the client address) are limited (`server/src/log/limiter.ts`) to 20 per address and 100 in total per 60 s window; the rest are counted, and one `http.rejected.dropped` line per window gives the number and the five addresses dropped most, written when the window ends. Failed-PIN and lockout lines are not limited, since the lockout bounds them to five per locked period per address. The code lives in `server/src/auth/` (hashing, sessions, lockout, reset), `server/src/http/auth.ts` (guard and routes) and `server/src/db/settings.ts`. `buildApp` takes the open database and records every declared route in `app.declaredRoutes`, which the tests walk so that a later route cannot escape the session and `pin_hash` checks.
Why: SRV-02 (`13` §4) implements the owner's PIN and session decisions (`07` §1, `07` §2, `07` §6, `07` §7, `07` §8; Q-007, Q-008, Q-009, Q-033, Q-042, Q-043, Q-044, Q-046, Q-058, Q-085) and closes G-005, G-006 and the SRV-02 half of G-008. Counting a failure before hashing is what makes the limit of five hold: with the count after the 0.1 s hash, twenty parallel guesses were all checked (shown by mutation). An onRequest hook matched by route and raw path covers unknown paths and runs before the parser, so a browser without the PIN cannot map routes or bodies. The loopback check comes before body parsing for the same reason. A persistent cookie lets the session last until the server restarts, as `07` §2 says, even when the browser is closed; the server-side store is what ends it. A request without an Origin cannot carry a SameSite=Strict cookie from another site, and non-browser clients send none, so refusing it would protect nothing. Setup is done at the server PC by the DM, so signing that browser in saves typing the new PIN twice; ending the sessions it finds covers the one case where some exist, after `reset-pin`. The per-window summary keeps a flood visible without letting it rotate away the lines `07` §8 wants kept. `GET /api/settings` is read-only here: G-008 asks for a test that no `/api` response carries the hash, which needs the route that serialises settings; changing settings belongs to REL-01.
Alternatives: @fastify/cookie and @fastify/rate-limit (rejected: two dependencies for one cookie and one counter, and a rate limit by request count does not express the doubling lockout); a browser-session cookie without Max-Age (rejected: closing the browser would end the session before the restart `07` §2 names); refusing writes without an Origin (rejected: protects against nothing a SameSite=Strict cookie does not, and breaks command-line use); a session check per route in a preHandler (rejected: runs after parsing and misses unknown paths, G-005); counting a failure only after the hash (rejected: parallel guesses bypass the limit); resetting the failure count on a timer (rejected: `07` §6 doubles on each further run, which a reset would undo); N = 2^14 or 2^17 (rejected: 2^14 halves the offline cost for no gain a DM would notice; 2^17 needs 128 MiB per concurrent hash); ending running sessions from `reset-pin` (rejected: a separate process cannot reach the server's memory, and the next setup ends them); setup that does not sign in (rejected: the DM would enter the new PIN twice at the same PC); the PIN change on `PATCH /api/settings` (rejected: settings changes are REL-01's, and a separate resource keeps the lockout on one route); rate-limiting failed-PIN lines as well (rejected: they are the lines G-006 exists to keep, and the lockout bounds them); a timer-free limiter reporting only on the next rejection (rejected: a flood that stops would never be summarised).
Affected specs: `02` §5, `07` §1, `07` §2, `07` §6, `07` §7, `07` §8, `09` §2, `09` §6.
