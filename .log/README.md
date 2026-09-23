# The event log

`events.jsonl` is an append-only, hash-chained log. One JSON object per line, keys in a fixed order:

| Field | Meaning |
| --- | --- |
| `seq` | 1-based, contiguous. A gap is a break. |
| `ts` | ISO-8601 UTC, when the event was recorded |
| `actor` | `agent` or `owner` |
| `stream` | which stream the event belongs to: `decisions` or `questions` |
| `type` | event type within the stream |
| `payload` | the event's data, exactly the fields its projection renders |
| `prev` | sha256 of the previous record's canonical form, 64 zeros at `seq` 1 |
| `hash` | sha256 of this record's canonical form |

## Canonical form

Hashes are computed over the record, not over the bytes of the line: take the record without its `hash` field, serialize it as JSON with sorted keys and no insignificant whitespace, UTF-8, concatenate the literal `prev` string, and sha256 the result. A line may therefore be reformatted without invalidating anything, and a verification run does not depend on the file's whitespace. `scripts/eventlog.py` is the one implementation of that rule.

## Streams and projections

A stream is a sequence of events about one thing. A projection is a file rendered from a stream, deterministically: same log, same bytes.

| Stream | Projection | Rebuilt by |
| --- | --- | --- |
| `decisions` | `DECISIONS.md` | `scripts/rebuild-decisions.py` (`make rebuild-decisions`) |
| `questions` | `QUESTIONS.md` | `scripts/rebuild-questions.py` (`make rebuild-questions`) |

Both streams share this one file and one contiguous `seq`; each projection folds only the records of its own stream. A projection is never authored. `make check-docs` renders both again and compares byte for byte (`projection-fresh`), so an edit made by hand in `DECISIONS.md` or `QUESTIONS.md` fails the gate instead of becoming the record. To change what a projection says, append an event.

## What this guarantees, and what it does not

**It guarantees**: any change to a record already in the log is detectable. Editing one character changes that record's hash, and every later record's `prev` stops matching, so `make verify-chain` names the first broken link. Removing a line is caught earlier still, by the append-only rule in `.doc-locks`, which the pre-commit and pre-receive hooks enforce.

**It does not guarantee authorship.** Anyone who can run this tooling can write a well-formed new record, and anyone who can rewrite the file can rewrite the chain from a chosen point and recompute every hash after it. The same holds for `UNLOCKS.md`, the ledger of the lock ceremony: it proves that a reason was recorded, not who approved it. The threat model is an agent editing history by accident, and a silent rewrite passing unnoticed in review. It is not a motivated adversary. Signing the records, or keeping the head hash somewhere the repository cannot reach, would be a different mechanism; this is not it.

## Commands

```bash
make verify-chain        # recompute every hash and link, naming the first break
make rebuild-decisions   # render DECISIONS.md from the log
make rebuild-questions   # render QUESTIONS.md from the log
make check-docs          # includes chain-intact and projection-fresh
```

Appending is `scripts/log-append.py`, the only sanctioned writer. It refuses to append onto a chain that does not verify, so a break is never buried under later records; it refuses an event no projection could fold, and a decision whose text cites a section that an existing spec does not have, because on an append-only log neither could ever be taken back. A record that turns out wrong is retired by `decision-superseded`: its text stays readable as history, and `check-docs` stops checking the citations inside it.
