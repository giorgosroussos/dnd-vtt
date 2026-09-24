# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### PRP-01 — DM workspace shell, part 2: the library panel and the live bar

- **Outcome:** the asset library in the right-hand panel lists, searches and filters assets (`05` §1), creates one with its image uploaded in the same action, edits and deletes it, and lists the scenes of an `asset_in_use` refusal; a file over `upload_limit_bytes` is refused before it is sent, with the limit named; the live bar names the live scene or says nothing is live.
- **Specs:** `13` §5 PRP-01, `08` §1, `05` §1, `05` §4, `05` §6, `08` §8; D-083, D-084; G-014, G-017.
- **Dependencies:** part 1 (merged, pull request #9: sign-in, the workspace, the tree, `dm/api.ts`, `ui/errorMessage.ts`, D-085 to D-087); SRV-04, SRV-05.
- **Acceptance (executable):** component tests of search, category and tag filters, create with upload, edit, delete and the in-use refusal; the size check before sending with the limit named (G-017); the live bar with and without a live scene; a Playwright run creating an asset from a generated image; `make verify` exit 0 on both CI runners.
- **Review:** as part 1.
- **Status:** implemented, CI green on both runners (run 36047778005) and reviewed (D-088, D-089, `TRACEABILITY.md`); G-014 closed, G-017 and G-018 narrowed; leaves `Now` once the review fixes are green in CI.

## Next

1. **PRP-02 — Canvas and grid overlay.** Map background with zoom and pan in both views, grid overlay with player visibility, map-less scenes (`13` §5, `08` §3, `06` §2, `03` §6).
