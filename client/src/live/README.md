# live

The live connection both views keep (LIV-01, `specs/04-live-sync.md` §5, §6, D-104).

- `versions.ts`: gap detection, pure: an event applies only when it is exactly the next version; anything else asks for a fresh snapshot.
- `connection.ts`: the Socket.io client, WebSocket only, reconnecting by itself; a snapshot request on a gap; an immediate reconnection when the server ended the socket (its session ended). Tests replace the socket through `setSocketFactory` (`client/src/ui/testing/fakeSocket.ts`).
- `useLive.ts`: the connection's status and latest snapshot for a mounted view.

The player view keeps its own connection through `client/src/player/usePlayerLive.ts`, which applies the players' events to what it draws (`client/src/player/scene.ts`, LIV-03, D-112).
