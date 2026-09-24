# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### SRV-05 — Asset library over REST

- **Outcome:** with a DM session, the DM creates, lists, updates and deletes assets of the shared library: name, image, category, size, tags and notes, with default visibility from the category; the list searches name and tags and filters by category and by tags; an asset in use cannot be deleted and the refusal names the scenes that use it; changing an asset's image changes every token of it.
- **Specs:** `13` §4 SRV-05, `02` §5 (`/api/assets`), `03` §2, `03` §7, `05` §1, `05` §2, `05` §4, `05` §5; D-020, D-022, D-075, D-080, D-083, D-084; G-009 and G-016 (closed by D-083 and D-084).
- **Status:** implemented on branch `srv-05-asset-library` with every acceptance test green locally (`TRACEABILITY.md`); remaining: CI green on both runners, then the review pass.
- **Dependencies:** SRV-01 (schema), SRV-02 (session guard), SRV-04 (images, `deleteUnreferencedImages`).
- **Acceptance (executable):**
  - Vitest against a real SQLite file: create, read, update and list assets with server-generated lowercase UUIDs; a body naming its own id or an unknown field is refused and stores nothing; an image that does not exist is refused and stores nothing.
  - A new `monster` asset defaults to hidden and `pc`, `npc` and `object` to visible, and `default_hidden` can be changed per asset (`05` §4, D-020).
  - Search is a substring match over name and tags; the category filter and the tag filter narrow (every selected tag must match); results are sorted by name (`05` §1, D-022, Q-064), each with a test.
  - Tag case is decided and recorded, with a test (G-009).
  - Deleting an asset used by a token is refused and names every scene that uses it, changing nothing; deleting an unused asset removes it with its tags, and its image when nothing else references it, with its files (`03` §7, Q-002).
  - Changing an asset's image changes the image of every token of that asset, and the old image is removed when nothing references it any more (`05` §5).
  - Every route answers 401 without a DM session (the identical-answer test picks it up from `app.declaredRoutes`); `make verify` exit 0 on both CI runners; `TRACEABILITY.md` SRV-05 row with test names.
- **Non-goals:** the library and picker UI (PRP-01 onward), tokens on a scene (PRP-04), propagating an image change to the live scene over WebSocket (LIV-04).
- **Review:** `Surfaces: security, ux`, `Contract change: yes`, so prompt 2 (review) runs after implementation.

## Next

1. **PRP-01 — DM workspace shell.** The sidebar tree over the SRV-03 routes with the deletion dialog and error-code messages of G-014; sessions and scenes reorderable, campaigns listed by name (Q-090, D-079); uploads checked against `upload_limit_bytes` before sending (G-017) (`13` §5, `08` §1, `07` §1).
