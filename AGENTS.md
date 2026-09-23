# AGENTS.md — Emberglass

This file is the entry point for every human or GenAI agent working in this repository. Read it fully before touching anything.

## Product

Emberglass is a free, self-hosted virtual tabletop for in-person D&D 5e play (2014 rules, SRD 5.1), published under its own name and described as 5th-edition compatible (`specs/README.md` §Product statement, `01` §8). The DM runs one Node server on their own PC; a TV or projector opens the player view from a browser on the same Wi-Fi, and the DM prepares and runs everything from the DM view (`01` §2, `02` §2). The core loop is prepare (campaigns, sessions, scenes, a shared asset library, grid calibration, pre-placed and hidden tokens) then run (activate a scene, move, reveal, measure, steer the TV camera, undo) (`01` §3). It is not a remote-play platform or a map maker, and the MVP has no player devices, character sheets or game rules in code (`01` §1, `01` §2, `01` §7).

The MVP is done when the DM can prepare a session in advance and run it on a TV or projector, operating everything alone (`01` §1).

## Authority and reading order

`specs/` is the authoritative product and engineering contract; its version and status are on `specs/README.md`. Requirement language is normative: every `MUST` not labelled Future is MVP acceptance (`specs/README.md` §Requirement language), and every normative statement carries a provenance tag (`specs/README.md` §Provenance). Conflict resolution, in order (`specs/README.md` §Conflict resolution):

1. `specs/12-decision-register.md` and the product statement override inferred behaviour.
2. Security and hidden-information isolation requirements override convenience.
3. A feature not described as MVP is not silently added.
4. Ambiguities that materially affect data, security or scope become an ADR before implementation.

**Amendment regime (D-002).** Agents MAY amend non-locked spec text when implementation genuinely requires it, but never silently: the same change must carry a dated `DECISIONS.md` entry of type `spec-amendment` (what changed, why, alternatives, affected spec sections), and the amended statement keeps or gains a provenance tag. Sections are never renumbered. The following are **excluded from delegation** and require an ADR entry in `DECISIONS.md` marked `Owner approval: pending` plus explicit owner sign-off before any code: every bullet in `specs/12-decision-register.md`, and every red line in the next section. If specs conflict with each other, resolve via a recorded decision when the resolution is clear; otherwise record it in `QUESTIONS.md`. Never choose silently. If code contradicts specs, stop and escalate (`14` §10).

**Non-authoritative inputs (D-003).** None were received. Any mockup, competitor reference or prior draft added later gets an authority entry in `docs/inputs/README.md` and a `DECISIONS.md` entry before use.

**Session reading order:**

1. `AGENTS.md`, then `PLAN.md`.
2. `QUESTIONS.md` (Blocking and Open), `GAPS.md`, `TRACEABILITY.md`, and in `DECISIONS.md` the index plus the entries the active `PLAN.md` item cites. Read the whole of `DECISIONS.md` only when working on cross-cutting architecture.
3. `specs/README.md` and `specs/12-decision-register.md`, then the spec files cited by the active `PLAN.md` item. Read all specs before changing cross-cutting architecture, hidden-information isolation, authorization, the contract root or shared migrations.
4. `docs/inputs/README.md` when a task cites a raw requirement or a non-authoritative input.

## Non-negotiable constraints

- **Hidden information never leaves the server.** The `players` room receives only visible content, filtered on the server; nothing reveals a hidden token's existence, ID, asset, image or count, and players fetch only the display version of the live map and visible tokens' images (`04` §4, `07` §5, `12` §2).
- **The server decides, from the session only.** The server is the only source of truth, derives every role from the DM session and never from a client claim, validates every command and REST body, and rejects every command from the `players` room (`02` §3, `07` §3, `07` §7).
- **PIN and sessions.** PIN setup only from the server machine's loopback address; PIN stored as a salted hash; DM sessions in memory until restart; a PIN change ends every other session; logs never contain a PIN, session identifier or cookie (`07` §1, `07` §2, `07` §8).
- **Scope is fixed.** No player devices, character sheets, rules beyond the size table and the ruler, remote play, map creation, fog of war, campaign export/import, area templates or ping; Phase 2, Phase 3 and nice-to-have items are not built (`01` §1, `01` §4, `01` §5, `01` §6, `01` §7).
- **LAN only, offline.** The running app sends nothing outside the LAN: no telemetry, update check or CDN; every asset is bundled (`02` §6, `10` §6).
- **Identifiers and positions.** UUIDs for every entity except Image, which is its sha256; token positions in decimal grid units; grid values in original-image dimensions (`03` §3, `03` §4, `06` §2).
- **Deletion rules.** Cascades as specified with confirmation, assets in use are never deleted, deletions are permanent, unreferenced images are removed, deleting the live scene blanks the TV (`03` §7).
- **Preparation and play stay apart.** Changes to a scene that is not live reach no other client; live setup edits go out as a fresh snapshot; live token commands are exactly add, move, visibility and delete (`02` §4, `04` §2, `04` §10).
- **Uploads.** PNG, JPEG and WebP only, judged by content, under the configurable limit; a rejection stores nothing (`05` §6).
- **Name and licence.** No "D&D" or "Dungeons & Dragons" in the product, UI or package names; AGPL-3.0 (`01` §8, `09` §8).
- **Tests are honest.** Integration tests use a real SQLite file, never a mock; the hidden-information suite and the offline run are release gates; a test is never weakened to pass (`10` §2, `10` §3, `14` §3).
- **Schema changes are migrations.** Numbered SQL migrations applied at start-up, additive first; no destructive migration without an approved plan (`09` §2, `14` §8).

## Architecture and stack

One Node.js 24 LTS process serves the React client, the REST API under `/api` and the Socket.io WebSocket with rooms `dm` and `players` (`02` §2, `02` §5, `04` §1). The server is TypeScript on Fastify with better-sqlite3 and sharp; the client is React with react-konva, built by Vite; contract types live in the `shared` workspace; tests are Vitest and Playwright (`specs/README.md` §Technology baseline).

Target repository layout (`02` §1):

```text
server/            Node server workspace
  src/http/        REST routes, static serving
  src/ws/          Socket.io handlers, rooms, role projection
  src/domain/      commands, events, undo, live state
  src/db/          SQLite access
  src/images/      upload validation, sharp variants
  migrations/      numbered SQL migrations
client/            React client workspace (both views)
  src/dm/          DM view
  src/player/      player view
  src/canvas/      react-konva map, grid, tokens
  src/ui/          shared components, message catalogue
shared/            contract types: REST bodies, commands, events
e2e/               Playwright tests
scripts/           repository tooling
specs/  docs/      specifications and inputs
```

There is one host, the DM's PC; the player view is served at `/` and the DM view at `/dm` on port 3000 by default (`02` §2). All state is one SQLite file and an images folder in one per-user data directory; backup is a copy of that directory (`02` §7, `09` §5). Live state (undo history, player camera, version counter, sessions) lives in memory and does not survive a restart by design (`04` §5, `04` §8, `07` §2). There is no local infrastructure, no background queue and no remote environment. Tooling the specs leave open is chosen in `DECISIONS.md`.

## Commands

Root command contract, implemented by the root `Makefile` (FND-01, D-001) with helpers in `scripts/`. Every target below exists. A target whose work package has not been delivered yet fails with a message naming that package instead of passing, so a missing gate and a passing gate never look alike; `make check-docs` is real from the first commit and asserts that this list and the `Makefile` agree. `make test` and `make smoke` need `make infra-up` first when the product has local infrastructure (none: the infra targets succeed and say so).

```bash
make setup          # install dependencies from lockfiles, copy env examples
make infra-up       # start local infrastructure and wait for health
make infra-status
make infra-down
make migrate        # apply database migrations locally
make dev            # run every application process for local development
make test           # unit and integration tests against a real SQLite file
make lint
make format         # apply formatting
make format-check   # verify formatting without changing files
make typecheck
make e2e            # end-to-end tests: a DM view and a player view against a running server
make build          # production builds
make verify         # lint + format-check + typecheck + test + e2e + build + check-docs
make smoke          # health of the running system through its public entry points
make audit          # dependency advisories
make scan-secrets   # secret scan of everything Git tracks
make check-docs     # mechanical consistency of the documentation layer (scripts/check-docs.py)
make check-locks    # lock manifest check of the staged change (scripts/lock-guard.py)
make verify-chain   # recompute every hash and link in .log/events.jsonl
make rebuild-decisions  # render DECISIONS.md from the event log
make rebuild-questions  # render QUESTIONS.md from the event log
make install-hooks  # point git at .githooks/ (once per clone)
make unlock         # ceremonial unlock of one hard-locked path: PATH=<path> REASON="why"
make clean-start    # fresh isolated environment: setup, infra-up, migrate, verify, smoke, teardown
```

`check-docs`, `check-locks`, `verify-chain`, the two `rebuild-*` targets, `install-hooks` and `unlock` are real from the first commit; the rest arrive with FND-01.

CI (FND-02) runs on every merge request and every push to the default branch. Each job runs exactly one of the targets above, so a gate cannot pass in CI and fail locally; `README.md` maps job to command. Gates the testing specification requires that nothing implements yet run as failing-forward tripwires that pass only while the gate is provably absent (`13` §3).

## Working method and definition of done

Work in the smallest useful vertical slice, following the task packet of `14` §2 and §4: one task ID and outcome, exact spec sections, dependencies merged, allowed file surface and shared-file owner, executable acceptance criteria, explicit non-goals. Before coding, inspect current code and tests, restate assumptions and flag conflicts with locked decisions (`14` §3). Implement, add tests in the same change, run targeted then broader suites, regenerate contract artifacts when contracts change, and report changed behaviour, migration and rollback implications and remaining risks.

Definition of Ready and Done are `14` §5–6. Review runs as separate bounded passes after implementation, when the table in the next section selects it: correctness, security and isolation, tests, UX and accessibility (`14` §7). Critical and high findings block merge. Parallel work follows the lanes in `13` §8; never parallelize migrations for the same aggregate or concurrent edits to central policies or the contract root without explicit ownership. Product Owner checkpoints are `14` §12. The release gate is `10` §5 together with the last phase's exit criteria in `13` §7.

## Prompt selection

`SESSION_BOOTSTRAP_PROMPT_SAMPLE.md` holds three session prompts, and this table decides which of them a task needs. The mechanical gates are the floor for every task, not a prompt: the package's executable acceptance criteria and `make check-docs` run whatever the table says, and the review prompt exists only for what those gates cannot check. Each work package in `specs/13-implementation-plan.md` states `Surfaces`, `Touches red line` and `Contract change`; the first two are derived from the sections the package cites and `make check-docs` verifies them, the third is the plan author's judgement. `blocked-by` is not stored anywhere: it is the set of open cards in `QUESTIONS.md` whose `Blocks:` names the package, read when the task starts, so resolving a card needs no change to the plan. `python3 scripts/check-docs.py --task <PACKAGE>` prints all four.

| Prompt | Run when |
| --- | --- |
| 1 — Implement | Always. |
| 3 — Resolve questions | Before the package, iff an open card in QUESTIONS.md has `Blocks:` = this package. |
| 2 — Review | After implementation, iff `Surfaces` includes `security` or `data`, or `Touches red line` is `yes`, or `Contract change` is `yes`. Otherwise skip: the executable acceptance criteria and `make check-docs` already cover correctness, and there is no security, isolation or contract dimension for a review to add. |

## Living documents

All at repository root. When scope changes, update the smallest relevant document. Durable rationale goes to `DECISIONS.md`, incompleteness to `GAPS.md`, unresolved choices to `QUESTIONS.md`; `PLAN.md` never becomes an archive. `make check-docs` fails on the inconsistencies that can be detected mechanically; the rules below are the ones it cannot.

- `PLAN.md`: exactly `Now` and `Next`. Keep 1–3 narrow `Now` items and only the next few slices, each with spec refs and executable acceptance. Not history, design or backlog; remove completed items, Git is the archive. If code and plan disagree, investigate and correct the plan.
- `DECISIONS.md`: a generated projection of the `decisions` stream of `.log/events.jsonl`, which is the source of truth. Never edit it and never hand-write an entry: append an event with `scripts/log-append.py` (`decision-added`, `decision-superseded`, `adr-approval-changed`) and run `make rebuild-decisions`. A record carries decision, why, alternatives, affected specs and type (`implementation`, `spec-amendment`, `adr`); an `adr` carries its owner-approval state, changed by its own event. Retire a record by superseding it, which renders as `Status: superseded by D-MMM`; nothing is ever rewritten or deleted, because the alternatives a decision weighed are the only record of why it reads as it does. `make check-docs` verifies the chain (`chain-intact`) and that this file equals a fresh rebuild (`projection-fresh`), so an edit here fails the gate instead of becoming the record. `.log/README.md` states what the chain does and does not guarantee.
- `GAPS.md`: deliberate incompleteness, missing infrastructure, deferred scope, its consequence and the evidence needed to close it. Never mask a gap with a stub. A closed gap's row is removed and its ID retired.
- `QUESTIONS.md`: a generated projection of the `questions` stream of `.log/events.jsonl`, in the decision-card format the file documents. Never edit it: open, answer, defer, reactivate, resolve and supersede cards by appending events (`scripts/log-append.py`) and running `make rebuild-questions`, so a card moves between Blocking, Open and Resolved because an event says so. Resolve a card by writing its answer into the specs with a `[Q-NNN]` tag, or into a decision after the baseline, and appending `card-resolved`; never by deleting it. An owner who changes their mind gets a new card and a `card-superseded` event: the old card stays Resolved and readable, and the citation moves to its successor, which `check-docs` expects. Before a phase starts, resolve the Open cards whose `Blocks:` names it.
- `TRACEABILITY.md`: work packages from `specs/13-implementation-plan.md` and the critical journeys from `10` §5 mapped to status and concrete evidence (test names, commands). Status is set only from evidence that ran and passed, never from plans, file presence or stubs. The product-intent scope matrix remains the traceability file in `specs/`, owner-maintained.
- `.doc-locks`: which files are hard-locked, append-only or free, one `tier: glob` per line, last match wins. `scripts/lock-guard.py` enforces it over the diff from `.githooks/pre-commit` and from the pre-receive hook on the remote; `.githooks/README.md` says why both exist. Run `make install-hooks` once per clone. A hard-locked file changes only through `make unlock PATH=<path> REASON="..."`, which records the reason in `UNLOCKS.md` and authorizes exactly that path for exactly one commit. Tiers only ever go up: promoting a file is a line appended to `.doc-locks` through the same ceremony (the manifest is hard-locked), and the guard refuses any change that would lower a path's tier.
- `AGENTS.md` itself stays under 20 KB; when it does not fit, content moves to `specs/14-agent-playbook.md` or `docs/`, never into `CLAUDE.md`.
