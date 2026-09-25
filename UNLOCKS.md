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
