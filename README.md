# Emberglass

A free, self-hosted virtual tabletop for in-person play, compatible with 5th edition (SRD 5.1): the DM prepares sessions as series of scenes and runs them on a TV or projector from a server on their own PC. It is not a remote-play platform, a character manager or a map maker. Licensed under AGPL-3.0.

Status: **Phase 0 in progress.** The command contract and repository scaffold (FND-01) are done: every `make` target runs, and the server serves two empty views. No product feature exists yet; the next work package is in `PLAN.md`.

Development needs Node.js 24 or newer (`nvm use` reads `.nvmrc`) and Python 3 for the documentation gates.

```bash
make setup        # npm ci, Playwright's Chromium, .env from .env.example
make verify       # lint, format-check, typecheck, test, e2e, build, check-docs
make dev          # the server with Vite on http://localhost:3000 (player view /, DM view /dm)
make smoke        # checks a running server
make help         # the full command contract
```

- Agents and contributors start at `AGENTS.md`. Ready-made session prompts: `SESSION_BOOTSTRAP_PROMPT_SAMPLE.md`.
- Specifications: `specs/README.md` (map, requirement language, conflict resolution).
- Raw requirements and their authority: `docs/inputs/README.md`.
- Current work, decisions, gaps, open questions and evidence: `PLAN.md`, `DECISIONS.md`, `GAPS.md`, `QUESTIONS.md`, `TRACEABILITY.md`.

## Continuous integration

Added by FND-02 (`specs/13-implementation-plan.md` §3). Every job will run exactly one `Makefile` target and this section will map job to command.

Stack: Node.js 24 LTS (one process), TypeScript, Fastify, Socket.io, SQLite (better-sqlite3), sharp, React with react-konva, Vite; Vitest and Playwright.
