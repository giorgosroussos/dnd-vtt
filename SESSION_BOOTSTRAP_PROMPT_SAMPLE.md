# Session bootstrap prompts

Copy one of the prompts below into a fresh agent session. Adjust the bracketed parts only when needed. The default prompt works for most implementation sessions because `PLAN.md` already carries the task ID, spec references and acceptance criteria.

## Which of the three a task needs

Prompt 1 runs for every task; prompts 2 and 3 are conditional, and the condition is not a judgement. Before starting the `Now` package, read its `Surfaces`, `Touches red line` and `Contract change` in `specs/13-implementation-plan.md`, and compute `blocked-by`: the cards in `QUESTIONS.md` under Blocking or Open whose `Blocks:` names the package. `python3 scripts/check-docs.py --task <TASK-ID>` prints all four in one line. Then apply the table in `AGENTS.md` "Prompt selection" and run only what it selects, in the order 3, 1, 2. Nothing is written back: the stored three are verified by `make check-docs`, and `blocked-by` is live, so a card resolved this morning changes the answer this afternoon without an edit to the plan.

## 1. Default: implement the current `Now` item

```text
Implement the current `Now` item in PLAN.md using AGENTS.md as the working contract.

Before changing anything, read AGENTS.md, PLAN.md, QUESTIONS.md, GAPS.md and TRACEABILITY.md,
then the DECISIONS.md index and the D-entries the `Now` item cites, then specs/README.md,
specs/12-decision-register.md and every spec section the `Now` item references.
Inspect existing code and tests before editing. Restate your assumptions and flag any conflict
with a locked decision before you start.

Work in the smallest vertical slice that produces the item's observable outcome. Add or update
tests in the same change, including DM/player hidden-information cases wherever the player view could receive data.
Update the shared type definitions whenever a contract changes.

Record as you go, in the smallest relevant document:
- judgement calls and tooling choices as a `decision-added` event (`scripts/log-append.py`,
  dated, with alternatives) followed by `make rebuild-decisions`; never by editing DECISIONS.md;
- deliberate incompleteness in GAPS.md, never hidden behind a stub;
- anything the specs cannot answer in QUESTIONS.md as a decision card, with spec reference,
  options and their consequences;
- verification evidence (commands run, test names) in TRACEABILITY.md.

Spec text may be amended only where AGENTS.md allows it and only with a `spec-amendment`
event appended to the log, and DECISIONS.md rebuilt, in the same change. Never touch a locked decision or a red line without
an approved ADR. Never invent requirements, weaken tests, or mark work done from file presence.

Continue until every acceptance condition of the `Now` item is demonstrably satisfied,
`make verify` passes from a documented starting state, `make check-docs` passes, PLAN.md
accurately describes the remaining work with the completed item removed, and no blocker is
concealed. If a specification ambiguity materially changes data, security, scope, external
commitments or UX, write it as a card in QUESTIONS.md and pause only if proceeding would make
a costly or irreversible assumption. Otherwise state the assumption, tag it, and continue.

Finish with a handoff: behaviour changed, commands run and their results, migration and
rollback notes, security and privacy considerations, follow-ups not implemented.
Do not commit unless asked. Commit messages carry no AI attribution.
```

## 2. Review pass on a finished slice

```text
Run a bounded review of the last completed slice ([TASK-ID]) as described in AGENTS.md and
specs/14-agent-playbook.md §7. Do not redesign or refactor unrelated code.

Read AGENTS.md, the TRACEABILITY.md row for the slice, and the spec sections it cites. Then
review in four separate passes and report findings with file evidence and severity:
1. correctness against the spec sections and state invariants;
2. security and isolation: attempt to learn a hidden token, a prep scene or its images from the player view or an unauthenticated request, PIN guessing and lockout bypass, session reuse after a PIN change, and upload abuse;
3. tests: missing negative, concurrency and idempotency cases;
4. UX and accessibility for any UI touched: English message catalogue with no hard-coded strings, keyboard operation of core DM actions, the live/prep mode indicator, idle, loading, reconnecting and error states.

Critical and high findings block merge. Propose fixes but implement only those I approve, or
those that are clearly local and covered by the existing tests. Update GAPS.md for anything
you find that is deliberately deferred.
```

## 3. Resolve open questions before a phase

```text
Prepare the cards in QUESTIONS.md whose `Blocks:` field names [PHASE or TASK-ID].

For each card, read the cited spec sections and the input it names, then confirm or revise
the options and the recommendation with spec impact (none, spec-amendment or ADR) and
implementation cost. Do not implement anything. Present the cards to me in one batch; I will
answer per card or accept the recommendations. After I decide, record each answer on its card,
record the decision as an event and rebuild (type spec-amendment when spec text changes, adr when a
locked decision changes), move the card to Resolved with the decision ID, update the affected
spec text with its provenance tag, and update PLAN.md if the decision changes the next slice.
Run make check-docs before finishing.
```

## Notes

- Keep prompts short. The living documents carry the detail; the prompt only points at them.
- When a session ends early, ask the agent to leave `PLAN.md`, `GAPS.md` and `TRACEABILITY.md` truthful before stopping, so the next prompt 1 picks up cleanly.
- Replace `[TASK-ID]` with the package ID from `specs/13-implementation-plan.md` (for example FND-01).
- Running every prompt on every task is not the safe default: it spends a session on passes whose dimension the package does not have. The table is the policy, and it lives in `AGENTS.md` so it can be tuned without unlocking the specs.
