# GAPS

Deliberate incompleteness and missing infrastructure. A gap is closed only by evidence, never by a stub. Each row names the evidence that closes it and the plan item that produces it. IDs are never reused: a closed gap's row is removed and its ID retired. `make check-docs` verifies that every cited work package and phase exists.

| ID | Gap | Consequence | Evidence to close | Plan item |
| --- | --- | --- | --- | --- |
| G-001 | Nothing exists beyond the documentation pack: no code, no infrastructure definition, no CI. Every `make` target except `check-docs` fails by design until its work package lands. Every work package in `specs/13-implementation-plan.md` is unstarted. | Nothing in the product specs is verifiable yet. | Per-package rows in `TRACEABILITY.md` moving to `done` with command and test evidence, starting with FND-01. | FND-01, then Phase 0 onward |
| G-002 | The model and webOS version of the owner's LG TV, the player view's acceptance device, are not known. | The display-version size cannot be confirmed and the TV acceptance run cannot be planned against a known browser. | The model or webOS version recorded in `docs/inputs/` and the acceptance run of `10` §4 passing on it. | REL-03 |
