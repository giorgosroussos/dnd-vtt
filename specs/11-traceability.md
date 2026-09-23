# Traceability Matrix

This matrix maps the commercial and product intent in `docs/inputs/` to the specified implementation and prevents both omissions and scope expansion. It is owner-maintained. Implementation status per work package lives in the root `TRACEABILITY.md`.

Each row's status restates the tagged statement it cites in `01`. [input, Q-013, Q-016]

| Original intent / requirement | Implemented feature/spec | Status |
| --- | --- | --- |
| DM prepares a session in advance and runs it on a TV or projector, alone | `01` §1, `08` §10 | MVP |
| In-person play, one table up to ~8, same Wi-Fi | `01` §1, `02` §2 | MVP |
| D&D 5e 2014 (SRD 5.1); no rules in code in the MVP | `01` §1, `03` §8 | MVP |
| Free, self-hosted alternative | `01` §8, `09` §1 | MVP |
| Sessions as series of prepared scenes with pre-placed and hidden tokens | `03` §1, `04` §4, `08` §2 | MVP |
| Local Node server with React and WebSockets | `02` §2 | MVP |
| SQLite and images folder; backup = copy the folder | `02` §7, `09` §5 | MVP |
| Join from the LAN with a QR code | `08` §5 | MVP |
| PIN for the DM view; no accounts | `07` §1, `07` §2 | MVP |
| Automatic reconnection with snapshot and versioning | `04` §5, `04` §6 | MVP |
| Campaign → Sessions → Scenes | `03` §1, `08` §1 | MVP |
| Background image, zoom and pan | `08` §3 | MVP |
| Grid calibration with three methods, decimal size, far-corner check | `06` §1, `06` §2 | MVP |
| Grid preset per image | `03` §5, `06` §3 | MVP |
| Shared asset library with tags and search | `05` §1 | MVP |
| Tokens with drag, snap-to-grid, automatic numbering | `04` §7, `05` §3, `06` §4 | MVP |
| Token sizes from the rules | `05` §2 | MVP |
| Default visibility by category | `05` §4 | MVP |
| Hidden tokens filtered on the server | `04` §4, `07` §5 | MVP |
| Ruler, PHB 2014 diagonals with DMG option as a setting | `06` §5 | MVP |
| Independent DM and player cameras; live scene separate from editing | `04` §9, `08` §2 | MVP |
| Duplicate scene | `03` §7 | MVP |
| Undo for the DM on the live scene | `04` §8 | MVP |
| Upload limits: file types and maximum size | `05` §6 | MVP |
| Smaller image versions on upload; display size to be tested on the owner's TV | `05` §7, `10` §4 | MVP |
| Deletion cascades; asset in use restricted | `03` §7 | MVP |
| Add flow: button → picker → click on map | `05` §5 | MVP |
| Drag from sidebar | `01` §6 | Future |
| Export/import campaign as zip | `01` §4 | Future (Phase 2) |
| Characters with join link/QR; per-player permissions | `01` §4 | Future (Phase 2) |
| Mobile UI | `01` §4 | Future (Phase 2) |
| Initiative tracker; HP and conditions; fog of war | `01` §4 | Future (Phase 2) |
| DM notes per scene; handouts | `01` §4 | Future (Phase 2) |
| Character sheet with derived values; data-driven rules, SRD 5.1 import | `01` §4 | Future (Phase 2) |
| Guided level-up; personal screen per player | `01` §5 | Future (Phase 3) |
| Tauri or Electron packaging | `01` §5, `02` §8 | Future (Phase 3) |
| 2024 rules; homebrew; AI assistant; auto grid detection; physical scale; live drag preview | `01` §6 | Future (nice-to-have) |
| Custom map creation; remote play; full effects engine; dynamic lighting; hex grids | `01` §7 | Out of Scope |

## Coverage rule

Any future commercial promise MUST be added here before implementation and classified as MVP, Future or Out of Scope; a code change alone does not change product scope. [Q-074, D-043]
