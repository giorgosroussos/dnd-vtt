# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### PRP-01 — DM workspace shell, part 1: sign-in and the scene tree

- **Outcome:** at `/dm` the DM sets the first PIN on the server PC (a DM view opened from the LAN says setup happens there and offers nothing else), enters the PIN, sees a wrong PIN and a lockout explained, and signs out; signed in, the workspace shows the Campaign → Session → Scene tree in the left sidebar, where campaigns, sessions and scenes are created, renamed and deleted after a confirmation that states what goes and warns when the live scene is among it, and sessions and scenes are reordered by dragging and by keyboard, campaigns listed by name.
- **Specs:** `13` §5 PRP-01, `08` §1, `08` §6, `08` §7, `08` §8, `07` §1, `07` §2, `07` §6, `03` §7; D-069, D-072, D-073, D-076, D-078, D-079; G-007, G-014.
- **Dependencies:** SRV-02 (PIN, sessions), SRV-03 (tree routes); FND-04 (catalogue, components, keyboard and contrast gates).
- **Acceptance (executable):**
  - Component tests (jsdom): no PIN and a server-PC browser shows setup; no PIN and a LAN browser shows only that setup happens on the server PC (`07` §1); with a PIN, the PIN form shows a wrong PIN and a lockout with its wait, and a correct PIN opens the workspace; sign-out returns to the PIN form (`07` §2, `07` §6).
  - Every `ERROR_CODES` entry has a catalogue message, checked by a test; no raw error code reaches the screen (G-014).
  - The tree creates, renames and deletes campaigns, sessions and scenes; the delete dialog shows the counts and the live warning of `GET …/deletion` and sends them back, and a `confirmation_mismatch` shows the new counts instead of deleting (D-078); a create button is disabled while its request runs (G-014); sessions and scenes reorder by dragging and by a keyboard alternative, each with a test (Q-089); campaigns are listed by name (Q-090, D-079).
  - Playwright against the production build: the First run journey (set the PIN on the server PC, open `/dm`, sign out, sign in) and a tree built, renamed, reordered by drag and by keyboard, and deleted through the dialog; the keyboard and contrast gates of D-072 run over the signed-in workspace.
  - `make verify` exit 0 on both CI runners; `TRACEABILITY.md` PRP-01 row with test names.
- **Non-goals:** the library panel and the live bar (part 2), the canvas (PRP-02), PIN change (REL-01 settings screen), the view loading and reconnecting states beyond what sign-in needs (G-007).
- **Review:** `Surfaces: security, ux`, `Touches red line: yes`, so prompt 2 (review) runs after implementation.
- **Status:** implemented on branch `prp-01-signin-tree` with every acceptance test green locally (D-085, D-086, `TRACEABILITY.md`); remaining: CI green on both runners, then the review pass.

### PRP-01 — DM workspace shell, part 2: the library panel and the live bar

- **Outcome:** the asset library in the right-hand panel lists, searches and filters assets (`05` §1), creates one with its image uploaded in the same action, edits and deletes it, and lists the scenes of an `asset_in_use` refusal; a file over `upload_limit_bytes` is refused before it is sent, with the limit named; the live bar names the live scene or says nothing is live.
- **Specs:** `13` §5 PRP-01, `08` §1, `05` §1, `05` §4, `05` §6, `08` §8; D-083, D-084; G-014, G-017.
- **Dependencies:** part 1; SRV-04, SRV-05.
- **Acceptance (executable):** component tests of search, category and tag filters, create with upload, edit, delete and the in-use refusal; the size check before sending with the limit named (G-017); the live bar with and without a live scene; a Playwright run creating an asset from a generated image; `make verify` exit 0 on both CI runners.
- **Review:** as part 1.

## Next

1. **PRP-02 — Canvas and grid overlay.** Map background with zoom and pan in both views, grid overlay with player visibility, map-less scenes (`13` §5, `08` §3, `06` §2, `03` §6).
