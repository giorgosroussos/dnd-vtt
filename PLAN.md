# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### LIV-01 — WebSocket rooms, snapshots and reconnection

- **Outcome:** the one Node process serves Socket.io on its own port, refusing a handshake whose Origin does not match the host (`07` §2, Q-043); a socket carrying a valid DM session cookie joins `dm`, every other socket joins `players`, the role derived only from the session (`04` §1, `07` §7, Q-046); each receives a `scene.snapshot` for its role on connection, the idle state while nothing is live (`04` §5, `08` §4); every event carries an ascending version from the process counter starting at 1 (D-017, Q-056), and a client that sees a gap asks for a fresh snapshot; clients reconnect by themselves after sleep or network loss and resynchronise, a DM socket keeping its role without a PIN prompt (`04` §6, Q-008); a PIN change or a sign-out disconnects the ended session's sockets at once (G-011); a command from `players` is rejected over the wire in the shared envelope (`04` §2, D-064, D-068).
- **Specs:** `13` §6 LIV-01, `04` §1, `04` §2, `04` §4, `04` §5, `04` §6, `07` §2, `07` §3, `07` §7, `07` §8, `02` §2; D-017, D-039, D-064, D-068, D-076; Q-046, Q-056, Q-008.
- **Dependencies:** FND-03 (envelopes, version counter, command validation, D-064), SRV-02 (DM sessions and the session store, D-076), PRP-04 (tokens and their DM shape, D-100).
- **Acceptance (executable):**
  - Vitest against a real SQLite file and a real Socket.io client: a socket with the DM cookie joins `dm`, one without, with a forged cookie or with an ended session joins `players`; a mismatched Origin is refused; each role receives its snapshot on connection; with a live scene set in the database the `players` snapshot carries only the fields of `04` §4 and no hidden token, id, image or count (hidden-information case), the `dm` one every token; versions ascend across events; a gap leads to a fresh snapshot; a `players` command is refused in the envelope and changes nothing; a PIN change and a sign-out drop the other device's socket at once; log lines name the role and never a session id (`07` §8); `shared` contract types for the snapshot and the snapshot request.
  - Client: automatic reconnection and resynchronisation from a fresh snapshot, with no PIN prompt for a DM socket; gap detection unit-tested.
  - Playwright: a DM context and a player context connect side by side; a player context taken offline and back resynchronises; `make verify` exit 0 on both CI runners; `TRACEABILITY.md` LIV-01 row with test names.
- **Non-goals:** live commands and activation (LIV-02); drawing the live scene on the player view (LIV-03); live and prep modes in the DM view (LIV-04); the players' projection beyond what a snapshot carries (LIV-02, G-025).
- **Review:** `Surfaces: data, security`, `Contract change: yes`, so prompt 2 (review) runs after implementation.
- **Status:** implemented and verified locally, `make verify` exit 0 (D-104, `TRACEABILITY.md` LIV-01). Remaining before `done`: the review (prompt 2), then `make verify` on both CI runners.

## Next

1. **LIV-02 — Live commands and role projection.** `token.add`, `token.move`, `token.setVisibility`, `token.delete`, `scene.activate` and `scene.deactivate` from the `dm` room, events to each room as `04` §3 states, the strict player token shape and players' image entitlement; closes G-020, G-023 and G-025 (`13` §6, `04` §2, `04` §3, `04` §4, `07` §5). Q-093 (how event versions are counted so that the players room never sees a version it did not receive) must be answered first: LIV-02's events are the first that differ between rooms.
