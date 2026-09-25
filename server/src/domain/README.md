# domain

Commands, events, undo and live state (`specs/02-architecture.md` §1).

- `commands.ts`: validation and dispatch of WebSocket commands against the shared envelope and per-command payload schemas (FND-03, D-047, D-064). No payload schema is registered yet, so every DM command is refused as `command_unsupported` until LIV-02 registers the live commands; the socket layer refuses every players' command before validation (`server/src/ws/live.ts`, D-104).
- `version.ts`: the live event version counters, one per room, each starting at 1 (`specs/04-live-sync.md` §5, Q-093, D-108). The socket layer takes version 1 of each for the state at start-up, and a snapshot sent to one socket carries its room's current version without taking one (D-104).
- Token numbering is `nextLabel` in `shared/src/numbering.ts` (`specs/05-assets-and-images.md` §3, D-019, Q-091), used by the REST placement of PRP-04, the DM view's test server and, from LIV-02, by `token.add`.
