# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### SRV-04 — Image upload pipeline

- **Outcome:** with a DM session, the DM uploads a PNG, JPEG or WebP image and the server stores it once under the sha256 of its bytes, with a WebP display version and thumbnail; anything else, or anything over the limit, is refused with its reason and stores nothing. An image nothing references any more is removed with its files.
- **Specs:** `13` §4 SRV-04, `02` §5 (`/api/images`), `02` §7, `03` §3 (sha256 identity, reuse), `03` §7 (removal of unreferenced images), `05` §6, `05` §7, `07` §5 (DM fetches every version; players are LIV-02); D-021, D-032, D-044, D-075, D-078; G-009, G-013.
- **Dependencies:** SRV-01 (schema), SRV-02 (session guard), SRV-03 (scene deletion paths, `deleteEntity`).
- **Acceptance (executable):**
  - Vitest against a real SQLite file and images folder: PNG, JPEG and WebP judged by content are accepted; a renamed or forged file (wrong magic bytes, a PNG extension on a GIF, truncated data) is refused with 415 and the type named; nothing is written to the database or the images folder.
  - An upload over `upload_limit_bytes` is refused with 413 while it is received, before processing (D-044), and stores nothing; the limit is read from settings, so a lowered limit takes effect without a restart.
  - The image id is the lowercase sha256 of the original bytes; uploading the same bytes again returns the existing image and its grid preset and writes no second file.
  - The display version's long edge is at most `display_variant_size` and never upscaled, the thumbnail's is 256 px, both WebP; `image.variants` validates against `ImageVariantsSchema` (G-009); regenerating display versions after a setting change is a function with its own test.
  - Files are received into a temporary location and moved into place only after validation and processing succeed (D-032); a failure midway leaves no file and no row.
  - `GET /api/images/:id` returns metadata and the grid preset; `PUT` updates the preset. With a DM session every version is fetchable at `/images/<sha256>/<variant>`; without one every image request answers not found until LIV-02 adds player entitlement (`07` §5).
  - Deleting a scene, session or campaign (SRV-03) removes each image no asset or scene references any more, its files and its preset (G-013), with a test per deletion path; an image still referenced stays.
  - Every route answers 401 without a DM session (the identical-answer test picks it up from `app.declaredRoutes`); `make verify` exit 0 on both CI runners; `TRACEABILITY.md` SRV-04 row with test names.
- **Non-goals:** player image entitlement following the live scene (LIV-02), the settings screen that changes the display size (REL-01), the library UI (PRP-01), acceptance of the display size on the owner's TV (REL-03, G-002).
- **Review:** `Surfaces: data, security, scope`, `Touches red line: yes`, `Contract change: yes`, so prompt 2 (review) runs after implementation.
- **Remaining (2026-09-24):** implemented and reviewed (D-080 to D-082, `TRACEABILITY.md` SRV-04 row); CI run 36007512379 failed on `test · windows` (ECONNRESET, fixed by D-082). The item leaves `Now` once CI is green on Linux and Windows.

## Next

1. **SRV-05 — Asset library over REST.** Search and tag filter, create, update, delete refused while in use with the scenes listed, tag case decided (G-009) (`13` §4, `05` §1, `05` §2, `05` §4, `05` §5).
2. **PRP-01 — DM workspace shell.** The sidebar tree over the SRV-03 routes with the deletion dialog and error-code messages of G-014; sessions and scenes reorderable, campaigns listed by name (Q-090, D-079) (`13` §5, `08` §1, `07` §1).
