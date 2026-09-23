#!/usr/bin/env python3
"""
lock-guard: mechanical enforcement of the documentation lock manifest.

`check-docs.py` inspects the current state of the files. Two invariants of this
repository are not properties of a state but of a change:

  * a hard-locked file must not change at all, and
  * an append-only file must never lose a line.

Neither can be seen in a snapshot, so they are read from a unified diff, which
is what this script does. It is policy only: the hooks in `.githooks/` are
transport and contain no rules.

Usage, from the repository root:

    python3 scripts/lock-guard.py --staged          # what .githooks/pre-commit runs
    git diff OLD NEW | python3 scripts/lock-guard.py --manifest OLD.doc-locks --new-manifest NEW.doc-locks
    python3 scripts/lock-guard.py --tier specs/README.md
    python3 scripts/lock-guard.py --relock          # remove the write bits of every hard-locked file

Manifest (`.doc-locks`), one rule per line, `tier: glob`:

    hard-locked: docs/inputs/**
    append-only: DECISIONS.md
    free: PLAN.md

The last matching rule wins, so promoting a file is a line appended at the end
and the manifest is its own history. A path matching no rule is `free`.

Rules
  hard-locked   any change to the path is a violation (content, mode, rename,
                deletion) unless the change is authorized for exactly that path.
                Creating a path that did not exist is allowed: nothing is locked
                yet, and the file is immutable from that commit onward
  append-only   any removed line is a violation; this one rule catches both
                deletions and modifications, since a modified line appears as a
                removal plus an addition. Additions are always allowed, anywhere
                in the file
  free          never a violation
  demotion      the manifest itself may only ever tighten. When the diff changes
                the manifest, every glob of the old and the new manifest (and
                every path in the diff) is probed against both; a path whose tier
                goes down (hard-locked -> append-only -> free) is a violation,
                whatever else the diff carries. Promotions are free. The rule needs
                both manifests: `--staged` reads them from HEAD and the index, the
                pre-receive hook passes `--new-manifest`; a manifest change with
                no new manifest to compare fails closed

The manifest that judges a change is the one BEFORE the change (HEAD, or the
revision being replaced), never the one the change proposes; otherwise a commit
could relax a lock and use the relaxation in the same breath.

A hard-locked path is authorized by evidence from either of two places, both
written by `make unlock`:

  * the single-use token `.doc-unlock` (untracked, consumed by the next commit),
    which is what the local pre-commit hook sees, and
  * an unlock record added to `UNLOCKS.md` in the same diff, which is what lets
    a server-side hook accept a push whose token it never saw.

Either is evidence that a reason was recorded for exactly that path, not proof of
who approved it: the record is a line of text that whoever can push can write.
The guard makes locked changes impossible to make silently; it does not
authenticate them. That is the threat model of the whole layer (an agent
drifting, not a committer forging), and the honest limit of it.

Exit status: 0 clean, 1 on any violation, 2 on a usage or manifest error.
"""

import argparse
import os
import re
import subprocess
import sys

TIERS = ("hard-locked", "append-only", "free")
TIER_RANK = {"free": 0, "append-only": 1, "hard-locked": 2}
DEFAULT_MANIFEST = ".doc-locks"
DEFAULT_TOKEN = ".doc-unlock"
DEFAULT_LOG = "UNLOCKS.md"
NO_NEWLINE = r"\ No newline at end of file"
UNLOCK_RE = re.compile(r'^\s*-\s+unlock\s+\S+\s+path=(?:"([^"]*)"|(\S+))')
HEADER_RE = re.compile(r'^diff --git "?a/(.*?)"? "?b/(.*?)"?$')
BINARY_RE = re.compile(r'^Binary files (.*?) and (.*?) differ$')


class ManifestError(Exception):
    pass


# --- glob matching -----------------------------------------------------------

def translate(pattern):
    """Glob to regex. `*` and `?` do not cross `/`; `**` does."""
    out, i, n = ["^"], 0, len(pattern)
    while i < n:
        c = pattern[i]
        if c == "*":
            if pattern[i:i + 3] == "**/":
                out.append("(?:.*/)?")
                i += 3
                continue
            if pattern[i:i + 2] == "**":
                out.append(".*")
                i += 2
                continue
            out.append("[^/]*")
        elif c == "?":
            out.append("[^/]")
        else:
            out.append(re.escape(c))
        i += 1
    out.append("$")
    return re.compile("".join(out))


def load_manifest(text):
    """Parse manifest text into an ordered list of (tier, regex, glob)."""
    rules = []
    for lineno, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            raise ManifestError("line %d: expected `tier: glob`, got %r" % (lineno, raw))
        tier, pattern = line.split(":", 1)
        tier, pattern = tier.strip(), pattern.strip()
        if tier == "version":
            continue
        if tier not in TIERS:
            raise ManifestError("line %d: unknown tier %r, expected one of %s"
                                % (lineno, tier, ", ".join(TIERS)))
        if not pattern:
            raise ManifestError("line %d: rule has no glob" % lineno)
        rules.append((tier, translate(pattern), pattern))
    return rules


def tier_of(path, rules):
    """Last matching rule wins; unmatched paths are free."""
    tier, glob = "free", None
    for t, rx, g in rules:
        if rx.match(path):
            tier, glob = t, g
    return tier, glob


# --- diff parsing ------------------------------------------------------------

def unquote(path):
    """Undo git's C-style quoting of unusual path names."""
    if len(path) < 2 or path[0] != '"' or path[-1] != '"':
        return path
    s, out, i = path[1:-1], bytearray(), 0
    simple = {"n": 10, "t": 9, "r": 13, '"': 34, "\\": 92}
    while i < len(s):
        c = s[i]
        if c == "\\" and i + 1 < len(s):
            nxt = s[i + 1]
            if nxt in simple:
                out.append(simple[nxt])
                i += 2
                continue
            if nxt.isdigit() and i + 3 < len(s) + 1:
                try:
                    out.append(int(s[i + 1:i + 4], 8))
                    i += 4
                    continue
                except ValueError:
                    pass
        out.extend(c.encode("utf-8"))
        i += 1
    return out.decode("utf-8", "replace")


def side_path(rest):
    """Path from a `--- a/x` or `+++ b/x` line; None for /dev/null."""
    rest = rest.strip()
    if rest == "/dev/null":
        return None
    rest = unquote(rest)
    if rest.startswith(("a/", "b/")):
        rest = rest[2:]
    return rest


def new_entry(path):
    return {"path": path, "binary": False, "removed": [], "added": [],
            "new_file": False, "deleted": False, "mode_change": False}


def parse_diff(text):
    """Unified diff -> {path: entry}. Works on any diff passed as a string."""
    files, cur, in_hunk = {}, None, False
    minus = None

    def entry(path):
        if path not in files:
            files[path] = new_entry(path)
        return files[path]

    def rename(old, new):
        if old in files and old != new:
            files[new] = files.pop(old)
            files[new]["path"] = new
        return entry(new)

    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]

        if line.startswith("diff --git "):
            m = HEADER_RE.match(line)
            path = unquote(m.group(2)) if m else "?"
            cur, in_hunk, minus = entry(path), False, None
            i += 1
            continue

        if cur is not None and not in_hunk:
            if line.startswith("--- "):
                minus = side_path(line[4:])
                if minus is None:
                    cur["new_file"] = True
                i += 1
                continue
            if line.startswith("+++ "):
                plus = side_path(line[4:])
                if plus is None:
                    cur["deleted"] = True
                target = plus or minus or cur["path"]
                cur = rename(cur["path"], target)
                if minus is None:
                    cur["new_file"] = True
                if plus is None:
                    cur["deleted"] = True
                i += 1
                continue
            if line.startswith(("old mode ", "new mode ")):
                cur["mode_change"] = True
                i += 1
                continue
            # A binary addition carries no `--- /dev/null` line: git prints one
            # `Binary files ... differ` line and nothing else. The extended
            # header is the one announcement every diff makes, text or binary,
            # so it is what `new_file` and `deleted` are read from. Without this
            # a pack whose raw inputs hold a mockup or an archive cannot make its
            # own first commit: the addition reads as a modification of a
            # hard-locked path.
            if line.startswith("new file mode "):
                cur["new_file"] = True
                i += 1
                continue
            if line.startswith("deleted file mode "):
                cur["deleted"] = True
                i += 1
                continue
            if line.startswith("rename from "):
                entry(unquote(line[len("rename from "):]))["deleted"] = True
                i += 1
                continue
            if line.startswith("rename to "):
                cur = rename(cur["path"], unquote(line[len("rename to "):]))
                i += 1
                continue
            if line.startswith("Binary files ") or line.startswith("GIT binary patch"):
                cur["binary"] = True
                m = BINARY_RE.match(line)
                if m:
                    if side_path(m.group(1)) is None:
                        cur["new_file"] = True
                    if side_path(m.group(2)) is None:
                        cur["deleted"] = True
                i += 1
                continue

        if line.startswith("@@"):
            in_hunk = True
            i += 1
            continue

        if in_hunk and cur is not None:
            if line.startswith("-"):
                # A trailing-newline fix shows the last line removed and added
                # back with the no-newline marker beside it. That is not a loss.
                window = lines[i + 1:i + 3]
                if any(w == NO_NEWLINE for w in window) and ("+" + line[1:]) in window:
                    i += 1
                    continue
                cur["removed"].append((i + 1, line[1:]))
            elif line.startswith("+"):
                cur["added"].append(line[1:])
            elif line and line[0] not in " \\":
                in_hunk = False
                continue
        i += 1

    return files


# --- policy ------------------------------------------------------------------

def authorized_from_diff(files, log_path):
    """Paths an unlock record in this very diff authorizes."""
    out = set()
    log = files.get(log_path)
    if log:
        for added in log["added"]:
            m = UNLOCK_RE.match(added)
            if m:
                out.add(m.group(1) or m.group(2))
    return out


def read_token(text):
    """Paths a `.doc-unlock` token authorizes."""
    out = set()
    for line in text.splitlines():
        if line.strip().startswith("path:"):
            value = line.split(":", 1)[1].strip()
            if value:
                out.add(value)
    return out


def probe_path(glob):
    """A concrete path that the glob matches, to compare its tier under two manifests."""
    return glob.replace("**/", "a/").replace("**", "a/b").replace("*", "a").replace("?", "a")


def demotions(old_rules, new_rules, extra_paths=()):
    """Every (old glob, old tier, new tier, new glob) where a path's tier goes down.

    Probing the globs of both manifests catches the same glob re-declared lower,
    a broader glob added over a locked one, and a narrower glob carved out of
    one; the paths of the diff are probed as well, so a demotion aimed at exactly
    the file being changed cannot slip between the globs.
    """
    probes = set(probe_path(g) for _, _, g in old_rules) | set(probe_path(g) for _, _, g in new_rules)
    probes |= set(extra_paths)
    seen, out = set(), []
    for path in sorted(probes):
        before, old_glob = tier_of(path, old_rules)
        after, new_glob = tier_of(path, new_rules)
        if TIER_RANK[after] < TIER_RANK[before]:
            key = (old_glob or path, before, after, new_glob)
            if key not in seen:
                seen.add(key)
                out.append(key)
    return out


def check(diff_text, rules, token_paths=(), log_path=DEFAULT_LOG,
          manifest_path=DEFAULT_MANIFEST, new_rules=None):
    """Pure function: (diff, manifest, token, new manifest) -> list of violations.

    `rules` is the manifest before the change and judges every path. `new_rules`
    is the manifest after it, needed only when the diff touches `manifest_path`.
    Each violation is (rule, path, detail).
    """
    files = parse_diff(diff_text)
    authorized = set(token_paths) | authorized_from_diff(files, log_path)
    violations = []

    if manifest_path in files:
        if new_rules is None:
            violations.append((
                "demotion", manifest_path,
                "the manifest changes in this diff but the new manifest was not supplied, so its "
                "tiers cannot be compared; pass --new-manifest (or use --staged)"))
        else:
            for old_glob, before, after, new_glob in demotions(rules, new_rules, files):
                violations.append((
                    "demotion", manifest_path,
                    "`%s` would go from %s to %s (rule `%s: %s`); tiers are promoted, never demoted"
                    % (old_glob, before, after, after, new_glob)))

    for path in sorted(files):
        info = files[path]
        tier, glob = tier_of(path, rules)

        if tier == "hard-locked":
            if path in authorized:
                continue
            if info["new_file"] and not info["deleted"]:
                # Nothing is locked yet in a path that did not exist. The file
                # becomes immutable from the commit that introduces it, which is
                # also what lets the pack's own first commit through.
                continue
            what = ("deleted" if info["deleted"] else
                    "mode changed" if info["mode_change"] and not info["removed"] and not info["added"] else
                    "modified")
            violations.append((
                "hard-locked", path,
                "%s, but `%s` is hard-locked. Run `make unlock PATH=%s REASON=\"...\"` first."
                % (what, glob, path)))
            continue

        if tier == "append-only":
            if info["binary"]:
                violations.append((
                    "append-only", path,
                    "binary change to an append-only path; its lines cannot be verified"))
                continue
            for lineno, text in info["removed"]:
                violations.append((
                    "append-only", path,
                    "removes a line (%s is append-only; edit and delete both show up here, "
                    "append instead): %s" % (glob, text.strip()[:80] or "(blank line)")))

    return violations


def relock(root, rules):
    """Remove the write bits of every existing file the manifest calls hard-locked;
    returns the count.

    Only the write bits: the hooks are hard-locked too and must stay executable,
    or git would skip them silently. Git records only the exec bit, so the mode is
    local to a clone and has to be re-applied after cloning or after a promotion;
    the hooks, not the modes, are the enforcement. Directories are left writable
    so new files can still be added deliberately.
    """
    count = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != ".git"]
        for name in filenames:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            if tier_of(rel, rules)[0] == "hard-locked":
                os.chmod(full, os.stat(full).st_mode & ~0o222)
                count += 1
    return count


# --- transport ---------------------------------------------------------------

def staged_diff(root):
    cmd = ["git", "diff", "--cached", "--no-color", "--no-renames", "--unified=0"]
    proc = subprocess.run(cmd, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr.decode("utf-8", "replace"))
        sys.exit(2)
    return proc.stdout.decode("utf-8", "replace")


def git_show(root, spec):
    """Contents of `<rev>:<path>` (or `:<path>` for the index), or None if absent."""
    proc = subprocess.run(["git", "show", spec], cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        return None
    return proc.stdout.decode("utf-8", "replace")


def parse_manifest_text(text, label):
    try:
        return load_manifest(text)
    except ManifestError as exc:
        sys.stderr.write("lock-guard: %s: %s\n" % (label, exc))
        sys.exit(2)


def main():
    ap = argparse.ArgumentParser(description="Enforce the documentation lock manifest over a diff.")
    ap.add_argument("--root", default=".", help="repository root (default: current directory)")
    ap.add_argument("--staged", action="store_true", help="check the staged change instead of stdin")
    ap.add_argument("--manifest", default=None,
                    help="the manifest BEFORE the change, which judges it (default with --staged: "
                         "HEAD's %s; otherwise <root>/%s)" % (DEFAULT_MANIFEST, DEFAULT_MANIFEST))
    ap.add_argument("--new-manifest", default=None,
                    help="the manifest AFTER the change, compared for demotions when the diff "
                         "touches it (default with --staged: the index's copy)")
    ap.add_argument("--token", default=None, help="unlock token file (default: <root>/%s)" % DEFAULT_TOKEN)
    ap.add_argument("--no-token", action="store_true",
                    help="ignore any local token; a server-side hook never sees one")
    ap.add_argument("--log", default=DEFAULT_LOG, help="unlock log path inside the repository")
    ap.add_argument("--tier", metavar="PATH", help="print the tier of one path and exit")
    ap.add_argument("--relock", action="store_true",
                    help="remove the write bits of every existing hard-locked file and exit; "
                         "`make install-hooks` runs this, so a clone gets the mode bits back")
    ap.add_argument("--quiet", action="store_true", help="print only violations")
    args = ap.parse_args()

    root = os.path.abspath(args.root)
    worktree_manifest = os.path.join(root, DEFAULT_MANIFEST)

    # The judging manifest. With --staged it is HEAD's copy: the working tree's
    # may be the very change under judgement. Before the first commit, or when
    # HEAD has no manifest yet, the staged copy is all there is.
    manifest_text, manifest_label = None, None
    if args.manifest:
        manifest_label = args.manifest
        if not os.path.isfile(args.manifest):
            sys.stderr.write("lock-guard: no manifest at %s\n" % args.manifest)
            return 2
        with open(args.manifest, encoding="utf-8") as fh:
            manifest_text = fh.read()
    elif args.staged:
        manifest_text = git_show(root, "HEAD:%s" % DEFAULT_MANIFEST)
        manifest_label = "HEAD:%s" % DEFAULT_MANIFEST
        if manifest_text is None:
            manifest_text = git_show(root, ":%s" % DEFAULT_MANIFEST)
            manifest_label = "staged %s" % DEFAULT_MANIFEST
    if manifest_text is None:
        manifest_label = worktree_manifest
        if not os.path.isfile(worktree_manifest):
            sys.stderr.write("lock-guard: no manifest at %s\n" % worktree_manifest)
            return 2
        with open(worktree_manifest, encoding="utf-8") as fh:
            manifest_text = fh.read()
    rules = parse_manifest_text(manifest_text, manifest_label)

    # The proposed manifest, for the demotion rule.
    new_rules = None
    if args.new_manifest:
        if not os.path.isfile(args.new_manifest):
            sys.stderr.write("lock-guard: no manifest at %s\n" % args.new_manifest)
            return 2
        with open(args.new_manifest, encoding="utf-8") as fh:
            new_rules = parse_manifest_text(fh.read(), args.new_manifest)
    elif args.staged:
        staged_text = git_show(root, ":%s" % DEFAULT_MANIFEST)
        if staged_text is not None:
            new_rules = parse_manifest_text(staged_text, "staged %s" % DEFAULT_MANIFEST)

    if args.tier:
        probe = args.tier[2:] if args.tier.startswith("./") else args.tier
        tier, glob = tier_of(probe, rules)
        print("%s\t%s" % (tier, glob or "(no rule; free by default)"))
        return 0

    if args.relock:
        n = relock(root, rules)
        if not args.quiet:
            print("lock-guard: %d hard-locked file(s) set read-only" % n)
        return 0

    diff_text = staged_diff(root) if args.staged else sys.stdin.read()

    token_path = args.token or os.path.join(root, DEFAULT_TOKEN)
    token_paths = set()
    if not args.no_token and os.path.isfile(token_path):
        with open(token_path, encoding="utf-8") as fh:
            token_paths = read_token(fh.read())

    violations = check(diff_text, rules, token_paths, args.log, DEFAULT_MANIFEST, new_rules)

    for rule, path, detail in violations:
        print("LOCK %-12s %s: %s" % (rule, path, detail))
    if violations:
        print()
        print("lock-guard: %d violation(s). Nothing was committed." % len(violations))
        return 1
    if not args.quiet:
        if args.staged and git_show(root, "HEAD:%s" % DEFAULT_MANIFEST) is None and manifest_label.startswith("staged"):
            print("lock-guard: no HEAD yet; every staged path is new and nothing is locked before the first commit")
        print("lock-guard: clean (%d rule(s) in %s)" % (len(rules), manifest_label))
    return 0


if __name__ == "__main__":
    sys.exit(main())
