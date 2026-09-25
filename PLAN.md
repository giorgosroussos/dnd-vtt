# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### PRP-03 — Grid calibration

- **Outcome:** the DM calibrates the grid of a scene with a map by the three methods of `06` §1, each with the overlay following live: known dimensions (columns × rows), a rectangle dragged over N × N drawn squares, and fine tuning of a decimal square size and the x/y offset with the arrow keys; a magnified view of the map's far corner is shown throughout. The grid is stored in original-image pixels (`06` §2), and calibrating also updates the image's preset, so later scenes of that map start from it while other existing scenes keep their own grid (`03` §5). Replacing a calibrated map asks for a confirmation that says the calibration goes (D-093). A map-less scene keeps its columns × rows extent and offers no calibration (`03` §6, D-016).
- **Specs:** `13` §5 PRP-03, `06` §1, `06` §2, `06` §3, `03` §4, `03` §5, `03` §6, `05` §7, `04` §10; D-016, D-026, D-090, D-093; G-019.
- **Dependencies:** PRP-02 (pull request `prp-02-canvas-grid`: the canvas, `geometry.ts`, `PATCH /api/scenes/:id`), SRV-04 (`PUT /api/images/:id/preset`).
- **Acceptance (executable):**
  - Vitest against a real SQLite file: `PATCH /api/scenes/:id` takes the calibration fields of `grid` (size, offsets, columns, rows) for a scene with a map, keeping a decimal size exactly; refuses a size on a map-less scene and stores nothing; writes the image's preset in the same transaction; changes no other existing scene and no token position (`03` §4, §5); `shared` contract types updated. Whether feet per square (`03` §1, `06` §5) is set here is decided in a D-entry.
  - Component tests: each method yields the expected grid in original pixels from known inputs (known dimensions: size = original width ÷ columns; the rectangle's display coordinates converted to original pixels, size = its side ÷ N, offset from its corner; fine tuning steps size and offsets by keyboard, decimal); the overlay follows every change before it is saved; the magnifier shows the far corner (the original is the calibration version, `05` §7, and only a DM session may fetch it, `07` §5).
  - Replace map on a calibrated scene confirms first and changes nothing when cancelled.
  - Playwright: calibrate a generated map with a drawn grid by each method, see the overlay on the drawn lines, reload unchanged; a new scene of the same map starts from the preset while the first scene keeps its grid; the keyboard and contrast gates pass; `make verify` exit 0 on both CI runners; `TRACEABILITY.md` PRP-03 row with test names.
- **Non-goals:** automatic grid detection and hex grids (`06` §6); tokens (PRP-04); pushing a live scene's calibration to players (LIV-04, G-019).
- **Review:** `Surfaces: data`, `Touches red line: yes`, so prompt 2 (review) runs after implementation. `13` §5 marks `Contract change: no`, but the scene update body gains the calibration fields (D-090); treat it as a contract change.

## Next

1. **PRP-04 — Tokens in preparation.** Add flow through the picker, automatic numbering, sizes, default visibility; drag with snap and Alt free placement; hide, reveal, delete, label and stacking order on scenes that are not live (`13` §5, `05` §3, `05` §4, `05` §5, `06` §4, `04` §2).
