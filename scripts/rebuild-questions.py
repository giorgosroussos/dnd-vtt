#!/usr/bin/env python3
"""
rebuild-questions: render QUESTIONS.md from the questions stream of the event log.

The rendering is a pure function of the log: same log, same bytes, every time.
Cards appear in the order they were opened, inside the section their state puts
them in, and a card never moves by being edited: `card-deferred`,
`card-reactivated` and `card-resolved` are events, so the movement between
Blocking, Open and Resolved is history rather than a diff nobody can audit.

    python3 scripts/rebuild-questions.py            # write QUESTIONS.md
    python3 scripts/rebuild-questions.py --check    # exit 1 if the file has drifted
    python3 scripts/rebuild-questions.py --stdout   # print, write nothing

Exit status: 0 written or fresh, 1 drifted (with --check), 3 the chain does not
verify or the stream cannot be projected.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import eventlog  # noqa: E402

if __name__ == "__main__":
    sys.exit(eventlog.rebuild_command(
        "Rebuild QUESTIONS.md from the event log.",
        "QUESTIONS.md",
        eventlog.render_questions))
