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
