# Emberglass

A free, self-hosted virtual tabletop for in-person play, compatible with 5th edition (SRD 5.1): the DM prepares sessions as series of scenes and runs them on a TV or projector from a server on their own PC. It is not a remote-play platform, a character manager or a map maker. Licensed under AGPL-3.0.

Status: **documentation pack complete, Phase 0 not started.** No code exists yet. The first work package is the command contract (FND-01, `PLAN.md`). Until it lands, every `make` target except `make check-docs` fails with a message naming the package that delivers it.

```bash
make check-docs   # the only target that runs today
make help         # the full command contract
```

- Agents and contributors start at `AGENTS.md`. Ready-made session prompts: `SESSION_BOOTSTRAP_PROMPT_SAMPLE.md`.
- Specifications: `specs/README.md` (map, requirement language, conflict resolution).
- Raw requirements and their authority: `docs/inputs/README.md`.
- Current work, decisions, gaps, open questions and evidence: `PLAN.md`, `DECISIONS.md`, `GAPS.md`, `QUESTIONS.md`, `TRACEABILITY.md`.

## Continuous integration

Added by FND-02 (`specs/13-implementation-plan.md` §3). Every job will run exactly one `Makefile` target and this section will map job to command.

Stack: Node.js 24 LTS (one process), TypeScript, Fastify, Socket.io, SQLite (better-sqlite3), sharp, React with react-konva, Vite; Vitest and Playwright.
