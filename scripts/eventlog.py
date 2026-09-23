"""Append-only, hash-chained event log, and the projections rendered from it.

The log at `.log/events.jsonl` is the source of truth for the streams that use
it. A markdown file built from it (today: `DECISIONS.md`) is a projection: it is
regenerated, never authored, and `check-docs` compares it byte for byte against
a fresh rebuild, so a hand edit cannot survive the gate.

One JSON object per line, keys in this order:

    seq      1-based, contiguous
    ts       ISO-8601 UTC, when the event was recorded
    actor    agent | owner
    stream   which stream the event belongs to (decisions, for now)
    type     event type within the stream
    payload  the event's data
    prev     sha256 of the previous record's canonical form, 64 zeros at seq 1
    hash     sha256 of this record's canonical form

CANONICAL FORM, the one rule everything else depends on: take the record
WITHOUT its `hash` field, serialize it as JSON with sorted keys and no
insignificant whitespace (separators `,` and `:`), UTF-8, then concatenate the
literal `prev` string and sha256 the result. The line as stored on disk may be
formatted any way at all: hashes are computed over the canonical form, never
over the bytes of the line, so verification does not depend on the file's
whitespace.

WHAT THE CHAIN GUARANTEES: any edit to a record that is already in the log is
detectable, because its own hash stops matching and so does every following
`prev`. WHAT IT DOES NOT: authorship. Anyone who can run this tooling can write
a well-formed new record, or rewrite the whole chain from a chosen point and
recompute it. The threat model is an agent editing history by accident and a
silent rewrite going unnoticed, not a motivated adversary. Signing would be a
different mechanism; this is not it.
"""

import hashlib
import json
import os
import re

LOG_DIR = ".log"
LOG_NAME = "events.jsonl"
GENESIS_PREV = "0" * 64
KEY_ORDER = ("seq", "ts", "actor", "stream", "type", "payload", "prev", "hash")
REQUIRED = KEY_ORDER
ACTORS = ("agent", "owner")

DECISIONS_STREAM = "decisions"
DECISION_EVENTS = ("decision-added", "decision-superseded", "adr-approval-changed")
DECISION_TYPES = ("implementation", "spec-amendment", "adr")
DECISION_FIELDS = ("decision", "why", "alternatives", "affected_specs")

QUESTIONS_STREAM = "questions"
CARD_EVENTS = ("card-opened", "card-answered", "card-resolved",
               "card-deferred", "card-reactivated", "card-superseded")
SURFACES = ("data", "security", "scope", "external", "ux")
BLOCKS_SPECIFICATION = "specification"

ID_RE = re.compile(r"^D-\d{3}$")
CARD_ID_RE = re.compile(r"^Q-\d{3}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
APPROVALS = ("pending", "granted", "rejected")
TRUTHY = ("1", "true", "yes", "y", "on")
FALSEY = ("0", "false", "no", "n", "off", "")


class LogError(Exception):
    """A malformed event, or a chain that does not verify."""


# --- the chain ---------------------------------------------------------------

def log_path(root):
    return os.path.join(root, LOG_DIR, LOG_NAME)


def canonical(record):
    body = dict((k, v) for k, v in record.items() if k != "hash")
    blob = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return (blob + body.get("prev", "")).encode("utf-8")


def record_hash(record):
    return hashlib.sha256(canonical(record)).hexdigest()


def ordered(record):
    """The record with its keys in the stored order; unknown keys keep a stable tail."""
    out = {}
    for key in KEY_ORDER:
        if key in record:
            out[key] = record[key]
    for key in sorted(k for k in record if k not in out):
        out[key] = record[key]
    return out


def dumps(record):
    """One line per record on disk. The three non-ASCII line separators that
    json.dumps leaves raw under ensure_ascii=False are escaped, so any reader
    that splits on lines still sees one record per line. The hash is computed
    over the parsed record, so this changes nothing about the chain."""
    line = json.dumps(ordered(record), sort_keys=False, separators=(",", ":"), ensure_ascii=False)
    return line.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029").replace("\u0085", "\\u0085")


def read_lines(root):
    path = log_path(root)
    if not os.path.isfile(path):
        return []
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    # Split on "\n" only. str.splitlines() also breaks on U+2028, U+2029,
    # U+0085 and U+000B, which a JSON string may legally contain; a record
    # read as two lines would break its own chain.
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    return lines


def verify(lines):
    """None when the chain is intact, else (line number, message) for the first break."""
    prev_hash = GENESIS_PREV
    expected_seq = 1
    for lineno, raw in enumerate(lines, 1):
        if not raw.strip():
            return (lineno, "blank line; every line must be exactly one record")
        try:
            record = json.loads(raw)
        except ValueError as exc:
            return (lineno, "not valid JSON: %s" % exc)
        if not isinstance(record, dict):
            return (lineno, "not a JSON object")
        for key in REQUIRED:
            if key not in record:
                return (lineno, "missing field %r" % key)
        if record["seq"] != expected_seq:
            return (lineno, "seq is %r, expected %d; the sequence must be contiguous from 1"
                            % (record["seq"], expected_seq))
        if record["prev"] != prev_hash:
            return (lineno, "prev is %s, expected %s; this record does not link to the previous one"
                            % (str(record["prev"])[:16], prev_hash[:16]))
        recomputed = record_hash(record)
        if recomputed != record["hash"]:
            return (lineno, "hash mismatch: the record carries %s, its content recomputes to %s; "
                            "this record was changed after it was written"
                            % (str(record["hash"])[:16], recomputed[:16]))
        prev_hash = record["hash"]
        expected_seq += 1
    return None


def load(root):
    """Every record, verified. Raises LogError on the first break."""
    lines = read_lines(root)
    broken = verify(lines)
    if broken:
        raise LogError("%s line %d: %s" % (log_path(root), broken[0], broken[1]))
    return [json.loads(line) for line in lines]


def head(records):
    """(seq, hash) to continue from, or (0, GENESIS_PREV) for an empty log."""
    if not records:
        return (0, GENESIS_PREV)
    return (records[-1]["seq"], records[-1]["hash"])


def check_appendable(records, record):
    """Raise LogError unless the projection can still render the log with this
    record in it.

    The log is append-only, so an event that no projection can fold is not a
    small mistake: it can never be taken back, and the projection stays
    unbuildable for good. The projections are the one authority on what folds,
    so they are what answers the question, rather than a second set of rules
    that could disagree with them.
    """
    projector = PROJECTORS.get(record.get("stream"))
    if projector is None:
        return
    projector(list(records) + [record])


def build(seq, ts, actor, stream, event_type, payload, prev):
    record = {"seq": seq, "ts": ts, "actor": actor, "stream": stream,
              "type": event_type, "payload": payload, "prev": prev}
    record["hash"] = record_hash(record)
    return ordered(record)


# --- event validation --------------------------------------------------------

def clean(value):
    """One line, no runs of whitespace: a projection renders a field on one line."""
    return " ".join(str(value).split())


def flag(value):
    """A boolean from JSON or from a command line."""
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in TRUTHY:
        return True
    if text in FALSEY:
        return False
    raise LogError("%r is not a yes or a no" % value)


def validate(stream, event_type, payload):
    """Raise LogError unless the event can be rendered by its projection."""
    if not isinstance(payload, dict):
        raise LogError("payload must be a JSON object")
    if stream == QUESTIONS_STREAM:
        return _validate_card(event_type, payload)
    if stream != DECISIONS_STREAM:
        return payload
    if event_type not in DECISION_EVENTS:
        raise LogError("unknown %s event %r; expected one of %s"
                       % (stream, event_type, ", ".join(DECISION_EVENTS)))

    def need(key):
        if key not in payload or payload[key] in (None, ""):
            raise LogError("%s needs %r in its payload" % (event_type, key))
        return payload[key]

    if event_type == "decision-added":
        out = {"id": need("id"), "date": need("date"), "title": clean(need("title")),
               "type": need("type")}
        if not ID_RE.match(out["id"]):
            raise LogError("id %r is not D-NNN" % out["id"])
        if not DATE_RE.match(out["date"]):
            raise LogError("date %r is not YYYY-MM-DD" % out["date"])
        if out["type"] not in DECISION_TYPES:
            raise LogError("type %r not in %s" % (out["type"], ", ".join(DECISION_TYPES)))
        for field in DECISION_FIELDS:
            out[field] = clean(need(field))
        if out["type"] == "adr":
            out["approval"] = clean(need("approval"))
            _check_approval(out["approval"], payload.get("approval_date"))
            if payload.get("approval_date"):
                out["approval_date"] = clean(payload["approval_date"])
        return out

    if event_type == "decision-superseded":
        out = {"id": need("id"), "by": need("by")}
        for key in ("id", "by"):
            if not ID_RE.match(out[key]):
                raise LogError("%s %r is not D-NNN" % (key, out[key]))
        if out["id"] == out["by"]:
            raise LogError("a record cannot supersede itself")
        return out

    out = {"id": need("id"), "approval": clean(need("approval"))}
    if not ID_RE.match(out["id"]):
        raise LogError("id %r is not D-NNN" % out["id"])
    _check_approval(out["approval"], payload.get("approval_date") or payload.get("date"))
    date = payload.get("approval_date") or payload.get("date")
    if date:
        out["approval_date"] = clean(date)
    return out


def _check_approval(state, date):
    if state not in APPROVALS:
        raise LogError("approval %r not in %s" % (state, ", ".join(APPROVALS)))
    if state == "granted":
        if not date or not DATE_RE.match(clean(date)):
            raise LogError("approval 'granted' needs a YYYY-MM-DD date")
    elif date:
        raise LogError("approval %r takes no date" % state)


def _validate_card(event_type, payload):
    if event_type not in CARD_EVENTS:
        raise LogError("unknown %s event %r; expected one of %s"
                       % (QUESTIONS_STREAM, event_type, ", ".join(CARD_EVENTS)))

    def need(key):
        if key not in payload or payload[key] in (None, "", []):
            raise LogError("%s needs %r in its payload" % (event_type, key))
        return payload[key]

    def card_id(key):
        value = clean(need(key))
        if not CARD_ID_RE.match(value):
            raise LogError("%s %r is not Q-NNN" % (key, value))
        return value

    if event_type == "card-opened":
        out = {"id": card_id("id"), "title": clean(need("title")),
               "surface": clean(need("surface")), "source": clean(need("source")),
               "question": clean(need("question")), "blocks": clean(need("blocks"))}
        if out["surface"] not in SURFACES:
            raise LogError("surface %r is not one of %s" % (out["surface"], ", ".join(SURFACES)))
        if out["blocks"] != BLOCKS_SPECIFICATION:
            raise LogError("a card opens with blocks %r, always: it is Blocking until the owner answers "
                           "or defers it, and deferral is a card-deferred event carrying the phase or "
                           "package (got %r)" % (BLOCKS_SPECIFICATION, out["blocks"]))
        options = need("options")
        if isinstance(options, str):
            options = [line for line in options.splitlines() if line.strip()]
        if not isinstance(options, list) or len(options) < 2:
            raise LogError("a card needs at least two options")
        out["options"] = [clean(o) for o in options]
        for option in out["options"]:
            if "\u2192" not in option and "->" not in option:
                raise LogError("option %r states no consequence; every option carries "
                               "`\u2192 effect on <surface>: ...`" % option[:40])
        # A recommendation is optional in the log, because the log records what
        # happened. It is not optional in the method: `check-docs` fails an open
        # card that has none.
        if payload.get("recommendation"):
            out["recommendation"] = clean(payload["recommendation"])
        return out

    if event_type == "card-answered":
        out = {"id": card_id("id"), "answer": clean(need("answer")), "date": clean(need("date"))}
        if not DATE_RE.match(out["date"]):
            raise LogError("date %r is not YYYY-MM-DD" % out["date"])
        out["recommendation_accepted"] = flag(payload.get("recommendation_accepted", False))
        return out

    if event_type == "card-superseded":
        out = {"id": card_id("id"), "by": card_id("by")}
        if out["id"] == out["by"]:
            raise LogError("a card cannot supersede itself")
        return out

    if event_type == "card-deferred":
        out = {"id": card_id("id"), "blocks": clean(need("blocks"))}
        if out["blocks"] == BLOCKS_SPECIFICATION:
            raise LogError("a deferred card cannot still block the specification; "
                           "name the phase or the work package its answer changes")
        return out

    if event_type == "card-reactivated":
        return {"id": card_id("id"),
                "blocks": clean(payload.get("blocks") or BLOCKS_SPECIFICATION)}

    return {"id": card_id("id")}


# --- the decisions projection ------------------------------------------------

PREAMBLE = """# DECISIONS

Generated file. The source of truth is the append-only, hash-chained event log at `.log/events.jsonl`; this file is its projection. Do not edit it by hand: an edit here does not change what was decided, and `make check-docs` fails until the file equals a fresh rebuild (`projection-fresh`). To record a decision, append an event with `scripts/log-append.py` and run `make rebuild-decisions`.

Nothing in the log is ever rewritten or deleted. A record is retired by appending a `decision-superseded` event, which renders as a `Status: superseded by D-MMM` line on the superseded entry; its text stays readable, because the alternatives it weighed are the only record of why the decision reads as it does. Types: `implementation` (latitude the specs allow), `spec-amendment` (a non-locked spec text change made in the same commit), `adr` (a change to a locked decision or red line; carries `Owner approval: pending | granted YYYY-MM-DD | rejected`). An implementation session reads the index below and the entries its `PLAN.md` item cites, not the whole file. `make check-docs` verifies the IDs, the fields, the index, the chain and this projection.

Entry format:

```
## D-NNN (YYYY-MM-DD) — Title
Type: …
Decision: …
Why: …
Alternatives: …
Affected specs: …
```
"""


def project_decisions(records):
    """Fold the decisions stream into the entries the projection renders, in seq order."""
    entries = []
    position = {}
    for record in records:
        if record.get("stream") != DECISIONS_STREAM:
            continue
        event_type, payload = record.get("type"), record.get("payload") or {}
        if event_type == "decision-added":
            entry = dict(payload)
            entry.setdefault("superseded_by", None)
            if entry["id"] in position:
                raise LogError("%s added twice (seq %s)" % (entry["id"], record.get("seq")))
            expected = "D-%03d" % (len(entries) + 1)
            if entry["id"] != expected:
                raise LogError("%s at seq %s breaks the sequence: the next decision is %s. IDs run "
                               "contiguously from D-001, and a gap could never be closed on an "
                               "append-only log" % (entry["id"], record.get("seq"), expected))
            position[entry["id"]] = len(entries)
            entries.append(entry)
            continue
        index = position.get(payload.get("id"))
        if index is None:
            raise LogError("%s at seq %s refers to %r, which was never added"
                           % (event_type, record.get("seq"), payload.get("id")))
        if event_type == "decision-superseded":
            entries[index]["superseded_by"] = payload["by"]
        elif event_type == "adr-approval-changed":
            if entries[index].get("type") != "adr":
                raise LogError("adr-approval-changed at seq %s targets %s, whose type is %r, not adr"
                               % (record.get("seq"), payload["id"], entries[index].get("type")))
            entries[index]["approval"] = payload["approval"]
            entries[index].pop("approval_date", None)
            if payload.get("approval_date"):
                entries[index]["approval_date"] = payload["approval_date"]
    return entries


def approval_line(entry):
    state = entry.get("approval")
    if not state:
        return None
    if state == "granted" and entry.get("approval_date"):
        return "Owner approval: granted %s" % entry["approval_date"]
    return "Owner approval: %s" % state


def render_decisions(records):
    """The whole of DECISIONS.md, byte-stable for a given log."""
    entries = project_decisions(records)
    out = [PREAMBLE.rstrip("\n"), "", "## Index", ""]
    for entry in entries:
        line = "- %s — %s — %s" % (entry["id"], entry["title"], entry["type"])
        if entry.get("superseded_by"):
            line += " — superseded by %s" % entry["superseded_by"]
        out.append(line)
    for entry in entries:
        out.append("")
        out.append("## %s (%s) — %s" % (entry["id"], entry["date"], entry["title"]))
        if entry.get("superseded_by"):
            out.append("Status: superseded by %s" % entry["superseded_by"])
        out.append("Type: %s" % entry["type"])
        out.append("Decision: %s" % entry.get("decision", ""))
        out.append("Why: %s" % entry.get("why", ""))
        out.append("Alternatives: %s" % entry.get("alternatives", ""))
        out.append("Affected specs: %s" % entry.get("affected_specs", ""))
        line = approval_line(entry)
        if line:
            out.append(line)
    return "\n".join(out) + "\n"


# --- the questions projection ------------------------------------------------

QUESTIONS_PREAMBLE = """# QUESTIONS

Generated file. The source of truth is the append-only, hash-chained event log at `.log/events.jsonl`; this file is the projection of its `questions` stream. Do not edit it by hand: an edit here does not change what was asked or answered, and `make check-docs` fails until the file equals a fresh rebuild (`projection-fresh`). Cards are opened, answered, deferred, resolved and superseded by appending events with `scripts/log-append.py`, then `make rebuild-questions`.

Only matters the specs cannot answer, each as a decision card. A card belongs here if and only if its plausible answers change data, security, scope, external commitments or product identity/UX; anything else is decided in `DECISIONS.md` with alternatives and is never asked. A card is resolved by answering it, writing the answer into the specs with a `[Q-NNN]` tag (or, after the baseline, into a decision), and appending `card-resolved`. Nothing is ever removed: an owner who changes their mind gets a new card and a `card-superseded` event, and both cards stay readable, because the options the owner saw are the only record of why the decision reads as it does.

Card format:

```
### Q-NNN \u2014 <title>
- Surface: data | security | scope | external | ux
- Source: <requirement text, input file, mockup artboard, or the gap that raised it>
- Question: <one sentence>
- Options:
  - A) <option> \u2192 effect on <surface>: <concrete consequence>
  - B) <option> \u2192 effect on <surface>: <concrete consequence>
- Recommendation: <A|B|C>, because <one or two sentences>
- Blocks: <specification | Phase N | WORK-PACKAGE-ID>
- Answer: <A|B|C|text> (<date>[; recommendation accepted])
```

Every card opens `Blocking` and is answered before the specification proceeds. `Open` cards are the ones the owner deferred, by a `card-deferred` event that names the phase or work package before which they are answered; the spec text that depends on them states the recommendation and carries the `[Q-NNN]` tag, so the provisional status is visible where the statement is read. `make check-docs` verifies the card fields, the Surface value, and that every Resolved card that has not been superseded is cited by a statement.
"""

SECTIONS = (("blocking", "Blocking", "None. Phase 0 can proceed."),
            ("open", "Open", "None."),
            ("resolved", "Resolved", "None."))


def project_questions(records):
    """Fold the questions stream into cards, in the order they were opened."""
    cards = []
    position = {}
    for record in records:
        if record.get("stream") != QUESTIONS_STREAM:
            continue
        event_type, payload = record.get("type"), record.get("payload") or {}
        if event_type == "card-opened":
            card = dict(payload)
            if card["id"] in position:
                raise LogError("%s opened twice (seq %s)" % (card["id"], record.get("seq")))
            expected = "Q-%03d" % (len(cards) + 1)
            if card["id"] != expected:
                raise LogError("%s at seq %s breaks the sequence: the next card is %s. IDs run "
                               "contiguously from Q-001, and a gap could never be closed on an "
                               "append-only log" % (card["id"], record.get("seq"), expected))
            card["state"] = "blocking" if card["blocks"] == BLOCKS_SPECIFICATION else "open"
            card["answer"] = None
            card["answer_date"] = None
            card["recommendation_accepted"] = False
            card["superseded_by"] = None
            position[card["id"]] = len(cards)
            cards.append(card)
            continue
        index = position.get(payload.get("id"))
        if index is None:
            raise LogError("%s at seq %s refers to %r, which was never opened"
                           % (event_type, record.get("seq"), payload.get("id")))
        card = cards[index]
        if event_type == "card-answered":
            card["answer"] = payload["answer"]
            card["answer_date"] = payload["date"]
            card["recommendation_accepted"] = bool(payload.get("recommendation_accepted"))
        elif event_type == "card-deferred":
            card["state"] = "open"
            card["blocks"] = payload["blocks"]
        elif event_type == "card-reactivated":
            card["state"] = "blocking"
            card["blocks"] = payload.get("blocks", BLOCKS_SPECIFICATION)
        elif event_type == "card-resolved":
            card["state"] = "resolved"
        elif event_type == "card-superseded":
            card["superseded_by"] = payload["by"]
    return cards


def answer_line(card):
    if not card["answer"]:
        return None
    suffix = "; recommendation accepted" if card["recommendation_accepted"] else ""
    return "- Answer: %s (%s%s)" % (card["answer"], card["answer_date"], suffix)


def render_questions(records):
    """The whole of QUESTIONS.md, byte-stable for a given log."""
    cards = project_questions(records)
    labels = dict((state, label) for state, label, _ in SECTIONS)
    out = [QUESTIONS_PREAMBLE.rstrip("\n"), "", "## Index", ""]
    for card in cards:
        line = "- %s \u2014 %s \u2014 %s \u2014 %s" % (
            card["id"], card["title"], card["surface"], labels[card["state"]])
        if card["superseded_by"]:
            line += " \u2014 superseded by %s" % card["superseded_by"]
        out.append(line)

    for state, label, empty in SECTIONS:
        out.append("")
        out.append("## %s" % label)
        members = [c for c in cards if c["state"] == state]
        if not members:
            out.append("")
            out.append(empty)
            continue
        for card in members:
            out.append("")
            out.append("### %s \u2014 %s" % (card["id"], card["title"]))
            out.append("- Surface: %s" % card["surface"])
            out.append("- Source: %s" % card["source"])
            out.append("- Question: %s" % card["question"])
            out.append("- Options:")
            for option in card["options"]:
                out.append("  - %s" % option)
            if card.get("recommendation"):
                out.append("- Recommendation: %s" % card["recommendation"])
            out.append("- Blocks: %s" % card["blocks"])
            line = answer_line(card)
            if line:
                out.append(line)
            if card["superseded_by"]:
                out.append("- Superseded by: %s" % card["superseded_by"])
    return "\n".join(out) + "\n"


# --- the body every rebuild tool shares --------------------------------------

def rebuild_command(description, target, render, argv=None):
    """Parse the arguments of a rebuild tool, render, then compare or write.

    One implementation, so the two projections cannot drift in how they treat
    drift. Returns the exit status.
    """
    import argparse
    import difflib
    import sys

    ap = argparse.ArgumentParser(description=description)
    ap.add_argument("--root", default=".", help="repository root (default: current directory)")
    ap.add_argument("--check", action="store_true", help="compare instead of writing")
    ap.add_argument("--stdout", action="store_true", help="print the rendering")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)

    root = os.path.abspath(args.root)
    try:
        rendered = render(load(root))
    except LogError as exc:
        sys.stderr.write("rebuild: %s\n" % exc)
        return 3

    path = os.path.join(root, target)
    current = None
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as fh:
            current = fh.read()

    # --check is decided before --stdout: a check that prints instead of
    # comparing would report success on a drifted file.
    if args.check:
        if current == rendered:
            if not args.quiet:
                print("rebuild: %s matches the log." % target)
            return 0
        print("%s has drifted from the log. First differences:" % target)
        diff = difflib.unified_diff((current or "").splitlines(True), rendered.splitlines(True),
                                    fromfile="%s (committed)" % target, tofile="%s (rebuilt)" % target)
        for line in list(diff)[:40]:
            sys.stdout.write(line if line.endswith("\n") else line + "\n")
        return 1

    if args.stdout:
        sys.stdout.write(rendered)
        return 0

    if current == rendered:
        if not args.quiet:
            print("rebuild: %s already matches the log." % target)
        return 0
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(rendered)
    if not args.quiet:
        print("rebuild: wrote %s from the log." % target)
    return 0


# --- what each stream projects ------------------------------------------------

PROJECTORS = {DECISIONS_STREAM: project_decisions, QUESTIONS_STREAM: project_questions}
