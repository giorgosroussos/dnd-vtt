#!/usr/bin/env python3
"""
rebuild-decisions: render DECISIONS.md from the decisions stream of the event log.

The rendering is a pure function of the log: same log, same bytes, every time.
Nothing about the moment of rendering enters the output, entries come out in the
order their `decision-added` events appear, and a superseded record keeps its
text and gains a `Status: superseded by D-NNN` line rather than being collapsed.

    python3 scripts/rebuild-decisions.py            # write DECISIONS.md
    python3 scripts/rebuild-decisions.py --check    # exit 1 if the file has drifted
    python3 scripts/rebuild-decisions.py --stdout   # print, write nothing

Exit status: 0 written or fresh, 1 drifted (with --check), 3 the chain does not
verify or the stream cannot be projected. The comparison logic is shared with
the other projections in `eventlog.py`.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import eventlog  # noqa: E402

if __name__ == "__main__":
    sys.exit(eventlog.rebuild_command(
        "Rebuild DECISIONS.md from the event log.",
        "DECISIONS.md",
        eventlog.render_decisions))
