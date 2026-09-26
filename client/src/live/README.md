# live

The live connection both views keep (LIV-01, `specs/04-live-sync.md` §5, §6, D-104).

- `versions.ts`: gap detection, pure: an event applies only when it is exactly the next version; anything else asks for a fresh snapshot.
- `connection.ts`: the Socket.io client, WebSocket only, reconnecting by itself; a snapshot request on a gap; an immediate reconnection when the server ended the socket (its session ended); the DM view's commands, sent only while connected and answered by their acknowledgement (LIV-04). Tests replace the socket through `setSocketFactory` (`client/src/ui/testing/fakeSocket.ts`).

The player view keeps its own connection through `client/src/player/usePlayerLive.ts`, which applies the players' events to what it draws (`client/src/player/scene.ts`, LIV-03, D-112).

The DM workspace keeps its connection through `client/src/dm/live/useDmLive.ts`, which applies the `dm` room's events to the live scene the live bar and the live canvas show (`client/src/dm/live/dmScene.ts`, LIV-04).
