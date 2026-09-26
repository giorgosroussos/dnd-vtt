# domain

Commands, events, undo and live state (`specs/02-architecture.md` §1).

- `commands.ts`: validation and dispatch of WebSocket commands against the shared envelope and per-command payload schemas (FND-03, D-047, D-064). LIV-02 registers the payload schemas of the live commands (`LIVE_COMMAND_PAYLOAD_SCHEMAS` in `shared/src/live.ts`); `camera.setPlayer`, the ruler and `undo` are refused as `command_unsupported` until their packages register theirs. The socket layer refuses every players' command before validation (`server/src/ws/live.ts`, D-104).
- `live.ts`: the live commands applied to the database, one transaction each, last write wins, answering their effects in the DM's terms or the error envelope having changed nothing (LIV-02, D-109).
- `version.ts`: the live event version counters, one per room, each starting at 1 (`specs/04-live-sync.md` §5, Q-093, D-108). The socket layer takes version 1 of each for the state at start-up, and a snapshot sent to one socket carries its room's current version without taking one (D-104).
- Token numbering is `nextLabel` in `shared/src/numbering.ts` (`specs/05-assets-and-images.md` §3, D-019, Q-091), used by the REST placement of PRP-04, the DM view's test server and the live `token.add` and `token.setVisibility` (LIV-02).
