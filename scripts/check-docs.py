#!/usr/bin/env python3
"""
check-docs: mechanical truth for the documentation layer.

Fails (exit 1) when the living documents, the entry point or the specification
pack contradict each other in a way that can be detected without judgement.
Every rule here was once a sentence in AGENTS.md; a rule that can be checked
is checked and removed from the prose.

Run from the repository root:  python3 scripts/check-docs.py [--root DIR] [--quiet] [--only RULE,RULE]

`--task PACKAGE|all` prints one line per work package instead of running the
rules: the two derived characteristics, the recorded `Contract change`, and the
live `blocked-by`. It is what writes the stored fields when the plan is
compiled, and what an orchestrator reads before a task to apply the
prompt-selection table in AGENTS.md.

`--only` keeps the FAIL lines of the named rules and drops the rest, for the
passes a stage runs before every document exists (Stage A's exit, Stage B's
rounds); the summary says how many failures were dropped, so a scoped run
never looks like a clean one.

Rules
  citations     every `NN` §M / `specs/NN-name.md` §M / `README.md` §Name cited
                anywhere in the root documents or the specs resolves to a heading.
                A §Name citation is read as the longest heading the README has, so
                prose may follow it. The body of a superseded entry in DECISIONS.md
                is history and is not checked: the log is append-only, so a dead
                citation there could otherwise never be cleared
  now-items     no `Now` item in PLAN.md is `done` in TRACEABILITY.md, and every
                `Now` item has a TRACEABILITY.md row
  plan-size     PLAN.md stays under its line ceiling
  gaps          every package or phase a GAPS.md row cites exists in the plan;
                gap IDs are unique and increasing
  packages      every work package in the implementation plan has exactly one
                TRACEABILITY.md row, and no row lacks a package
  traceability  status values are from the allowed set; `done` and
                `in progress` rows carry evidence
  decisions     D-IDs are monotonic and contiguous, every entry has the required
                fields, ADRs carry an owner-approval status, the index matches
                the entries
  register      every bullet in the locked register carries only `[input]` or
                `[Q-NNN]` provenance, and each cited card is Resolved
  provenance    every `[Q-NNN]` tag resolves to a card and every `[D-NNN]` tag
                resolves to a decision; every Resolved card is cited somewhere,
                unless it was superseded, in which case its successor carries the
                citation and has to exist
  normative-tagged
                every normative statement in `specs/`, the spec map included
                (MUST, MUST NOT, SHALL, SHOULD, MAY outside code spans; the items
                under a lead-in that ends with the keyword and a colon; every
                bullet of the locked register) ends with a provenance tag. An adopted pack, one whose
                `docs/inputs/README.md` lists `specs/` itself as an authoritative
                input, is exempt: its statements are `[input]` by declaration
  inferred-zero once `specs/README.md` is stamped `Status: Implementation baseline`,
                no `[inferred]` statement remains in `specs/`; before the stamp the
                count is reported and not enforced
  cards         every open card has Surface, Source, Question, Options,
                Recommendation and Blocks; Surface is one of the five values
  chain-intact  the event log's hash chain verifies: every hash recomputes,
                every `prev` links, `seq` is contiguous from 1
  projection-fresh
                DECISIONS.md and QUESTIONS.md are byte-for-byte the rebuild of
                their streams, so no hand edit can survive this gate
  red-lines     every bullet under AGENTS.md "Non-negotiable constraints" cites
                at least one spec section
  commands      every `make <target>` listed in AGENTS.md "Commands" is a target
                in the root Makefile
  agents-size   AGENTS.md stays under its byte ceiling
  markers       no unrendered `{{...}}` placeholder or `TBD` remains in the
                documents or in the root Makefile
  task-policy   every work package states `Surfaces:`, `Touches red line:` and
                `Contract change:`; the two derived ones equal what the pack
                itself says (the surfaces of the cards and register bullets the
                package's cited sections resolve to, and whether a red line
                cites a section the package cites); and the prompt-selection
                table in AGENTS.md names only the three real prompts and only
                characteristics this rule defines, so a renamed characteristic
                or a typo in the table fails the build rather than silently
                selecting nothing. `Contract change` is a judgement the plan
                author records, so it is checked for presence and shape only:
                the rule never recomputes it. `blocked-by` is never stored,
                because resolving a card would otherwise mean unlocking the plan

The report at the end (cards per surface, `[inferred]` statements per file,
statements that cite a card still Open, open gaps) is informational; only FAIL
lines set the exit code. A frozen pack may cite an Open card: that is a deliberate
deferral the owner chose, and the summary names it rather than failing on it.
"""

import argparse
import glob
import json
import os
import re
import sys

# --- configuration -----------------------------------------------------------

ROOT_DOCS = ["AGENTS.md", "PLAN.md", "DECISIONS.md", "GAPS.md", "QUESTIONS.md",
             "TRACEABILITY.md", "CLAUDE.md", "README.md"]
SPECS_DIR = "specs"
PLAN_MAX_LINES = 100
AGENTS_MAX_BYTES = 20_000
SURFACES = {"data", "security", "scope", "external", "ux"}
STATUSES = {"not started", "in progress", "done"}
DECISION_TYPES = {"implementation", "spec-amendment", "adr"}
CARD_FIELDS = ["Surface", "Source", "Question", "Options", "Recommendation", "Blocks"]
SURFACE_ORDER = ["data", "security", "scope", "external", "ux"]
TASK_FIELDS = ["Surfaces", "Touches red line", "Contract change"]
DERIVED_FIELDS = ["Surfaces", "Touches red line"]
BOOLEAN_FIELDS = ["Touches red line", "Contract change"]
LIVE_CHARACTERISTIC = "blocked-by"
POLICY_HEADING = "Prompt selection"
PROMPT_NAMES = {"1": "Implement", "2": "Review", "3": "Resolve questions"}
EMPTY = "\u2014"
DECISION_FIELDS = ["Type", "Decision", "Why", "Alternatives", "Affected specs"]

WP_RE = re.compile(r"\b([A-Z]{2,5}-\d{2,3})\b")
WP_RANGE_RE = re.compile(r"\b([A-Z]{2,5})-(\d{2,3})\.\.(\d{2,3})\b")
PHASE_RE = re.compile(r"\bPhase (\d+)")
Q_TAG_RE = re.compile(r"\[(?:[^\]]*?,\s*)?(Q-\d{3})[^\]]*\]")
D_TAG_RE = re.compile(r"\[(D-\d{3})\]")
INFERRED_RE = re.compile(r"(?<!`)\[inferred\](?!`)")  # a quoted `[inferred]` in prose is not a tag
KEYWORD_RE = re.compile(r"\b(MUST NOT|MUST|SHALL NOT|SHALL|SHOULD NOT|SHOULD|MAY)\b")
LEADIN_RE = re.compile(r"\b(MUST NOT|MUST|SHALL|SHOULD|MAY)\s*:\s*$")
PROVENANCE_RE = re.compile(r"\[((?:input|inferred|Q-\d{3}|D-\d{3})(?:[^\]]*))\]\s*$")
SPEC_HEADING_RE = re.compile(r"^(#{2,4})\s+(\d+(?:\.\d+)*)\.?\s+(.*)$")
CODE_SPAN_RE = re.compile(r"`[^`]*`")
LIST_ITEM_RE = re.compile(r"^\s*(?:[-*]|\d+\.)\s+\S")
FILE_TOKEN_RE = re.compile(r"`(?:specs/)?(\d{2})(?:-[a-z0-9-]+\.md)?`|`(?:specs/)?(README\.md)`")
SEC_NUM_RE = re.compile(r"§(\d+(?:\.\d+)?)(?:[–-](\d+))?")

failures = []
notes = []


def fail(rule, where, msg):
    failures.append("FAIL %-12s %s: %s" % (rule, where, msg))


def ok(rule, msg):
    notes.append("ok   %-12s %s" % (rule, msg))


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def exists(path):
    return os.path.isfile(path)


def strip_fences(text):
    """Blank out fenced code blocks, keeping line numbers stable."""
    out, fenced = [], False
    for line in text.splitlines():
        if line.strip().startswith("```"):
            fenced = not fenced
            out.append("")
            continue
        out.append("" if fenced else line)
    return "\n".join(out)


# --- spec index --------------------------------------------------------------

def spec_files(root):
    return sorted(glob.glob(os.path.join(root, SPECS_DIR, "[0-9][0-9]-*.md")))


def spec_by_role(root, role):
    """Locate the spec file whose name ends with the role, e.g. 'decision-register'."""
    for p in spec_files(root):
        if os.path.basename(p)[3:] == role + ".md":
            return p
    return None


def section_index(root):
    """{NN: {numbers}} for numbered headings and {file: {names}} for named ones."""
    numbered, named = {}, {}
    for p in spec_files(root):
        nn = os.path.basename(p)[:2]
        nums = set()
        for m in re.finditer(r"^#{2,4}\s+(\d+(?:\.\d+)*)\.?\s", read(p), re.M):
            nums.add(m.group(1))
        numbered[nn] = nums
    readme = os.path.join(root, SPECS_DIR, "README.md")
    if exists(readme):
        named["specs/README.md"] = {m.group(1).strip().lower()
                                    for m in re.finditer(r"^##+\s+(.+?)\s*$", read(readme), re.M)}
    root_readme = os.path.join(root, "README.md")
    if exists(root_readme):
        named["README.md"] = {m.group(1).strip().lower()
                              for m in re.finditer(r"^##+\s+(.+?)\s*$", read(root_readme), re.M)}
    return numbered, named


def expand_sections(text):
    """From the text following a file token, collect the § references that belong to it."""
    out = []
    # Consume tokens while they look like part of a citation list.
    pos = 0
    tokens = re.finditer(r"\S+", text)
    for t in tokens:
        tok = t.group(0)
        clean = tok.rstrip(",;:).")
        if tok.startswith("§") or tok.startswith("(§"):
            for m in SEC_NUM_RE.finditer(clean):
                a, b = m.group(1), m.group(2)
                if b and "." not in a:
                    lo, hi = int(a), int(b)
                    out.extend(str(i) for i in range(lo, hi + 1))
                else:
                    out.append(a)
            if tok.endswith((")", ".", ";")) and not tok.endswith("§"):
                break
            continue
        if clean in ("and", "&"):
            continue
        break
    return out


def resolve_named(rest, token, named):
    """Resolve a `§Name` citation that follows a README token.

    Returns None when no `§` follows, else (key, name, resolved). The name is
    the LONGEST heading of the README that the text after `§` starts with, so a
    sentence may go on after the citation ("`specs/README.md` §Provenance says
    that ..."). Reading up to the next punctuation instead made every such
    sentence fail.
    """
    m = re.match(r"\s*§\s*", rest)
    if not m:
        return None
    candidate = rest[m.end():]
    keys = ["specs/README.md", "README.md"] if "specs/" in token else ["README.md", "specs/README.md"]
    for key in keys:
        for name in sorted(named.get(key, ()), key=len, reverse=True):
            if candidate.lower().startswith(name) and (len(candidate) == len(name) or not candidate[len(name)].isalnum()):
                return key, name, True
    return keys[0], " ".join(candidate.split()[:4]), False


def line_citation_failures(root, line, numbered, named, existing_only=False):
    """(messages, citations checked) for one line of text.

    With `existing_only`, a citation into a spec file that does not exist yet is
    not a failure: `log-append` uses this before the specs are written, and the
    full check runs on every gate afterwards.
    """
    out, count = [], 0
    for fm in re.finditer(r"`specs/(\d{2}-[a-z0-9-]+\.md)`", line):
        if not exists(os.path.join(root, SPECS_DIR, fm.group(1))) and not existing_only:
            out.append("`specs/%s` is not a file" % fm.group(1))
    for m in FILE_TOKEN_RE.finditer(line):
        nn, readme = m.group(1), m.group(2)
        rest = line[m.end():]
        if readme:
            hit = resolve_named(rest, m.group(0), named)
            if hit is None:
                continue
            key, name, resolved = hit
            if key not in named and existing_only:
                continue
            count += 1
            if not resolved:
                out.append("`%s` §%s does not resolve" % (key, name))
            continue
        secs = expand_sections(rest)
        if not secs:
            continue
        if nn not in numbered:
            if not existing_only:
                out.append("no spec file numbered %s" % nn)
            continue
        for s in secs:
            count += 1
            if s not in numbered[nn]:
                out.append("`%s` §%s does not resolve" % (nn, s))
    return out, count


def citation_failures(root, text, existing_only=False):
    """Every citation failure in a piece of text, against the specs under root."""
    numbered, named = section_index(root)
    out = []
    for line in text.splitlines():
        msgs, _ = line_citation_failures(root, line, numbered, named, existing_only)
        out.extend(msgs)
    return out


def check_citations(root, docs, numbered, named):
    count = 0
    for doc in docs:
        text = read(doc)
        rel = os.path.relpath(doc, root)
        in_fence, superseded = False, False
        for ln, line in enumerate(text.splitlines(), 1):
            if line.strip().startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence:
                continue
            if rel == "DECISIONS.md":
                # A superseded record keeps its text as history; its citations are
                # not live and, on an append-only log, could never be repaired.
                if re.match(r"^##\s+D-\d{3}\b", line):
                    superseded = False
                elif re.match(r"^Status:\s*superseded by D-\d{3}", line):
                    superseded = True
                    continue
                if superseded:
                    continue
            msgs, n = line_citation_failures(root, line, numbered, named)
            count += n
            for msg in msgs:
                fail("citations", "%s:%d" % (rel, ln), msg)
    ok("citations", "%d section citations checked" % count)


# --- plan / traceability -----------------------------------------------------

def plan_packages(root):
    plan = spec_by_role(root, "implementation-plan")
    if not plan:
        fail("packages", SPECS_DIR, "no *-implementation-plan.md found")
        return set(), set(), None
    text = read(plan)
    pkgs = set()
    for m in re.finditer(r"`([A-Z]{2,5}-\d{2,3})`", text):
        pkgs.add(m.group(1))
    phases = set(m.group(1) for m in re.finditer(r"^##\s+\d+\.\s+Phase (\d+)", text, re.M))
    return pkgs, phases, plan


def traceability_rows(root):
    path = os.path.join(root, "TRACEABILITY.md")
    rows = {}
    if not exists(path):
        fail("packages", "TRACEABILITY.md", "file missing")
        return rows
    for ln, line in enumerate(read(path).splitlines(), 1):
        m = re.match(r"^\|\s*([A-Z]{2,5}-\d{2,3})\s*\|(.*)\|\s*$", line)
        if not m:
            continue
        cells = [c.strip() for c in m.group(2).split("|")]
        # Package | Phase | Outcome | Key specs | Status | Evidence
        status = cells[3].lower() if len(cells) >= 5 else ""
        evidence = cells[4] if len(cells) >= 5 else ""
        if m.group(1) in rows:
            fail("packages", "TRACEABILITY.md:%d" % ln, "%s has more than one row" % m.group(1))
        rows[m.group(1)] = (ln, status, evidence)
    return rows


def check_packages_and_traceability(root):
    pkgs, phases, plan = plan_packages(root)
    rows = traceability_rows(root)
    for p in sorted(pkgs - set(rows)):
        fail("packages", "TRACEABILITY.md", "work package %s from the plan has no row" % p)
    for p in sorted(set(rows) - pkgs):
        fail("packages", "TRACEABILITY.md:%d" % rows[p][0], "row %s is not a work package in the plan" % p)
    for p, (ln, status, evidence) in rows.items():
        if status not in STATUSES:
            fail("traceability", "TRACEABILITY.md:%d" % ln, "%s status %r is not one of %s" % (p, status, sorted(STATUSES)))
        elif status in ("done", "in progress") and evidence in ("", "—", "-", "–"):
            fail("traceability", "TRACEABILITY.md:%d" % ln, "%s is %s without evidence" % (p, status))
    if pkgs:
        ok("packages", "%d work packages, %d rows" % (len(pkgs), len(rows)))
    return pkgs, phases, rows


def check_plan(root, rows):
    path = os.path.join(root, "PLAN.md")
    if not exists(path):
        fail("now-items", "PLAN.md", "file missing")
        return
    text = read(path)
    n = len(text.splitlines())
    if n > PLAN_MAX_LINES:
        fail("plan-size", "PLAN.md", "%d lines, ceiling is %d" % (n, PLAN_MAX_LINES))
    else:
        ok("plan-size", "PLAN.md is %d lines" % n)
    heads = [m.group(1) for m in re.finditer(r"^##\s+(\w+)", text, re.M)]
    if heads != ["Now", "Next"]:
        fail("now-items", "PLAN.md", "sections must be exactly `## Now` then `## Next`, found %s" % heads)
    now = text.split("## Now", 1)[1].split("## Next", 1)[0] if "## Now" in text else ""
    items = re.findall(r"^###\s+([A-Z]{2,5}-\d{2,3})\b", now, re.M)
    if not items:
        fail("now-items", "PLAN.md", "no `### <PACKAGE-ID>` item under Now")
    if len(items) > 3:
        fail("now-items", "PLAN.md", "%d Now items; keep 1-3" % len(items))
    for it in items:
        if it not in rows:
            fail("now-items", "PLAN.md", "Now item %s has no TRACEABILITY.md row" % it)
        elif rows[it][1] == "done":
            fail("now-items", "PLAN.md", "Now item %s is already `done` in TRACEABILITY.md" % it)
    if items:
        ok("now-items", "Now = %s" % ", ".join(items))


def check_gaps(root, pkgs, phases):
    path = os.path.join(root, "GAPS.md")
    if not exists(path):
        fail("gaps", "GAPS.md", "file missing")
        return 0
    last = 0
    count = 0
    for ln, line in enumerate(read(path).splitlines(), 1):
        m = re.match(r"^\|\s*G-(\d{3})\s*\|(.*)\|\s*$", line)
        if not m:
            continue
        count += 1
        gid = int(m.group(1))
        if gid <= last:
            fail("gaps", "GAPS.md:%d" % ln, "G-%03d is not greater than the previous gap ID" % gid)
        last = gid
        cells = [c.strip() for c in m.group(2).split("|")]
        plan_item = cells[-1] if cells else ""
        expanded = set()
        for pre, a, b in WP_RANGE_RE.findall(plan_item):
            for i in range(int(a), int(b) + 1):
                expanded.add("%s-%02d" % (pre, i))
        for wp in WP_RE.findall(WP_RANGE_RE.sub(" ", plan_item)):
            expanded.add(wp)
        for wp in sorted(expanded):
            if wp not in pkgs:
                fail("gaps", "GAPS.md:%d" % ln, "G-%03d cites %s, which is not a work package in the plan" % (gid, wp))
        for ph in PHASE_RE.findall(plan_item):
            if ph not in phases:
                fail("gaps", "GAPS.md:%d" % ln, "G-%03d cites Phase %s, which is not in the plan" % (gid, ph))
        if not expanded and not PHASE_RE.search(plan_item):
            fail("gaps", "GAPS.md:%d" % ln, "G-%03d names no work package or phase in its plan-item column" % gid)
    ok("gaps", "%d open gaps" % count)
    return count


# --- decisions ---------------------------------------------------------------

def check_decisions(root):
    path = os.path.join(root, "DECISIONS.md")
    ids = set()
    if not exists(path):
        fail("decisions", "DECISIONS.md", "file missing")
        return ids
    text = strip_fences(read(path))
    heads = list(re.finditer(r"^##\s+D-(\d{3})\s+\((\d{4}-\d{2}-\d{2})\)\s+—\s+(.+?)\s*$", text, re.M))
    bad_heads = [ln for ln, l in enumerate(text.splitlines(), 1)
                 if l.startswith("## D-") and not re.match(r"^##\s+D-\d{3}\s+\(\d{4}-\d{2}-\d{2}\)\s+—\s+.+", l)]
    for ln in bad_heads:
        fail("decisions", "DECISIONS.md:%d" % ln, "entry heading must be `## D-NNN (YYYY-MM-DD) — Title`")
    expected = 1
    for i, h in enumerate(heads):
        n = int(h.group(1))
        ln = text.count("\n", 0, h.start()) + 1
        if n != expected:
            fail("decisions", "DECISIONS.md:%d" % ln, "D-%03d breaks the sequence (expected D-%03d)" % (n, expected))
        expected = n + 1
        ids.add("D-%03d" % n)
        body = text[h.end(): heads[i + 1].start() if i + 1 < len(heads) else len(text)]
        superseded = re.search(r"^Status:\s*superseded by D-\d{3}", body, re.M)
        if superseded:
            continue  # collapsed entry: heading plus status line only
        for f in DECISION_FIELDS:
            if not re.search(r"^%s:\s*\S" % re.escape(f), body, re.M):
                fail("decisions", "DECISIONS.md:%d" % ln, "D-%03d lacks `%s:`" % (n, f))
        tm = re.search(r"^Type:\s*(\S+)", body, re.M)
        if tm and tm.group(1) not in DECISION_TYPES:
            fail("decisions", "DECISIONS.md:%d" % ln, "D-%03d type %r not in %s" % (n, tm.group(1), sorted(DECISION_TYPES)))
        if tm and tm.group(1) == "adr" and not re.search(r"^Owner approval:\s*(pending|granted \d{4}-\d{2}-\d{2}|rejected)", body, re.M):
            fail("decisions", "DECISIONS.md:%d" % ln, "D-%03d is an ADR without `Owner approval: pending | granted YYYY-MM-DD | rejected`" % n)
    # index
    idx = re.search(r"^##\s+Index\s*$(.*?)(?=^##\s+D-\d{3}|\Z)", text, re.M | re.S)
    if not idx:
        fail("decisions", "DECISIONS.md", "no `## Index` section before the first entry")
    else:
        indexed = set(re.findall(r"^\s*-\s+(D-\d{3})\s+—", idx.group(1), re.M))
        for d in sorted(ids - indexed):
            fail("decisions", "DECISIONS.md", "%s has an entry but no index line" % d)
        for d in sorted(indexed - ids):
            fail("decisions", "DECISIONS.md", "%s is indexed but has no entry" % d)
    ok("decisions", "%d entries" % len(ids))
    return ids


# --- questions / cards -------------------------------------------------------

def parse_cards(root):
    """Return {Q-ID: (section, line, body)}, the resolved IDs, and {old: superseding}."""
    path = os.path.join(root, "QUESTIONS.md")
    cards, resolved, superseded = {}, set(), {}
    if not exists(path):
        fail("cards", "QUESTIONS.md", "file missing")
        return cards, resolved, superseded
    text = strip_fences(read(path))
    section = None
    lines = text.splitlines()
    cur = None
    for ln, line in enumerate(lines, 1):
        hm = re.match(r"^##\s+(Blocking|Open|Resolved|Index)\s*$", line)
        if hm:
            section = hm.group(1)
            cur = None
            continue
        cm = re.match(r"^###\s+(Q-\d{3})\b", line)
        if cm and section in ("Blocking", "Open", "Resolved"):
            cur = cm.group(1)
            if cur in cards:
                fail("cards", "QUESTIONS.md:%d" % ln, "%s appears twice" % cur)
            cards[cur] = [section, ln, []]
            if section == "Resolved":
                resolved.add(cur)
            continue
        if section == "Resolved":
            for q in re.findall(r"^\s*-\s+(Q-\d{3})\b", line):
                resolved.add(q)
                cards.setdefault(q, ["Resolved", ln, []])
        if cur:
            cards[cur][2].append(line)
            sm = re.match(r"^\s*-\s*\*?\*?Superseded by\*?\*?:\s*(Q-\d{3})\b", line)
            if sm:
                superseded[cur] = sm.group(1)
    return ({k: (v[0], v[1], "\n".join(v[2])) for k, v in cards.items()},
            resolved, superseded)


def check_cards(cards):
    per_surface = {s: [0, 0] for s in SURFACES}  # open, resolved
    for q, (section, ln, body) in sorted(cards.items()):
        sm = re.search(r"^-?\s*\*?\*?Surface:?\*?\*?:?\s*([a-z]+)", body, re.M)
        surface = sm.group(1) if sm else None
        if section in ("Blocking", "Open"):
            for f in CARD_FIELDS:
                if not re.search(r"^-?\s*\*?\*?%s\*?\*?:" % f, body, re.M):
                    fail("cards", "QUESTIONS.md:%d" % ln, "%s lacks `%s:`" % (q, f))
            if surface not in SURFACES:
                fail("cards", "QUESTIONS.md:%d" % ln, "%s Surface %r is not one of %s" % (q, surface, sorted(SURFACES)))
            if re.search(r"^-?\s*\*?\*?Options\*?\*?:", body, re.M) and not re.search(r"→|->", body):
                fail("cards", "QUESTIONS.md:%d" % ln, "%s options carry no `→ effect on <surface>` consequence" % q)
        if surface in SURFACES:
            per_surface[surface][1 if section == "Resolved" else 0] += 1
    numbers = sorted(int(q[2:]) for q in cards)
    if numbers != list(range(1, len(numbers) + 1)):
        missing = sorted(set(range(1, (numbers[-1] if numbers else 0) + 1)) - set(numbers))
        fail("cards", "QUESTIONS.md", "card IDs are not contiguous from Q-001; missing %s"
             % ", ".join("Q-%03d" % n for n in missing))
    ok("cards", "%d cards" % len(cards))
    return per_surface


# --- normative statements ----------------------------------------------------

def provenance_of(line):
    """The primary tag of a trailing `[...]`, or None when the line carries none."""
    m = PROVENANCE_RE.search(line.rstrip())
    return m.group(1).split(",")[0].strip() if m else None


def normative_statements(text, is_register=False):
    """Yield (line, section, tag, statement) for every normative statement in a spec.

    A statement is normative when it carries MUST, MUST NOT, SHALL, SHALL NOT,
    SHOULD, SHOULD NOT or MAY outside a code span, so a quoted `MUST` in prose
    is not one. A lead-in ending with the keyword and a colon makes the list
    items that follow normative as well, up to the first line that is neither
    an item nor blank; an item without a tag of its own inherits the lead-in's.
    In the locked register every bullet above the change-control section is
    normative by definition. Fenced code and table rows are skipped; the
    provenance rule keeps tables non-normative. This is the one detector: the
    skill's `extract-normative` imports it, so the listing an author reads and
    the assertion the gate enforces cannot disagree.
    """
    section, fenced, inherit = "-", False, None
    for ln, line in enumerate(text.splitlines(), 1):
        if line.strip().startswith("```"):
            fenced = not fenced
            continue
        if fenced:
            continue
        hm = SPEC_HEADING_RE.match(line)
        if hm:
            section, inherit = hm.group(2), None
            if is_register and "change control" in hm.group(3).lower():
                section = "change-control"
            continue
        if not line.strip():
            continue
        if line.lstrip().startswith("|"):
            continue
        is_item = bool(LIST_ITEM_RE.match(line))
        if inherit is not None and not is_item:
            inherit = None
        normative = bool(KEYWORD_RE.search(CODE_SPAN_RE.sub("", line)))
        if is_register and is_item and section != "change-control":
            normative = True
        tag = provenance_of(line)
        if inherit is not None and is_item:
            normative = True
            if tag is None:
                tag = inherit
        if LEADIN_RE.search(CODE_SPAN_RE.sub("", line).strip()):
            inherit = tag if tag is not None else "(none)"
        if not normative:
            continue
        if tag == "(none)":
            tag = None
        statement = re.sub(r"\s+", " ", PROVENANCE_RE.sub("", line).strip(" -*"))
        yield ln, section, tag, statement


def adopted_pack(root):
    """True when docs/inputs/README.md lists `specs/` itself as an authoritative input."""
    path = os.path.join(root, "docs", "inputs", "README.md")
    if not exists(path):
        return False
    for line in read(path).splitlines():
        m = re.match(r"^\|\s*`?specs/?`?\s*\|(.*)\|\s*$", line)
        if m and "authoritative" in m.group(1).lower():
            return True
    return False


def frozen(root):
    """True once specs/README.md carries the implementation-baseline stamp."""
    readme = os.path.join(root, SPECS_DIR, "README.md")
    return exists(readme) and re.search(r"^Status:\s*Implementation baseline", read(readme), re.M) is not None


def check_normative(root, adopted):
    total, untagged = 0, 0
    readme = os.path.join(root, SPECS_DIR, "README.md")
    for p in spec_files(root) + ([readme] if exists(readme) else []):
        rel = os.path.relpath(p, root)
        is_register = os.path.basename(p).endswith("-decision-register.md")
        for ln, section, tag, statement in normative_statements(read(p), is_register):
            total += 1
            if tag is None:
                untagged += 1
                if not adopted:
                    fail("normative-tagged", "%s:%d" % (rel, ln),
                         "normative statement carries no provenance tag: %s" % statement[:80])
    if adopted:
        ok("normative-tagged", "%d normative statements; %d untagged are [input] by declaration (adopted pack)"
           % (total, untagged))
    else:
        ok("normative-tagged", "%d normative statements, every one tagged" % total)
    return total


def check_inferred(inferred, is_frozen):
    total = sum(inferred.values())
    if is_frozen:
        for rel, n in sorted(inferred.items()):
            fail("inferred-zero", rel, "%d `[inferred]` statement(s) remain in a frozen pack; each becomes "
                                       "a card (surface touched) or a D-NNN (not touched)" % n)
        if not total:
            ok("inferred-zero", "frozen pack, no [inferred] statement")
    else:
        ok("inferred-zero", "not frozen; %d [inferred] statement(s) reported, not enforced" % total)


def provisional_citations(root, specs, cards):
    """(file, line, card) for every spec statement citing a card that is not Resolved."""
    out = []
    for p in specs:
        rel = os.path.relpath(p, root)
        for ln, line in enumerate(read(p).splitlines(), 1):
            for q in Q_TAG_RE.findall(line):
                if q in cards and cards[q][0] in ("Blocking", "Open"):
                    out.append((rel, ln, q))
    return out


# --- register / provenance ---------------------------------------------------

def check_register(root, resolved):
    reg = spec_by_role(root, "decision-register")
    if not reg:
        fail("register", SPECS_DIR, "no *-decision-register.md found")
        return
    text = strip_fences(read(reg))
    rel = os.path.relpath(reg, root)
    # everything before the change-control section is locked content
    cc = re.search(r"^##\s+\d+\.\s+Change control", text, re.M)
    locked = text[:cc.start()] if cc else text
    if not cc:
        fail("register", rel, "no `## N. Change control` section")
    bullets = 0
    for ln, line in enumerate(locked.splitlines(), 1):
        if not re.match(r"^\s*[-*]\s+\S", line):
            continue
        bullets += 1
        tags = re.findall(r"\[([^\]]+)\]\s*$", line.rstrip())
        if not tags:
            fail("register", "%s:%d" % (rel, ln), "bullet has no trailing provenance tag")
            continue
        parts = [p.strip() for p in tags[-1].split(",")]
        for p in parts:
            if p == "input" or p == "recommendation accepted":
                continue
            qm = re.match(r"^(Q-\d{3})$", p)
            if qm:
                if qm.group(1) not in resolved:
                    fail("register", "%s:%d" % (rel, ln), "%s is cited but not Resolved in QUESTIONS.md" % qm.group(1))
                continue
            fail("register", "%s:%d" % (rel, ln), "provenance %r is not allowed in the locked register (only [input] and [Q-NNN])" % p)
    ok("register", "%d locked bullets" % bullets)


def check_provenance(root, docs, cards, resolved, dids, superseded=None):
    cited = set()
    inferred = {}
    for doc in docs:
        rel = os.path.relpath(doc, root)
        text = read(doc)
        for ln, line in enumerate(text.splitlines(), 1):
            for q in Q_TAG_RE.findall(line):
                cited.add(q)
                if q not in cards:
                    fail("provenance", "%s:%d" % (rel, ln), "%s is tagged but has no card in QUESTIONS.md" % q)
            for d in D_TAG_RE.findall(line):
                if d not in dids:
                    fail("provenance", "%s:%d" % (rel, ln), "%s is tagged but has no entry in DECISIONS.md" % d)
            if INFERRED_RE.search(line) and rel.startswith(SPECS_DIR):
                inferred[rel] = inferred.get(rel, 0) + 1
    decisions_text = read(os.path.join(root, "DECISIONS.md")) if exists(os.path.join(root, "DECISIONS.md")) else ""
    superseded = superseded or {}
    for q in sorted(resolved):
        if q in superseded:
            # The owner changed their mind: the statement now cites the superseding
            # card, and the old one stays Resolved and readable for its options. It
            # is the successor that has to be cited, and it is checked on its own row.
            heir = superseded[q]
            if heir not in cards:
                fail("provenance", "QUESTIONS.md",
                     "%s is superseded by %s, which has no card" % (q, heir))
            continue
        if q not in cited and not re.search(r"\b%s\b" % q, decisions_text):
            fail("provenance", "QUESTIONS.md", "%s is Resolved but no spec statement or decision cites it" % q)
    ok("provenance", "%d distinct cards cited" % len(cited))
    return inferred


# --- AGENTS.md ---------------------------------------------------------------

def section_text(text, heading_prefix):
    m = re.search(r"^##\s+%s.*?$(.*?)(?=^##\s|\Z)" % re.escape(heading_prefix), text, re.M | re.S)
    return m.group(1) if m else None


def check_agents(root):
    path = os.path.join(root, "AGENTS.md")
    if not exists(path):
        fail("red-lines", "AGENTS.md", "file missing")
        return
    text = read(path)
    size = os.path.getsize(path)
    if size > AGENTS_MAX_BYTES:
        fail("agents-size", "AGENTS.md", "%d bytes, ceiling is %d; move content into the playbook or docs/" % (size, AGENTS_MAX_BYTES))
    else:
        ok("agents-size", "AGENTS.md is %d bytes" % size)
    red = section_text(strip_fences(text), "Non-negotiable constraints")
    if red is None:
        fail("red-lines", "AGENTS.md", "no `## Non-negotiable constraints` section")
    else:
        n = 0
        for ln, line in enumerate(red.splitlines()):
            if re.match(r"^\s*[-*]\s+\S", line):
                n += 1
                if "§" not in line:
                    fail("red-lines", "AGENTS.md", "red line %d cites no spec section: %s" % (n, line.strip()[:70]))
        ok("red-lines", "%d red lines" % n)
    cmds = section_text(text, "Commands")
    makefile = os.path.join(root, "Makefile")
    if cmds is None:
        fail("commands", "AGENTS.md", "no `## Commands` section")
    elif not exists(makefile):
        fail("commands", "Makefile", "file missing")
    else:
        targets = set(re.findall(r"^([a-zA-Z][a-zA-Z0-9_-]*):", read(makefile), re.M))
        listed = set()
        for fence in re.findall(r"```(?:bash|sh|make)?\n(.*?)```", cmds, re.S):
            listed.update(re.findall(r"^\s*make\s+([a-zA-Z][a-zA-Z0-9_-]*)", fence, re.M))
        for t in sorted(listed - targets):
            fail("commands", "AGENTS.md", "`make %s` is listed but is not a Makefile target" % t)
        ok("commands", "%d listed targets exist" % len(listed & targets))



# --- task characteristics and the prompt-selection policy ---------------------
#
# The pack states DATA (what kind of task a package is); AGENTS.md states POLICY
# (when that kind needs a review or a question pass). The two are kept apart on
# purpose, exactly as provenance is: the plan never says "run a review here", it
# says "this package touches security", and the table says what that implies.
# Three characteristics are stored on the package and two of those are DERIVED
# from what the pack already holds, so they cannot drift when a decision changes
# and this rule can recompute them. The fourth, `blocked-by`, is never stored:
# it is read from QUESTIONS.md at run time, so resolving a blocking card needs no
# ceremonial unlock of a hard-locked plan.


def line_citations(line):
    """Every `NN` §M citation on one line, as (NN, section) pairs.

    The same tokens the `citations` rule resolves, without the resolving: what a
    package cites is read here, so the two can never disagree about what a
    citation is.
    """
    out = []
    for m in FILE_TOKEN_RE.finditer(line):
        if not m.group(1):
            continue
        for sec in expand_sections(line[m.end():]):
            out.append((m.group(1), sec))
    return out


def text_citations(text):
    out = []
    for line in text.splitlines():
        out.extend(line_citations(line))
    return out


def with_parents(citations):
    """Each citation and its top-level section, so a §2 and a §2.1 still meet."""
    out = set()
    for nn, sec in citations:
        out.add((nn, sec))
        out.add((nn, sec.split(".")[0]))
    return out


def plan_package_blocks(root):
    """[(package, line, block)] for the implementation plan, in file order.

    A package's block runs from its `` `PKG-NN` Title `` line to the next one or
    to the next heading, whichever comes first. The title line is part of the
    block: a plan that writes a package as one line carries its citations there
    and nowhere else, and a derivation that skipped it would read that package as
    touching no surface at all.
    """
    plan = spec_by_role(root, "implementation-plan")
    if not plan:
        return []
    blocks, current = [], None
    for ln, line in enumerate(strip_fences(read(plan)).splitlines(), 1):
        m = re.match(r"^`([A-Z]{2,5}-\d{2,3})`\s", line)
        if m:
            current = [m.group(1), ln, [line]]
            blocks.append(current)
            continue
        if line.startswith("#"):
            current = None
            continue
        if current is not None:
            current[2].append(line)
    return [(pkg, ln, "\n".join(body)) for pkg, ln, body in blocks]


def surface_named(heading):
    """The surface a register heading groups, or None (`6. Change control`)."""
    text = heading.lower()
    for surface in SURFACE_ORDER:
        if surface in text:
            return surface
    if "identity" in text or "user experience" in text:
        return "ux"
    return None


def card_surfaces(cards):
    out = {}
    for q, (_, _, body) in cards.items():
        m = re.search(r"^-?\s*\*?\*?Surface:?\*?\*?:?\s*([a-z]+)", body, re.M)
        if m and m.group(1) in SURFACES:
            out[q] = m.group(1)
    return out


def section_surfaces(root, cards):
    """{(NN, section): {surface}}: where each spec section touches a surface.

    Two sources, both already in the pack and both the owner's: a `[Q-NNN]` tag
    contributes its card's surface to the section it sits in, and a bullet of the
    locked register contributes the surface of the heading it sits under, to its
    own section and to every section it cites. A `[D-NNN]` or `[input]` statement
    contributes nothing by itself: it is not an owner decision on a surface.
    """
    surface_of = card_surfaces(cards)
    index = {}

    def add(key, surface):
        index.setdefault(key, set()).add(surface)

    register = spec_by_role(root, "decision-register")
    for path in spec_files(root):
        nn = os.path.basename(path)[:2]
        section, heading_surface = "-", None
        for line in strip_fences(read(path)).splitlines():
            hm = SPEC_HEADING_RE.match(line)
            if hm:
                section = hm.group(2)
                heading_surface = surface_named(hm.group(3)) if path == register else None
                continue
            for q in Q_TAG_RE.findall(line):
                if q in surface_of:
                    add((nn, section), surface_of[q])
                    add((nn, section.split(".")[0]), surface_of[q])
            if heading_surface and re.match(r"^\s*[-*]\s+\S", line):
                add((nn, section), heading_surface)
                for cite in with_parents(line_citations(line)):
                    add(cite, heading_surface)
    return index


def red_line_sections(root):
    """Every section a red line of AGENTS.md cites, with parents."""
    path = os.path.join(root, "AGENTS.md")
    if not exists(path):
        return set()
    red = section_text(strip_fences(read(path)), "Non-negotiable constraints")
    if red is None:
        return set()
    out = set()
    for line in red.splitlines():
        if re.match(r"^\s*[-*]\s+\S", line):
            out |= with_parents(line_citations(line))
    return out


def derive_characteristics(root, cards):
    """{package: derived characteristics}, from the pack's own data only."""
    index = section_surfaces(root, cards)
    red = red_line_sections(root)
    out = {}
    for pkg, ln, block in plan_package_blocks(root):
        cites = with_parents(text_citations(block))
        surfaces = set()
        for cite in cites:
            surfaces |= index.get(cite, set())
        hits = sorted(cites & red)
        out[pkg] = {
            "line": ln,
            "Surfaces": ", ".join(s for s in SURFACE_ORDER if s in surfaces) or EMPTY,
            "Touches red line": "yes" if hits else "no",
            "cites": sorted(cites),
            "red hits": hits,
        }
    return out


def stored_characteristics(block):
    """{field: [values]} as the package block states them."""
    pattern = re.compile(r"^\s*[-*]\s*\*?\*?(%s)\*?\*?:\s*(.*?)\s*$"
                         % "|".join(re.escape(f) for f in TASK_FIELDS))
    found = {}
    for line in block.splitlines():
        m = pattern.match(line)
        if m:
            found.setdefault(m.group(1), []).append(m.group(2))
    return found


def blocked_by(cards, package):
    """The open cards whose `Blocks:` names this package.

    Computed here and never written into the plan: a card is resolved by an
    event, and the plan is hard-locked once the pack is frozen.
    """
    out = []
    for q in sorted(cards):
        section, _, body = cards[q]
        if section not in ("Blocking", "Open"):
            continue
        m = re.search(r"^-?\s*\*?\*?Blocks\*?\*?:\s*(.+?)\s*$", body, re.M)
        if m and m.group(1).strip() == package:
            out.append(q)
    return out


def allowed_policy_token(token):
    """True when a backticked token in the policy table names something real."""
    if token in TASK_FIELDS or token == LIVE_CHARACTERISTIC:
        return True
    if token.rstrip(":") in [f.rstrip(":") for f in CARD_FIELDS]:
        return True
    if token in SURFACES or token in ("yes", "no"):
        return True
    if token.endswith(".md") or token.startswith("make "):
        return True
    return False


def check_policy_table(root):
    """The prompt-selection table names the three real prompts and nothing else."""
    path = os.path.join(root, "AGENTS.md")
    if not exists(path):
        return                       # `red-lines` already reports the absence
    table = section_text(strip_fences(read(path)), POLICY_HEADING)
    if table is None:
        fail("task-policy", "AGENTS.md", "no `## %s` section; the characteristics in the plan "
             "select nothing without the table that reads them" % POLICY_HEADING)
        return
    seen = {}
    for line in table.splitlines():
        m = re.match(r"^\|\s*(\d+)\s*[\u2014-]\s*([^|]+?)\s*\|(.*)\|\s*$", line)
        if not m:
            continue
        number, name, run_when = m.group(1), m.group(2), m.group(3)
        if number in seen:
            fail("task-policy", "AGENTS.md", "prompt %s has two rows in the %s table"
                 % (number, POLICY_HEADING))
        seen[number] = name
        if number not in PROMPT_NAMES:
            fail("task-policy", "AGENTS.md", "the %s table names prompt %s, which does not exist; "
                 "the prompts are %s" % (POLICY_HEADING, number,
                                         ", ".join("%s (%s)" % (n, PROMPT_NAMES[n])
                                                   for n in sorted(PROMPT_NAMES))))
        elif name != PROMPT_NAMES[number]:
            fail("task-policy", "AGENTS.md", "prompt %s is %r in the %s table and %r in "
                 "SESSION_BOOTSTRAP_PROMPT_SAMPLE.md"
                 % (number, name, POLICY_HEADING, PROMPT_NAMES[number]))
        for token in re.findall(r"`([^`]+)`", run_when):
            if not allowed_policy_token(token):
                fail("task-policy", "AGENTS.md", "the %s table reads `%s`, which is not a task "
                     "characteristic; they are %s and %s"
                     % (POLICY_HEADING, token, ", ".join("`%s`" % f for f in TASK_FIELDS),
                        "`%s`" % LIVE_CHARACTERISTIC))
    missing = sorted(set(PROMPT_NAMES) - set(seen))
    if missing:
        fail("task-policy", "AGENTS.md", "the %s table has no row for prompt %s"
             % (POLICY_HEADING, ", ".join(missing)))


def check_task_policy(root, cards):
    derived = derive_characteristics(root, cards)
    plan = spec_by_role(root, "implementation-plan")
    rel = os.path.relpath(plan, root) if plan else SPECS_DIR
    packages = plan_package_blocks(root)
    for pkg, ln, block in packages:
        where = "%s:%d" % (rel, ln)
        stored = stored_characteristics(block)
        for field in TASK_FIELDS:
            values = stored.get(field, [])
            if not values:
                fail("task-policy", where, "%s states no `%s:`; a package without its "
                     "characteristics cannot be matched against the prompt-selection table "
                     "in AGENTS.md" % (pkg, field))
            elif len(values) > 1:
                fail("task-policy", where, "%s states `%s:` %d times; one line, one value"
                     % (pkg, field, len(values)))
        for field in BOOLEAN_FIELDS:
            value = (stored.get(field) or [None])[0]
            if value is not None and value not in ("yes", "no"):
                fail("task-policy", where, "%s has `%s: %s`; the value is `yes` or `no`"
                     % (pkg, field, value))
        surfaces = (stored.get("Surfaces") or [None])[0]
        if surfaces is not None and surfaces != EMPTY:
            unknown = [s for s in [p.strip() for p in surfaces.split(",")] if s not in SURFACES]
            if unknown:
                fail("task-policy", where, "%s has `Surfaces: %s`; %s is not a surface (%s), "
                     "and an empty set is written `%s`"
                     % (pkg, surfaces, ", ".join(unknown), ", ".join(SURFACE_ORDER), EMPTY))
        expected = derived.get(pkg, {})
        for field in DERIVED_FIELDS:
            value = (stored.get(field) or [None])[0]
            if value is None or field not in expected:
                continue
            if value != expected[field]:
                detail = ("the sections it cites are %s"
                          % (", ".join("`%s` \u00a7%s" % c for c in expected["cites"]) or "none")
                          if field == "Surfaces" else
                          "a red line cites %s"
                          % (", ".join("`%s` \u00a7%s" % c for c in expected["red hits"])
                             or "none of its sections"))
                fail("task-policy", where, "%s states `%s: %s`, but the pack derives `%s`: %s. "
                     "This characteristic is derived, not judged: correct the field, or the "
                     "citation that no longer holds" % (pkg, field, value, expected[field], detail))
    ok("task-policy", "%d work package(s) carry their characteristics" % len(packages))
    check_policy_table(root)


def report_tasks(root, cards, selector):
    """`--task`: the characteristics of one package or of all, derived live."""
    derived = derive_characteristics(root, cards)
    packages = [p for p, _, _ in plan_package_blocks(root)]
    if selector != "all":
        if selector not in derived:
            sys.stderr.write("check-docs: %s is not a work package in the implementation plan\n"
                             % selector)
            return 2
        packages = [selector]
    for pkg, ln, block in plan_package_blocks(root):
        if pkg not in packages:
            continue
        stored = stored_characteristics(block)
        contract = (stored.get("Contract change") or [EMPTY])[0] or EMPTY
        cards_blocking = blocked_by(cards, pkg)
        print("%-10s Surfaces: %-34s Touches red line: %-4s Contract change: %-4s %s: %s"
              % (pkg, derived[pkg]["Surfaces"], derived[pkg]["Touches red line"], contract,
                 LIVE_CHARACTERISTIC, ", ".join(cards_blocking) or EMPTY))
    return 0


# --- event log ---------------------------------------------------------------

def check_log(root):
    """chain-intact and projection-fresh. Both are properties of the log, not of
    a document, which is why they live here rather than in any prose rule."""
    log = os.path.join(root, ".log", "events.jsonl")
    if not exists(log):
        ok("chain-intact", "no event log in this repository; chain and projection not checked")
        return (0, True)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        import eventlog
    except ImportError:
        fail("chain-intact", ".log/events.jsonl", "scripts/eventlog.py is missing; the chain cannot be verified")
        return (0, False)

    lines = eventlog.read_lines(root)
    broken = eventlog.verify(lines)
    if broken:
        fail("chain-intact", ".log/events.jsonl:%d" % broken[0], broken[1])
        return (len(lines), False)   # nothing built from a broken chain is trustworthy
    ok("chain-intact", "%d record(s), every hash and link verified" % len(lines))

    records = [json.loads(line) for line in lines]
    projections = (("DECISIONS.md", eventlog.render_decisions, "rebuild-decisions", "decided"),
                   ("QUESTIONS.md", eventlog.render_questions, "rebuild-questions", "asked or answered"))
    for target, render, command, verb in projections:
        path = os.path.join(root, target)
        if not exists(path):
            continue                 # its own rule already reported the absence
        try:
            rendered = render(records)
        except eventlog.LogError as exc:
            fail("projection-fresh", target, "the stream cannot be projected: %s" % exc)
            continue
        if read(path) != rendered:
            fail("projection-fresh", target,
                 "differs from a fresh rebuild of the log; run `make %s`. "
                 "This file is a projection: an edit here changes nothing that was %s" % (command, verb))
        else:
            ok("projection-fresh", "%s equals the rebuild, byte for byte" % target)
    return (len(lines), True)


# --- markers -----------------------------------------------------------------

def check_markers(root, docs):
    for doc in docs:
        rel = os.path.relpath(doc, root)
        for ln, line in enumerate(read(doc).splitlines(), 1):
            if re.search(r"\{\{[^}]*\}\}", line):
                fail("markers", "%s:%d" % (rel, ln), "unrendered placeholder")
            if re.search(r"\bTBD\b", line):
                fail("markers", "%s:%d" % (rel, ln), "`TBD` left in a document")


# --- main --------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="Mechanical consistency checks for the documentation layer.")
    ap.add_argument("--root", default=".", help="repository root (default: current directory)")
    ap.add_argument("--quiet", action="store_true", help="print only failures and the summary")
    ap.add_argument("--only", default=None, metavar="RULE,RULE",
                    help="report failures of these rules only (e.g. citations,markers,decisions,cards)")
    ap.add_argument("--task", default=None, metavar="PACKAGE|all",
                    help="print the characteristics of a work package (derived) and the cards "
                         "blocking it (live) instead of running the rules")
    args = ap.parse_args()
    root = os.path.abspath(args.root)
    only = set(r.strip() for r in args.only.split(",")) if args.only else None

    if args.task:
        # A reader, not a gate: it answers "what kind of task is this" without
        # judging the pack, so an orchestrator can apply the table in AGENTS.md.
        cards, _, _ = parse_cards(root)
        return report_tasks(root, cards, args.task)

    docs = [os.path.join(root, d) for d in ROOT_DOCS if exists(os.path.join(root, d))]
    specs = spec_files(root)
    readme = os.path.join(root, SPECS_DIR, "README.md")
    all_docs = docs + specs + ([readme] if exists(readme) else [])

    numbered, named = section_index(root)
    check_citations(root, all_docs, numbered, named)
    pkgs, phases, rows = check_packages_and_traceability(root)
    check_plan(root, rows)
    gaps = check_gaps(root, pkgs, phases)
    dids = check_decisions(root)
    cards, resolved, superseded = parse_cards(root)
    per_surface = check_cards(cards)
    check_register(root, resolved)
    inferred = check_provenance(root, all_docs, cards, resolved, dids, superseded)
    is_frozen = frozen(root)
    check_normative(root, adopted_pack(root))
    check_inferred(inferred, is_frozen)
    provisional = provisional_citations(root, specs, cards)
    check_agents(root)
    check_task_policy(root, cards)
    events, chain_ok = check_log(root)
    makefile = os.path.join(root, "Makefile")
    check_markers(root, all_docs + ([makefile] if exists(makefile) else []))

    dropped = 0
    if only is not None:
        kept = [f for f in failures if f.split()[1] in only]
        dropped = len(failures) - len(kept)
        failures[:] = kept
    if not args.quiet:
        for n in notes:
            print(n)
    for f in failures:
        print(f)
    print()
    if only is not None:
        print("summary: %d failure(s) in %s; %d failure(s) of other rules dropped by --only"
              % (len(failures), ",".join(sorted(only)), dropped))
    else:
        print("summary: %d failure(s)" % len(failures))
    print("cards per surface (open/resolved): " + ", ".join(
        "%s %d/%d" % (s, per_surface[s][0], per_surface[s][1]) for s in ["data", "security", "scope", "external", "ux"]))
    print("[inferred] statements in specs: %s" % (", ".join("%s %d" % kv for kv in sorted(inferred.items())) or "none"))
    if provisional:
        print("provisional statements (citing a card not yet Resolved)%s: %s" % (
            " in a FROZEN pack, a deliberate deferral" if is_frozen else "",
            ", ".join("%s:%d %s" % x for x in provisional)))
    else:
        print("provisional statements (citing a card not yet Resolved): none")
    print("open gaps: %d" % gaps)
    print("event log: %d record(s), chain %s" % (events, "intact" if chain_ok else "BROKEN"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
