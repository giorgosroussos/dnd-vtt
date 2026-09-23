# GenAI SWE Agent Playbook

## 1. Purpose

This playbook turns the specs into bounded coding tasks while controlling hallucinated scope, inconsistent abstractions and unsafe migrations. The operating rules that can be checked mechanically are not repeated here; `make check-docs` enforces them.

## 2. Required task packet

Every agent receives:

- one task ID and one concrete outcome;
- exact relevant spec files and sections;
- repository conventions and current architecture notes;
- dependencies already merged;
- files or modules it may change and the known shared-file owner;
- executable acceptance criteria;
- explicit non-goals;
- commands for lint, tests and build (always `make` targets).

Do not give every agent the whole project unless the task is architectural review. Retrieve only the relevant specs plus `specs/README.md` and `12-decision-register.md`. From `DECISIONS.md`, read the index and the entries the current `PLAN.md` item cites.

## 3. Agent execution contract

The agent MUST: [D-005]

1. inspect current code and tests before editing;
2. restate assumptions and flag conflicts with locked decisions;
3. implement the smallest coherent slice;
4. add or update tests in the same change;
5. run targeted tests, then the relevant broader suite;
6. update the shared type definitions and docs when contracts change;
7. report changed behavior, migration and rollback implications and remaining risks.

The agent MUST NOT: [D-005]

- change product scope or locked decisions;
- introduce player devices, character sheets, rules automation, remote play, map creation, fog of war or any other excluded capability;
- trust a client-supplied role or visibility claim;
- weaken a test merely to make CI pass;
- edit unrelated user code or reformat the repository broadly;
- create speculative abstractions without an MVP consumer;
- commit secrets, sample personal data or raw access tokens;
- perform destructive migrations without an approved migration plan.

## 4. Standard task template

```markdown
# TASK <ID>: <Outcome>

## Context
- Specs: `<file>` §<section>
- Dependencies: <merged tasks>
- Locked decisions: <relevant bullets of the register>
- Decisions to read: <D-NNN entries this task relies on>

## Deliverable
<One observable result>

## Allowed scope
- <modules/files or bounded area>

## Acceptance criteria
- [ ] <executable behavior/test>
- [ ] DM/player hidden-information cases added
- [ ] Authorization and validation enforced server-side
- [ ] the shared type definitions updated if applicable
- [ ] Targeted and regression commands pass

## Explicit non-goals
- <features not to implement>

## Handoff
- Behavior changed
- Tests/commands run
- Migrations and rollback notes
- Security/privacy considerations
- Follow-up items, without implementing them
```

## 5. Definition of Ready

A task is ready only when dependencies are merged, domain and contract behavior is unambiguous, acceptance can be tested, fixtures and roles are identified, and no unresolved card in `QUESTIONS.md` with a `Blocks:` field naming this task or its phase is still open.

## 6. Definition of Done

- Acceptance criteria and the relevant spec behavior implemented.
- Tests include happy path, validation, authorization, DM/player hidden-information isolation and the important state or concurrency failure.
- Static analysis, lint and build pass.
- Migration works on existing data and rollback or forward recovery is documented.
- the shared type definitions synchronized.
- Audit, logging and redaction considered.
- Accessibility and localization states covered for UI.
- No unrelated diff and no hidden TODO replacing required work.
- A human reviewer can reproduce verification from the handoff.
- Files, schemas, routes, components, migrations, mocks or stubs merely existing is never completion; a non-functional stub is a gap and belongs in `GAPS.md`.

## 7. Review agents

Use review as separate bounded passes after implementation:

1. **Correctness reviewer:** checks spec acceptance and state invariants.
2. **Security/isolation reviewer:** attempts to learn hidden information from the player side, PIN and session abuse, and upload abuse.
3. **Test reviewer:** finds missing negative, concurrency and idempotency cases.
4. **UX/accessibility reviewer:** reviews relevant UI only.

Reviewers propose findings with file evidence and severity; they do not redesign unrelated code. Critical and high findings block merge.

## 8. Database-change rules

- One owner per migration sequence or aggregate during active work.
- Prefer additive nullable columns and tables, backfill, enforce, then later cleanup (expand, migrate, contract). [Q-081]
- Index foreign keys and primary query paths.
- Use database constraints for key invariants where practical.
- UUIDs (sha256 for Image) are the only keys; no internal sequential key exists to expose. [Q-084]
- Test migrations on the generated fixture database before every release; no real campaign data enters the repository or CI. [Q-082]

## 9. Contract-change rules

Contract-first for shared work across components. The owning agent publishes the shared type definitions plus fixtures early; consuming agents use the generated artifacts. Do not hand-write duplicate request or response types.

## 10. Context and handoff discipline

Keep a short task log or merge description with decisions and commands. New agents inspect the merged repository and the task handoff rather than trusting stale prose. If code contradicts specs, stop and escalate; do not silently choose one. Before ending a session, leave `PLAN.md`, `GAPS.md` and `TRACEABILITY.md` truthful about what actually runs and passes.

## 11. Example prompt for an implementation agent

```text
You are implementing SRV-03 "Campaigns, sessions and scenes over REST" in the Emberglass repository.

Read first: AGENTS.md, specs/README.md, specs/12-decision-register.md,
specs/03-domain-model.md §5 and §7, specs/02-architecture.md §5,
and DECISIONS.md entries D-009, D-015, D-016.

Deliverable: REST CRUD and ordering for campaigns, sessions and scenes,
scene duplication, deletion cascades returning confirmation data, and
live-scene deletion that clears the live pointer.

Allowed scope: server/src/http, server/src/domain, server/src/db,
server/migrations (only if SRV-01 left a gap), shared/src.

Acceptance:
- integration tests against a real SQLite file for every route;
- deleting a campaign, session or scene removes exactly its descendants;
- duplicating a scene copies its tokens with new UUIDs;
- a new scene copies its map's grid preset; calibrating updates the preset
  and leaves other scenes unchanged;
- every route refuses a request without a DM session;
- make lint typecheck test pass.

Non-goals: the asset library (SRV-05), image processing (SRV-04),
any UI, any WebSocket event.

Hand off: behaviour changed, commands run, migration notes, follow-ups.
```

## 12. Product-owner checkpoints

Require explicit Product Owner review after Phase 2 (a whole session prepared in the browser), Phase 3 (the first session run on the TV) and before the Phase 4 release. These checkpoints validate product behavior without reopening locked architecture absent a real contradiction. Open cards in `QUESTIONS.md` whose `Blocks:` names the next phase are resolved at the checkpoint that precedes it.
