#!/bin/sh
# unlock: the ceremony that makes a change to a hard-locked file possible,
# deliberate and self-documenting. Run through `make unlock PATH=<path> REASON="..."`.
#
# It refuses any path the manifest does not call hard-locked, appends a record to
# the append-only unlock log and stages it so the change and its reason travel in
# one commit, makes the file writable, and writes a single-use token that
# scripts/lock-guard.py accepts for exactly that path. The next commit consumes
# it: .githooks/post-commit re-locks the file and deletes the token, so one
# ceremony covers one deliberate change and no more.
set -eu

target="${1:-}"
reason="${2:-}"
log="${UNLOCK_LOG:-UNLOCKS.md}"
token="${UNLOCK_TOKEN:-.doc-unlock}"

usage() {
    echo 'usage: make unlock PATH=<path> REASON="why this change is necessary"' >&2
    exit 2
}

[ -n "$target" ] || usage
[ -n "$reason" ] || usage
[ -e "$target" ] || { echo "unlock: no such file: $target" >&2; exit 2; }
case "$reason" in *'"'*) echo 'unlock: REASON must not contain a double quote.' >&2; exit 2 ;; esac

tier="$(python3 scripts/lock-guard.py --tier "$target" | cut -f1)"
if [ "$tier" != "hard-locked" ]; then
    echo "unlock: $target is '$tier', not hard-locked. No ceremony is needed." >&2
    exit 2
fi

who="$(git config user.name 2>/dev/null || true)"
[ -n "$who" ] || who="$(id -un)"
when="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

[ -f "$log" ] || printf '# UNLOCKS\n\nOne line per ceremonial unlock of a hard-locked path.\n\n' > "$log"
printf -- '- unlock %s path="%s" by="%s" reason="%s"\n' "$when" "$target" "$who" "$reason" >> "$log"
git add -- "$log"

chmod u+w -- "$target"
# Appended, not overwritten: one commit may carry several ceremonies (a spec, the
# plan and the playbook in one migration), the guard authorizes each from its
# record in UNLOCKS.md, and the token has to name every one of them or the commit
# that follows re-locks only the last. Both readers take every `path:` line.
{
    echo "path: $target"
    echo "by: $who"
    echo "date: $when"
    echo "reason: $reason"
} >> "$token"

echo "unlock: $target is writable for one commit."
echo "unlock: recorded in $log; the next commit consumes the token."
