# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### PRP-01 — DM workspace shell

- **Outcome:** at `/dm` the DM sets the first PIN (on the server PC only), enters it and signs out, and works in one workspace: the Campaign → Session → Scene tree on the left (create, rename, delete with a confirmation that states what goes, reorder sessions and scenes by dragging or by keyboard, campaigns by name), the asset library on the right (search, filter, create with an upload, edit, delete, a refusal naming the scenes), and a live bar on top naming the live scene or saying that nothing is live.
- **Specs:** `13` §5 PRP-01, `08` §1, `07` §1, `07` §2, `07` §6, `05` §1, `05` §4, `05` §6, `08` §6, `08` §7, `08` §8; D-078, D-079, D-083; G-007, G-014, G-017.
- **Dependencies:** SRV-02 (PIN, sessions), SRV-03 (tree routes), SRV-04 (uploads), SRV-05 (library routes); FND-04 (catalogue, components).
- **Acceptance (executable):**
  - Component or e2e test: before a PIN exists, a DM view on the server PC offers setup and one opened from the LAN says setup happens on the server PC and offers nothing else (`07` §1); with a PIN, the view asks for it, shows a wrong PIN and a lockout with their messages, and signs out (`07` §2, `07` §6).
  - Every `ERROR_CODES` entry has a catalogue message, checked by a test (G-014); no raw code is ever shown.
  - The tree creates, renames and deletes campaigns, sessions and scenes; the delete dialog shows the counts and the live warning of `GET …/deletion` and sends them back (D-078); a create button is disabled while its request runs (G-014); sessions and scenes reorder by dragging and by keyboard, each with a test (Q-089); campaigns are listed by name (Q-090, D-079).
  - The library lists, searches and filters as `05` §1; creating an asset uploads its image and creates it in one action, and a file over `upload_limit_bytes` is refused before sending with the limit named (G-017); an `asset_in_use` refusal lists the scenes of `error.usages` (D-083).
  - The live bar names the live scene, or says nothing is live.
  - The core actions are keyboard-operable (`08` §8); an e2e test runs the whole shell against a real server; `make verify` exit 0 on both CI runners; `TRACEABILITY.md` PRP-01 row with test names.
- **Non-goals:** the canvas and grid (PRP-02, PRP-03), tokens (PRP-04), going live and the TV frame (LIV-01 onward), the settings screen (REL-01).
- **Review:** `Surfaces: security, ux`, `Touches red line: yes`, so prompt 2 (review) runs after implementation.

## Next

1. **PRP-02 — Canvas and grid overlay.** Map background with zoom and pan in both views, grid overlay with player visibility, map-less scenes (`13` §5, `08` §3, `06` §2, `03` §6).
