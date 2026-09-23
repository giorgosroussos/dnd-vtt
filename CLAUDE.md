# CLAUDE.md

Read `AGENTS.md` first. It is the entry point for this repository and the source of truth for how to work here: product boundaries, spec authority, red-line constraints, reading order, commands and the living documents.

Claude Code specifics:

- Follow the session reading order in `AGENTS.md` before proposing changes. Use plan mode for any slice touching more than a couple of files or any migration, policy or contract change.
- Cite spec sections (`specs/NN-name.md` §N) in messages, plan items and decision entries.
- Never commit or push unless asked. Commit messages carry no AI attribution. Write detailed messages: title `TASK-ID: outcome`, then a body grouped by area (what changed and why, decisions and documents touched) ending with a `Verification:` line listing what ran and passed. Git is the archive because `PLAN.md` drops completed items.
- Run `make check-docs` before ending a session, and make `PLAN.md`, `GAPS.md` and `TRACEABILITY.md` truthful about what actually runs and passes.
