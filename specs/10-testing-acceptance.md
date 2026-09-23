# 10 — Testing and Acceptance

The gates every change passes, the scenarios that prove the MVP, and the devices it is accepted on.

## 1. Quality gates

Every change MUST pass these gates through the root `Makefile`, locally and in CI: [D-011]

- `make lint`, `make format-check`, `make typecheck`;
- `make test`: Vitest unit and integration tests for `server`, `client` and `shared`;
- `make e2e`: Playwright end-to-end tests against a running server;
- `make build`: production build of the client and server;
- `make check-docs`: consistency of the documentation pack.

## 2. Test layers

- Unit tests MUST cover the pure domain logic: command validation, inverse commands and undo, role projection, numbering, snapping, ruler distances under both diagonal rules, grid scaling. [D-011]
- Integration tests MUST run against a real SQLite file in a temporary data directory, never a mock of the database. [D-009, D-011]
- End-to-end tests MUST drive a DM view and a player view in two browser contexts at once against a running server. [D-011]

## 3. Hidden-information acceptance

- A test MUST record every message and image response a player view receives across a scripted session (add hidden tokens, reveal, hide, move, delete, undo, activate another scene, reconnect) and assert that no hidden token's ID, asset, image or count appears in it (`04` §4, `07` §5). [Q-067, D-042]
- A test MUST assert that every command sent from the players room is rejected and changes nothing (`07` §3). [Q-068, D-042]
- A test MUST assert that an image a player once fetched is refused after its token is hidden (`07` §5). [Q-012, recommendation accepted]
- The large-scene fixture MUST be a generated 10,000 × 7,000 px map with 50 tokens, plus a map-less scene; no third-party art enters the repository. [Q-060, Q-088]

## 4. Acceptance devices

- The player view MUST be accepted on current Chrome, Edge, Firefox and Safari on a device driving the TV or projector. [Q-019, recommendation accepted]
- The player view MUST also be accepted on the owner's LG TV, in its built-in webOS browser, loading the large-scene fixture, before the player view is accepted; this run confirms the display-version size (`05` §7). [Q-019, recommendation accepted]
- The DM view MUST be accepted on current Chrome, Edge, Firefox and Safari on a laptop or desktop (`08` §7). [Q-029, Q-019]
- The server MUST pass the acceptance scenarios on Windows and on Linux (`09` §3). [Q-018, recommendation accepted]

## 5. Acceptance scenarios

The MVP MUST be accepted when each critical journey of `08` §10 passes end to end, together with the gates of §1–§3 and §6: [input, Q-061, Q-065, Q-006, Q-007, Q-008, Q-020, Q-025, Q-027]

- first run: start, set the PIN from localhost, a LAN browser cannot set it;
- prepare: campaign, session, a scene from a map and a map-less scene, each calibration method, tokens added through the picker with automatic numbering, some hidden;
- connect: the TV opens the typed URL and shows the idle screen;
- run: go live, move, reveal, hide, delete, undo, measure (visible on the TV), steer the player camera, edit the next scene in prep mode with nothing reaching the TV, go live on it, blank the TV;
- recover: kill the network of the player device and of the DM laptop, restore it, and both return to the current state without a PIN prompt.

## 6. Offline acceptance

- End-to-end tests MUST run with outbound traffic beyond the local host blocked, and pass (`02` §6). [Q-020]
- The build MUST fail when the built client references an external URL for scripts, styles, fonts or images. [Q-020]
