# ws

Socket.io handlers, rooms and role projection (`specs/02-architecture.md` §1).

- `live.ts`: the Socket.io server on the HTTP server's port, WebSocket only; the Origin check on the handshake; `dm` or `players` from the DM session cookie alone; the snapshot on connection and on the `snapshot` channel; the room check before any command; the sockets of an ended session dropped at once (LIV-01, D-104).
- `snapshot.ts`: each room's `scene.snapshot`, read from the database; the players' projection, visible tokens only with the fields of `specs/04-live-sync.md` §4 and a stacking rank among visible tokens (D-104, G-025).

The envelopes, channel names and snapshot schemas are in `shared/src/live.ts`; command validation is `server/src/domain/commands.ts` (D-064).
