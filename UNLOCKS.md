# UNLOCKS

One line per ceremonial unlock of a hard-locked path, appended by `make unlock`.

A hard-locked file cannot be changed by an ordinary commit. `make unlock PATH=<path> REASON="..."` records the intent here, makes the file writable and lets exactly that path change in exactly one commit. The record and the change it permits travel in the same commit, which is what lets the remote accept a push it did not witness locally: the guard reads the lines added to this file. This file is an audit trail, not an approval gate: it proves that every change to a locked file came with a who, a when and a why, not that anyone but the committer agreed to it.

Format, machine-read by `scripts/lock-guard.py`:

```
- unlock <ISO-8601 UTC> path="<path>" by="<name>" reason="<why>"
```

Never edit or remove a line here. The point of the file is that it cannot be tidied.

## Records
- unlock 2026-09-23T14:50:45Z path=".doc-locks" by="Giorgos Roussos" reason="freeze 1.0: promote specs/** to hard-locked"
- unlock 2026-09-24T12:42:27Z path="specs/08-ux-journeys.md" by="Giorgos Roussos" reason="Q-090 answered A: campaigns are listed by name, not reorderable; 08 §1 amended to sessions and scenes (D-079)"
- unlock 2026-09-25T10:35:30Z path="specs/03-domain-model.md" by="Giorgos Roussos" reason="Q-091 answered by the owner: Scene gains token_numbers, the highest token number issued per asset, so freed numbers are never reused (PRP-04)"
- unlock 2026-09-25T10:35:30Z path="specs/05-assets-and-images.md" by="Giorgos Roussos" reason="Q-091 answered by the owner: only the first token of an asset placed on a scene takes the bare name; numbers issued are stored (PRP-04)"
- unlock 2026-09-25T11:03:57Z path="specs/13-implementation-plan.md" by="Giorgos Roussos" reason="PRP-04 Surfaces gains data, derived by check-docs from 05 §3 now tagged Q-091 (D-098)"
- unlock 2026-09-25T11:27:46Z path="specs/05-assets-and-images.md" by="Giorgos Roussos" reason="Q-092 answered B by the owner: a hidden token is numbered only when first shown to players (PRP-04)"
- unlock 2026-09-25T14:51:33Z path="specs/04-live-sync.md" by="Giorgos Roussos" reason="Q-093 answered A by the owner: one event version counter per room, so players never see a version they did not receive (04 §5)"
- unlock 2026-09-28T19:12:51Z path="specs/07-security-and-access.md" by="Giorgos Roussos" reason="Q-097 answered C by the owner: a server-wide PIN failure budget beside the per-address one, IPv6 keyed by /64 (REL-01, closes G-010)"
- unlock 2026-09-29T08:07:19Z path="specs/07-security-and-access.md" by="Giorgos Roussos" reason="Q-098 answered A by the owner: a second, 24-hour PIN failure budget beside the 10-minute one (REL-01 review S-M1)"
- unlock 2026-09-29T18:10:50Z path="specs/03-domain-model.md" by="Giorgos Roussos" reason="Q-096 answered B by the owner: Token gains shown, whether players have seen it, so a token hidden and revealed again keeps its bare name (05 §3)"
- unlock 2026-09-29T18:10:50Z path="specs/05-assets-and-images.md" by="Giorgos Roussos" reason="Q-096 answered B by the owner: whether a token has been shown to players is stored with it, and numbering happens only at the first showing"
- unlock 2026-09-30T12:49:14Z path="docs/inputs/requirements/2026-09-30-ui-redesign-brief.md" by="Giorgos Roussos" reason="The owner's UI redesign brief, received 2026-09-30, added verbatim as an authoritative input (Q-099, Q-100)"
- unlock 2026-09-30T12:49:14Z path="docs/inputs/Design.html" by="Giorgos Roussos" reason="The owner's design bundle, received 2026-09-30, added verbatim as a non-authoritative input: look and layout only"
- unlock 2026-09-30T12:49:14Z path="docs/inputs/README.md" by="Giorgos Roussos" reason="Authority entries for the 2026-09-30 brief and design bundle, and the conflicts they raise (Q-099, Q-100)"
- unlock 2026-09-30T12:49:51Z path="specs/01-product-scope.md" by="Giorgos Roussos" reason="Q-099 and Q-100 answered by the owner 2026-09-30: ping, condition markers and manual fog regions after the MVP, and the redesigned DM view and TV, before REL-03 (D-139)"
- unlock 2026-09-30T12:49:51Z path="specs/08-ux-journeys.md" by="Giorgos Roussos" reason="Q-099 and Q-100 answered by the owner 2026-09-30: ping, condition markers and manual fog regions after the MVP, and the redesigned DM view and TV, before REL-03 (D-139)"
- unlock 2026-09-30T12:49:52Z path="specs/11-traceability.md" by="Giorgos Roussos" reason="Q-099 and Q-100 answered by the owner 2026-09-30: ping, condition markers and manual fog regions after the MVP, and the redesigned DM view and TV, before REL-03 (D-139)"
- unlock 2026-09-30T12:49:52Z path="specs/12-decision-register.md" by="Giorgos Roussos" reason="Q-099 and Q-100 answered by the owner 2026-09-30: ping, condition markers and manual fog regions after the MVP, and the redesigned DM view and TV, before REL-03 (D-139)"
- unlock 2026-09-30T12:49:52Z path="specs/13-implementation-plan.md" by="Giorgos Roussos" reason="Q-099 and Q-100 answered by the owner 2026-09-30: ping, condition markers and manual fog regions after the MVP, and the redesigned DM view and TV, before REL-03 (D-139)"
- unlock 2026-09-30T12:49:52Z path="specs/14-agent-playbook.md" by="Giorgos Roussos" reason="Q-099 and Q-100 answered by the owner 2026-09-30: ping, condition markers and manual fog regions after the MVP, and the redesigned DM view and TV, before REL-03 (D-139)"
- unlock 2026-09-30T13:03:51Z path="specs/04-live-sync.md" by="Giorgos Roussos" reason="UIX-01: redo, the DM room's screens count and undo state, and the scene's name and token category for players (Q-100, brief [input], D-139)"
- unlock 2026-09-30T14:22:22Z path="specs/02-architecture.md" by="Giorgos Roussos" reason="UIX-01: the count of connected player views and the scenes' token summary over REST, for the redesigned header and scene list (Q-100, D-140)"
- unlock 2026-09-30T15:01:35Z path="specs/04-live-sync.md" by="Giorgos Roussos" reason="TBL-01: the ping command and event, stored nowhere, both rooms (Q-099, D-139)"
- unlock 2026-09-30T17:01:33Z path="specs/03-domain-model.md" by="Giorgos Roussos" reason="TBL-02: condition markers stored on the token, set by the undoable live command token.setMarkers and drawn on both views (Q-099, D-139)"
- unlock 2026-09-30T17:01:33Z path="specs/04-live-sync.md" by="Giorgos Roussos" reason="TBL-02: condition markers stored on the token, set by the undoable live command token.setMarkers and drawn on both views (Q-099, D-139)"
- unlock 2026-09-30T17:43:36Z path="specs/03-domain-model.md" by="Giorgos Roussos" reason="TBL-03: manual fog regions, the players' visibility rule (not hidden and not under a fogged region) in snapshots, events, numbering and image files, and the hidden-information suite extended (Q-099, D-139)"
- unlock 2026-09-30T17:43:36Z path="specs/04-live-sync.md" by="Giorgos Roussos" reason="TBL-03: manual fog regions, the players' visibility rule (not hidden and not under a fogged region) in snapshots, events, numbering and image files, and the hidden-information suite extended (Q-099, D-139)"
- unlock 2026-09-30T17:43:36Z path="specs/07-security-and-access.md" by="Giorgos Roussos" reason="TBL-03: manual fog regions, the players' visibility rule (not hidden and not under a fogged region) in snapshots, events, numbering and image files, and the hidden-information suite extended (Q-099, D-139)"
- unlock 2026-09-30T17:43:36Z path="specs/10-testing-acceptance.md" by="Giorgos Roussos" reason="TBL-03: manual fog regions, the players' visibility rule (not hidden and not under a fogged region) in snapshots, events, numbering and image files, and the hidden-information suite extended (Q-099, D-139)"
- unlock 2026-09-30T17:44:22Z path="specs/02-architecture.md" by="Giorgos Roussos" reason="TBL-03: fog regions of a scene over REST while it is not live (Q-099, D-139)"
- unlock 2026-09-30T18:28:08Z path="specs/08-ux-journeys.md" by="Giorgos Roussos" reason="TBL-01 to TBL-03: the ping tool, the condition chips and the fog tool and region list in the redesigned DM view (Q-099, D-139)"
- unlock 2026-10-01T09:58:42Z path="specs/01-product-scope.md" by="Giorgos Roussos" reason="Q-101 answered by the owner 2026-10-01: painted fog replaces fog regions (D-154)"
- unlock 2026-10-01T09:58:42Z path="specs/02-architecture.md" by="Giorgos Roussos" reason="Q-101 answered by the owner 2026-10-01: painted fog replaces fog regions (D-154)"
- unlock 2026-10-01T09:58:42Z path="specs/03-domain-model.md" by="Giorgos Roussos" reason="Q-101 answered by the owner 2026-10-01: painted fog replaces fog regions (D-154)"
- unlock 2026-10-01T09:58:42Z path="specs/04-live-sync.md" by="Giorgos Roussos" reason="Q-101 answered by the owner 2026-10-01: painted fog replaces fog regions (D-154)"
- unlock 2026-10-01T09:58:42Z path="specs/07-security-and-access.md" by="Giorgos Roussos" reason="Q-101 answered by the owner 2026-10-01: painted fog replaces fog regions (D-154)"
- unlock 2026-10-01T09:58:42Z path="specs/08-ux-journeys.md" by="Giorgos Roussos" reason="Q-101 answered by the owner 2026-10-01: painted fog replaces fog regions (D-154)"
- unlock 2026-10-01T09:58:42Z path="specs/10-testing-acceptance.md" by="Giorgos Roussos" reason="Q-101 answered by the owner 2026-10-01: painted fog replaces fog regions (D-154)"
- unlock 2026-10-01T09:58:42Z path="specs/11-traceability.md" by="Giorgos Roussos" reason="Q-101 answered by the owner 2026-10-01: painted fog replaces fog regions (D-154)"
- unlock 2026-10-01T09:58:42Z path="specs/13-implementation-plan.md" by="Giorgos Roussos" reason="Q-101 answered by the owner 2026-10-01: painted fog replaces fog regions (D-154)"
