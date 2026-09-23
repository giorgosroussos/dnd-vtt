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
- D-058 — CI pipeline mechanics on Linux and Windows — implementation
- D-059 — Failing-forward tripwires for missing gates — implementation

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
Type: implementation
Decision: `.github/workflows/ci.yml` runs on every pull request, every push to `main` and on demand. Two jobs, `linux` (`ubuntu-latest`) and `windows` (`windows-latest`), each a matrix over the gate targets `lint`, `format-check`, `typecheck`, `test`, `e2e`, `build`, `check-docs`, `audit` and `scan-secrets`, one job per target per runner, `fail-fast` off. A job provisions the machine (checkout, Node from `.nvmrc`, `make setup`) and then runs exactly one `make <target>`; `check-docs` skips Node and `make setup` because it needs Python only. On Windows, where the image has no `make`, the steps run in the image's preinstalled MSYS2 (via `msys2/setup-msys2`, `path-type: inherit`, packages `make` and `python`), so `make` and bash come from MSYS2 while node, npm and git stay the native Windows ones the product runs on. `make setup` gains `SETUP_BROWSERS` (default `chromium`); CI sets it empty on jobs without a browser and to `--with-deps chromium` for the Linux `e2e` job. Caches: npm through `setup-node` and Playwright browsers through `actions/cache`, both keyed on `package-lock.json`; the `e2e` job uploads `e2e/test-results/` for seven days when it fails. No job retries, Playwright keeps `retries: 0`, and a newer push cancels an older run of the same pull request. Every action is pinned to a commit SHA with its tag in a comment, and the workflow token is read-only. `.gitattributes` normalizes text to LF, and the tracked `*:Zone.Identifier` file (Windows download metadata, whose `:` no Windows checkout accepts) is removed and ignored. `scripts/scan-secrets.mjs` quotes file names and batches them under the 8191-character command line of `cmd.exe` on Windows.
Why: One target per job is what makes a green pipeline mean a green `make verify` (`10` §1), and running the same targets on Windows is the only automatic verification of `09` §3 and `10` §4 before release. MSYS2 is already on the image, so no Windows port of the Makefile is needed, and the product still runs on native Node. Without LF normalization a Windows checkout would fail `format-check` and change the bytes the event log's hash chain covers. The unquoted file list broke `scan-secrets` on Windows at the first file name containing `&`, and a longer list would pass the `cmd.exe` limit. SHA pinning keeps a moved tag from changing what CI runs.
Alternatives: Git Bash with a native Windows `make` from Chocolatey (rejected: a native `make` does not resolve `SHELL := /bin/bash`); MSYS2 `make` called from Git Bash (rejected: two MSYS runtimes in one process tree); a PowerShell port of the command contract (rejected: a second contract that could pass where the Makefile fails); a single `make verify` job per runner (rejected: one red job hides which gate failed, and `check-docs` must be its own job); actions pinned to major tags (rejected: a moved tag changes CI silently); `.gitattributes` left out and `core.autocrlf false` set in the workflow (rejected: a Windows developer's clone would still get CRLF).
Affected specs: `13` §3, `10` §1, `10` §2, `10` §4, `09` §3.

## D-059 (2026-09-23) — Failing-forward tripwires for missing gates
Type: implementation
Decision: `make tripwire GATE=<id>` (no `GATE`: all) runs `scripts/tripwire.mjs`, which holds the registry of gates the testing specification requires and nothing implements yet: `hidden-information`, `player-command-rejection`, `image-revocation` (`10` §3) and `offline-e2e`, `external-url-build` (`10` §6). A gate announces itself with the marker `@gate:<id>` in the code that implements it, normally its test title, so `--grep @gate:<id>` also selects it. The tripwire scans every code file Git tracks or would track, except its own registry and tests, and passes only when no file carries the marker and the scan covered both the Playwright and the Vitest test roots; a scan that saw neither fails rather than passes. When a marker appears the job fails and prints the promotion steps: run the gate inside a real gate target, remove its registry entry and CI job, update `README.md` and `TRACEABILITY.md`. CI runs one tripwire job per gate on Linux, named `tripwire · <id> (absent)`. `make test` gains a `scripts` Vitest project for the tooling's own tests.
Why: `13` §3 FND-02 requires that a missing gate and a silently passing gate never look alike: the job name and output say the gate is absent, and the first implementation turns the job red instead of letting a tripwire keep passing beside a real gate. A marker in the implementing test is cheap to add and cannot drift from the gate it names. `image-revocation` is included because `10` §3 requires that test as well, beside the two gates the plan lists. The tripwires read text only, so a second runner adds nothing.
Alternatives: Detecting a gate by fixed file paths (rejected: dictates layout to REL-02 and misses a gate written elsewhere); detecting it by product surface, such as the existence of a `players` room (rejected: would turn red with LIV-01, before the gate's own package, and block unrelated work); one job running every tripwire (rejected: one red job would hide which gate arrived); tripwires as skipped tests inside `make test` (rejected: a skipped test looks like a passing gate in the summary, which is what `13` §3 forbids); a separate `make` target per gate (rejected: five targets in the command contract for one mechanism).
Affected specs: `13` §3, `10` §3, `10` §6.
