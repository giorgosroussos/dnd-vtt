# TRACEABILITY

Implementation status and evidence per work package (`specs/13-implementation-plan.md`) and per critical journey (`specs/10-testing-acceptance.md` §5). Status values: `not started`, `in progress`, `done`. Status is set only from evidence that ran and passed; never from plans, file presence or stubs. `make check-docs` verifies that every package has exactly one row and that `done` rows carry evidence. The product-intent scope matrix is `specs/11-traceability.md`.

## Work packages

| Package | Phase | Outcome | Key specs | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| FND-01 | 0 | Command contract and repository scaffold | `02` §1, `09` §1 | not started | — |
| FND-02 | 0 | CI baseline | `10` §4, `10` §2 | not started | — |
| FND-03 | 0 | API and WebSocket conventions | `02` §5, `04` §2, `04` §3, `04` §5 | not started | — |
| FND-04 | 0 | Design, accessibility and localization foundation | `02` §2, `08` §6, `08` §8, `02` §6 | not started | — |
| SRV-01 | 1 | Schema and migrations | `03` §1, `03` §2, `03` §3, `03` §6 | not started | — |
| SRV-02 | 1 | PIN, DM session and guessing protection | `07` §1, `07` §2, `07` §6, `07` §7 | not started | — |
| SRV-03 | 1 | Campaigns, sessions and scenes over REST | `03` §7, `03` §5 | not started | — |
| SRV-04 | 1 | Image upload pipeline | `05` §6, `05` §7, `03` §7 | not started | — |
| SRV-05 | 1 | Asset library over REST | `05` §1, `05` §2, `05` §4, `05` §5 | not started | — |
| PRP-01 | 2 | DM workspace shell | `08` §1, `07` §1 | not started | — |
| PRP-02 | 2 | Canvas and grid overlay | `08` §3, `06` §2, `03` §6 | not started | — |
| PRP-03 | 2 | Grid calibration | `06` §1, `06` §2, `06` §3 | not started | — |
| PRP-04 | 2 | Tokens in preparation | `05` §3, `05` §4, `05` §5, `06` §4 | not started | — |
| LIV-01 | 3 | WebSocket rooms, snapshots and reconnection | `04` §1, `04` §5, `04` §6 | not started | — |
| LIV-02 | 3 | Live commands and role projection | `04` §2, `04` §3, `04` §4, `07` §5 | not started | — |
| LIV-03 | 3 | Player view and connecting a screen | `08` §4, `08` §9, `08` §5 | not started | — |
| LIV-04 | 3 | Live and prep modes | `08` §2, `04` §2, `04` §10 | not started | — |
| LIV-05 | 3 | Undo | `04` §8 | not started | — |
| LIV-06 | 3 | Cameras | `04` §9 | not started | — |
| LIV-07 | 3 | Ruler | `06` §5, `04` §11 | not started | — |
| REL-01 | 4 | Operations and repository documents | `09` §1, `09` §2, `09` §5, `09` §6 | not started | — |
| REL-02 | 4 | Acceptance suite and system matrix | `10` §3, `10` §5, `10` §6, `10` §4 | not started | — |
| REL-03 | 4 | Acceptance on the owner's TV | `10` §4, `05` §7 | not started | — |

## Critical end-to-end journeys (`10` §5)

| # | Journey | Status | Evidence |
| --- | --- | --- | --- |
| 1 | First run | not started | — |
| 2 | Prepare | not started | — |
| 3 | Connect TV | not started | — |
| 4 | Run | not started | — |
| 5 | Recover | not started | — |

## Phase exit criteria

Phase exit criteria are in `specs/13-implementation-plan.md` §3–7. A phase is exited only when every package in it is `done` here and its exit criteria have recorded evidence. No phase has been entered.

## Reproducing the evidence

From a clone, once FND-01 has delivered the command contract:

```bash
make setup        # dependencies from lockfiles, env examples
make infra-up     # no local services; succeeds and says so
make migrate
make verify       # lint, format-check, typecheck, test, e2e, build, check-docs
make smoke
make audit        # the CI dependency-scan gate
make scan-secrets # the CI secret-scan gate
make check-docs   # runs today, before any code exists
```

`make clean-start` runs the same sequence from a fresh environment and tears it down afterwards. Evidence recorded in this file names the command, the date and what it proved; a reviewer must be able to repeat it from this section.
