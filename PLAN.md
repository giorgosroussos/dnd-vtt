# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### PRP-02 — Canvas and grid overlay

- **Outcome:** a scene selected in the DM workspace is drawn on a canvas: its map's display version as the background, with zoom (wheel and keyboard) and pan (drag and keyboard), and the grid overlay scaled from original-image dimensions; a map-less scene shows its columns × rows extent on a neutral dark background. The DM attaches a map to a scene, uploading it in the same action, sets whether players see the grid, and sees the overlay faintly when players do not. The same canvas component renders for the player view without controls and without the overlay when it is hidden for players; showing the live scene on the TV is LIV-03.
- **Specs:** `13` §5 PRP-02, `08` §3, `06` §2, `03` §5, `03` §6, `04` §9, `05` §6, `05` §7, `07` §5; D-006, D-016, D-026, D-078, D-080, D-084; G-016, G-017.
- **Dependencies:** PRP-01 (workspace, `dm/api.ts` `upload`), SRV-03 (scenes), SRV-04 (images, presets).
- **Acceptance (executable):**
  - Vitest against a real SQLite file: `PATCH /api/scenes/:id` takes `map_image_id` (a new map starts from that image's preset, or the stored defaults; an image that does not exist is refused and stores nothing; the previous map is removed when nothing references it, Q-002) and `grid.visible`, and refuses every other grid field until PRP-03; `shared` contract types updated.
  - Component tests: grid lines positioned from `grid.size` and offsets multiplied by display ÷ original width, never from display pixels (`06` §2); the DM rendering draws the overlay faint when `grid.visible` is false, the player rendering draws none; a map-less scene draws its 30 × 20 default extent; zoom and pan by keyboard change the camera and a reset fits the map.
  - The scene map upload checks `upload_limit_bytes` before sending and shows progress (G-017), and creates the reference in the same action (G-016).
  - The canvas loads only the display version, never the original (`07` §5); `react-konva` and `konva` bundled, nothing fetched off the server (`02` §6).
  - Playwright: attach a generated map to a scene, see it drawn with the overlay, toggle player visibility, zoom and pan, reload unchanged; the keyboard and contrast gates pass; `make verify` exit 0 on both CI runners; `TRACEABILITY.md` PRP-02 row with test names.
- **Non-goals:** calibration and preset editing (PRP-03), tokens (PRP-04), the player view showing the live scene and the player camera (LIV-03, LIV-06).
- **Review:** `Surfaces: data`, `Touches red line: yes`, so prompt 2 (review) runs after implementation. `13` §5 marks `Contract change: no`, but the scene update body gains `map_image_id` and `grid.visible` (D-078 deferred them here); treat it as a contract change.

## Next

1. **PRP-03 — Grid calibration.** The three methods with live overlay, decimal square size, far-corner magnifier, original-dimension storage, presets per image (`13` §5, `06` §1, `06` §2, `06` §3).
