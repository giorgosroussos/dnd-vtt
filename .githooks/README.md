# Git hooks

Versioned here rather than in `.git/hooks/`, so they travel with the repository.
`make install-hooks` points git at this directory (`core.hooksPath`) and makes
the scripts executable. Run it once per clone.

| Hook | Runs | Purpose |
| --- | --- | --- |
| `pre-commit` | before a commit is created | `scripts/lock-guard.py --staged`; blocks the commit on any violation |
| `post-commit` | after a commit is created | consumes the single-use unlock token and re-locks the file |
| `pre-receive` | on the remote, before a push is accepted | the same guard over the pushed diff |

The hooks are transport. Every rule lives in `scripts/lock-guard.py`, so the
local check and the server check cannot drift apart.

## Why both

`git commit --no-verify` skips the local hook. That is by design in git and
nothing in a client-side hook can prevent it, so the local hook is fast feedback,
not enforcement. The enforcement is `pre-receive` on the remote: it runs where the
committer's flags do not reach, over the same guard.

What the remote enforces is that no locked path changes without a recorded reason
for exactly that path in the same push, that no append-only file loses a line,
and that no tier is lowered. It does not verify who wrote the reason: the record
in `UNLOCKS.md` is a line of text anyone who can push can write. The ceremony is
an audit trail, not an approval gate; approval is what the owner reads afterwards.

Both hooks judge a change with the manifest **before** it: the local hook reads
`HEAD:.doc-locks`, the remote reads the revision being replaced. The manifest
after the change is compared to it, and any path whose tier would go down is
refused (the guard's demotion rule), so a push cannot relax a lock for itself,
nor for a later push. The guard, this directory and the manifest are themselves
hard-locked; a change to any of them is a `make unlock`.

Install it by copying `pre-receive` into the remote repository's `hooks/`
directory and making it executable. A repository with no such remote has fast
feedback and no enforcement; say so rather than assuming the locks hold.
