# domain

Commands, events, undo and live state (`specs/02-architecture.md` §1).

- `commands.ts`: validation and dispatch of WebSocket commands against the shared envelope and per-command payload schemas (FND-03, D-047, D-064). No payload schema is registered yet, so every command is refused as `command_unsupported` until LIV-01 onward register theirs.
- `version.ts`: the process-wide live event version counter, starting at 1 (`specs/04-live-sync.md` §5, D-017).
