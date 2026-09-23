# Emberglass — MVP Specifications

Version: 0.1-draft  
Status: Draft, not yet an implementation baseline  
Audience: Product owner, architects, developers, QA, DevOps and GenAI SWE agents

## Product statement

> Emberglass is a free, self-hosted virtual tabletop for in-person D&D 5e (2014, SRD 5.1) play: the DM prepares a session as a series of scenes in advance and runs it on a TV or projector, operating everything alone. It is not a remote-play platform, a character manager or a map maker, and the MVP puts no game rules in code. [input]

The DM runs one Node server on their own PC; every other screen joins from a browser on the same Wi-Fi. The core loop is prepare (campaigns, sessions, scenes, a shared asset library, grid calibration, pre-placed and hidden tokens) then run (activate a scene, move and reveal tokens, steer the TV's camera, measure, undo). The one property that must always hold is that the player view never receives anything hidden: filtering happens on the server, and a hidden token does not exist for a player client.

## Technology baseline

- Server: Node.js, one process serving the React build, the REST API and the WebSocket, running on the DM's PC. [input]
- Node version: Node.js 24 LTS. [D-012]
- Language and repository: TypeScript, npm workspaces `server`, `client`, `shared`. [D-007]
- HTTP framework: Fastify. [D-008]
- Real-time: Socket.io with rooms `dm` and `players`. [input]
- Storage: SQLite plus an images folder, backed up by copying the folder. [input]
- SQLite access: better-sqlite3 with SQL migrations. [D-009]
- Image processing: sharp, for resizing and thumbnails on upload. [input]
- Frontend: React. [input]
- Canvas: react-konva. [D-006]
- Client build: Vite. [D-010]
- Tests: Vitest and Playwright. [D-011]
- Network: LAN only; the running application contacts nothing outside the LAN. [Q-020]
- Licence: AGPL-3.0. [Q-021]

## Specification map

| File | Purpose |
| --- | --- |
| `01-product-scope.md` | vision, definition of done, actors, MVP / Phase 2 / Phase 3 / nice-to-have / out of scope |
| `02-architecture.md` | repository layout, runtime topology, REST/WebSocket split, REST resources, offline operation |
| `03-domain-model.md` | entities, identifiers, relationships, deletion rules |
| `04-live-sync.md` | WebSocket contract: commands, events, snapshot and versioning, visibility filtering, reconnection, undo, cameras |
| `05-assets-and-images.md` | asset library, image upload pipeline, image variants, upload limits |
| `06-grid-and-measurement.md` | grid calibration, grid storage and presets, snapping, ruler |
| `07-security-and-access.md` | DM PIN and session, player-view access, transport, image entitlement, logging |
| `08-ux-journeys.md` | DM workspace, live and prep modes, player view, connecting a screen, language, devices, accessibility |
| `09-operations.md` | installation, start-up, supported systems, firewall, data folder and backup, logging |
| `10-testing-acceptance.md` | quality gates, acceptance scenarios, acceptance devices |
| `11-traceability.md` | product intent to specification and scope status |
| `12-decision-register.md` | locked owner decisions with their provenance |
| `13-implementation-plan.md` | phases and work packages |
| `14-agent-playbook.md` | how implementation agents work on this repository |

## Requirement language

`MUST`, `SHOULD` and `MAY` are normative. Unless explicitly labeled Future, every `MUST` requirement is part of MVP acceptance. Every `MUST` is testable: the testing specification or the work package that delivers it names the check that verifies it.

Sections are numbered and never renumbered. New content is appended as a new section or a new bullet; other documents cite `specs/NN-name.md §M` and those citations must keep resolving. `make check-docs` verifies every citation.

## Provenance

Every normative statement ends with a provenance tag:

| Tag | Meaning |
| --- | --- |
| `[input]` | stated by the owner in the raw requirements (`docs/inputs/`) |
| `[Q-NNN]` | decided by the owner by answering question card Q-NNN in `QUESTIONS.md`; `[Q-NNN, recommendation accepted]` when the owner accepted the proposed option |
| `[D-NNN]` | implementation default recorded in `DECISIONS.md` with alternatives; touches no data, security, scope, external or UX decision |
| `[inferred]` | inference not yet ratified; none remain at an implementation baseline |

`12-decision-register.md` contains only `[input]` and `[Q-NNN]` statements. `make check-docs` enforces it.

## Scope labels

- **MVP:** required for the first production release.
- **Future:** anticipated in architecture, but not implemented in MVP.
- **Out of Scope:** intentionally excluded; implementation agents must not add it.

## Conflict resolution

1. `12-decision-register.md` and the product statement override inferred behavior.
2. Security and hidden-information isolation requirements override convenience.
3. A feature not described as MVP is not silently added.
4. Ambiguities that materially affect data, security or scope become an Architecture Decision Record before implementation.
