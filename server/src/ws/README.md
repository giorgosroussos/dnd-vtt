# ws

Socket.io handlers, rooms and role projection (`specs/02-architecture.md` §1).

- `live.ts`: the Socket.io server on the HTTP server's port, WebSocket only; the Origin check on the handshake; `dm` or `players` from the DM session cookie alone; the snapshot on connection and on the `snapshot` channel; the room check before any command; the sockets of an ended session dropped at once (LIV-01, D-104); the player view's hint that only lowers a socket to `players` (D-105); stray upgrades answered 404 and closed, snapshot requests throttled, unread queues dropped and connection lines limited (D-106).
- `projection.ts`: what each room receives of a live command's effect: everything for `dm`; for `players` visible tokens only, a reveal as `token.added`, a hide as the same `token.removed` a deletion sends, tokens in the player shape ranked among visible tokens (LIV-02, D-109). `live.ts` emits each with its room's next version and acknowledges the sender after.
- `testing/harness.ts`: a live server and real Socket.io clients for the tests, and the players' copy a client keeps from snapshot and events.
- `snapshot.ts`: each room's `scene.snapshot`, read from the database; the players' projection, visible tokens only with the fields of `specs/04-live-sync.md` §4 and a stacking rank among visible tokens (D-104, G-025).

The envelopes, channel names and snapshot schemas are in `shared/src/live.ts`; command validation is `server/src/domain/commands.ts` (D-064).
