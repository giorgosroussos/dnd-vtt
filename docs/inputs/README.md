# Inputs

Raw material the specification pack was written from, received 2026-09-23. Files here are copied verbatim and never edited; if the owner supplies a revision, it is added as a new file with its date.

| File | Received | Kind | Authority |
| --- | --- | --- | --- |
| `requirements/D&D VTT — MVP Spec.pdf` | 2026-09-23 | requirements | authoritative |
| `transcripts/2026-09-23-owner-statements.md` | 2026-09-23 | transcripts | authoritative |
| `requirements/2026-09-30-ui-redesign-brief.md` | 2026-09-30 | requirements | authoritative |
| `Design.html` | 2026-09-30 | mockup | non-authoritative |

## What each authority level means

- **Authoritative.** A requirements source. Every normative statement in `specs/` that restates it carries the `[input]` tag. Where two authoritative inputs disagree, the disagreement is a question card in `QUESTIONS.md`, not a choice.
- **Authoritative (constraints).** Fixes the stack, deployment, jurisdiction, budget or existing systems. Statements restating it are `[input]`. Constraints the inputs do not fix are cards.
- **Non-authoritative.** Direction only: look, tone, layout, examples of what a competitor does, an earlier draft. Specifications win on behaviour. Each behavioural conflict between such an input and the requirements is a card, and the input is never cited as the provenance of a normative statement.

## Non-authoritative inputs and their conflicts

`Design.html` (2026-09-30) is a self-contained bundle of three boards: the live DM view at 1440 × 900, and the player view live and idle at 1920 × 1080. It gives the look: palette, typography, layout, token and frame visuals. Behaviour comes from the specifications and from the brief that came with it; the bundle is never cited as the provenance of a normative statement. Where the boards and the specifications differ on behaviour, the specifications win and the difference is recorded in `DECISIONS.md` as a deviation from the design (D-139 and the UIX-01 and TBL-01 to TBL-03 decisions after it). Examples: the boards show "Diagonals 5/10", while the default stays the PHB rule (`06` §5); the boards draw no persistent live indicator around the canvas, which `08` §2 keeps.

## The 2026-09-30 brief

The brief is an owner statement and restates the redesign's requirements. It conflicts with the specification pack in two places, each raised as a card and answered by the owner on 2026-09-30:

- its Part B (ping, condition markers, manual fog of war) was Future or nice-to-have: ping under Q-016, fog and conditions under Phase 2 (`01` §4, §6). This is Q-099, answered: build all three after the MVP's features and before REL-03 (`01` §9).
- its DM view layout, "Go idle" and the idle screen's line differ from `08` §1, §2 and §4. This is Q-100, answered: the brief wins.

The brief cites a spec section "Μετά το MVP: ping, δείκτες, fog of war" that is not in the pack. Its summary of the three features is what was specified: the work packages of `13` §10 carry it into the domain, live-sync and security specifications as each is built.

The single input is written in Greek. It states product intent, scope and roadmap, and it also fixes the stack (Node single process, React with react-konva or PixiJS, Socket.io, SQLite, sharp), the deployment model (local server on the DM's PC, LAN-only clients) and the budget posture (free, self-hosted); statements restating any of these are `[input]`. Where the input offers an alternative ("react-konva or PixiJS"), the choice is left open and is recorded as a decision.

## What the inputs do not cover

The input is silent on: the host operating systems the server supports beyond the mention of the Windows firewall prompt; the browsers and TV/projector devices the player view must run on; the language of the user interface; how the DM PIN is set, changed and recovered, and whether the LAN traffic is plain HTTP; backup, retention and deletion of stored data beyond "backup = copy the folder"; the project's own licence and distribution, and any attribution the SRD 5.1 licence (CC-BY-4.0) requires once SRD content ships; accessibility; and performance targets. The maximum dimension of the display image variant is an open question the input itself names. The input is also internally inconsistent in one place: the asset-library section describes campaign export/import as a capability, while the roadmap lists it under Phase 2. Each of these that touches a surface is raised as a card in `QUESTIONS.md`.
