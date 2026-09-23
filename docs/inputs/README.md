# Inputs

Raw material the specification pack was written from, received 2026-09-23. Files here are copied verbatim and never edited; if the owner supplies a revision, it is added as a new file with its date.

| File | Received | Kind | Authority |
| --- | --- | --- | --- |
| `requirements/D&D VTT — MVP Spec.pdf` | 2026-09-23 | requirements | authoritative |
| `transcripts/2026-09-23-owner-statements.md` | 2026-09-23 | transcripts | authoritative |

## What each authority level means

- **Authoritative.** A requirements source. Every normative statement in `specs/` that restates it carries the `[input]` tag. Where two authoritative inputs disagree, the disagreement is a question card in `QUESTIONS.md`, not a choice.
- **Authoritative (constraints).** Fixes the stack, deployment, jurisdiction, budget or existing systems. Statements restating it are `[input]`. Constraints the inputs do not fix are cards.
- **Non-authoritative.** Direction only: look, tone, layout, examples of what a competitor does, an earlier draft. Specifications win on behaviour. Each behavioural conflict between such an input and the requirements is a card, and the input is never cited as the provenance of a normative statement.

## Non-authoritative inputs and their conflicts

No non-authoritative input was received.

The single input is written in Greek. It states product intent, scope and roadmap, and it also fixes the stack (Node single process, React with react-konva or PixiJS, Socket.io, SQLite, sharp), the deployment model (local server on the DM's PC, LAN-only clients) and the budget posture (free, self-hosted); statements restating any of these are `[input]`. Where the input offers an alternative ("react-konva or PixiJS"), the choice is left open and is recorded as a decision.

## What the inputs do not cover

The input is silent on: the host operating systems the server supports beyond the mention of the Windows firewall prompt; the browsers and TV/projector devices the player view must run on; the language of the user interface; how the DM PIN is set, changed and recovered, and whether the LAN traffic is plain HTTP; backup, retention and deletion of stored data beyond "backup = copy the folder"; the project's own licence and distribution, and any attribution the SRD 5.1 licence (CC-BY-4.0) requires once SRD content ships; accessibility; and performance targets. The maximum dimension of the display image variant is an open question the input itself names. The input is also internally inconsistent in one place: the asset-library section describes campaign export/import as a capability, while the roadmap lists it under Phase 2. Each of these that touches a surface is raised as a card in `QUESTIONS.md`.
