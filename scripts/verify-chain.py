#!/usr/bin/env python3
"""
verify-chain: walk the event log and prove it has not been rewritten.

Recomputes every record's hash over its canonical form, checks that every `prev`
links to the record before it, and that `seq` runs contiguously from 1. Stops at
the first break and names the line, because everything after a break is
unverifiable anyway.

    python3 scripts/verify-chain.py [--root DIR] [--quiet]

Exit status: 0 intact, 1 broken. What the chain does and does not guarantee is
documented at the top of `eventlog.py`.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import eventlog  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description="Verify the event log's hash chain.")
    ap.add_argument("--root", default=".", help="repository root (default: current directory)")
    ap.add_argument("--quiet", action="store_true", help="print only a break")
    args = ap.parse_args()

    root = os.path.abspath(args.root)
    path = eventlog.log_path(root)
    if not os.path.isfile(path):
        sys.stderr.write("verify-chain: no log at %s\n" % path)
        return 1

    lines = eventlog.read_lines(root)
    broken = eventlog.verify(lines)
    if broken:
        lineno, message = broken
        print("CHAIN %s line %d: %s" % (os.path.relpath(path, root), lineno, message))
        print()
        print("verify-chain: broken at record %d of %d." % (lineno, len(lines)))
        return 1
    if not args.quiet:
        print("verify-chain: intact, %d record(s)." % len(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
