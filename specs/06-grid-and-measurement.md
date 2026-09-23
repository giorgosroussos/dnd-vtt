# 06 — Grid and Measurement

How the DM aligns a square grid to a map, how the grid is stored, and how tokens snap and distances are measured.

## 1. Calibration methods

The MVP MUST offer three calibration methods, each with a live overlay while the DM adjusts it: [input]

| Method | The DM provides | When |
| --- | --- | --- |
| Known dimensions | columns × rows (e.g. 30 × 20) | maps with a stated size |
| Rectangle over N×N squares | drags a rectangle over e.g. 3×3 or 5×5 drawn squares | maps with a drawn grid |
| Fine tuning | square size and x/y offset, with arrow keys | always, as the last step |

- Square size MUST be a decimal number of pixels (e.g. 70.4 px), because half a pixel of error over 40 squares drifts 20 px at the edge. [input]
- During calibration the DM view MUST show a magnified view of the far corner of the map. [input]
- Calibration applies only to scenes with a map; a scene without a map uses the extent of `03` §6. [Q-006]

## 2. Grid storage and overlay

- Grid size and offsets MUST be stored in the dimensions of the original image; clients multiply them by the scale ratio of the version they display. [input]
- A scene's grid MUST store type (`square`), size, x/y offset, visibility for players, and feet per square (`03` §1). [input]
- When the grid is set hidden for players (for maps with a drawn grid), the player view MUST NOT draw the overlay. [input]
- The DM view always draws the overlay, faintly when it is hidden for players. [D-026]

## 3. Presets per image

- The same map used in another scene MUST start with that map's grid preset (`03` §5). [input, Q-001]

## 4. Snapping

- Dropped tokens MUST snap to the grid. [input]
- Snapping is on by default and aligns footprints to whole squares (Tiny to half squares); holding Alt while dropping places freely. [D-023]

## 5. Ruler

- The ruler MUST measure by the PHB 2014 rule, every diagonal square counting 5 ft, with the optional DMG rule (diagonals alternating 5 ft and 10 ft) available as a setting. [input]
- Distances MUST scale with the scene's feet per square. [input]
- The diagonal rule is one server-wide setting, default PHB; a new scene's feet per square defaults to 5. [D-024]
- The ruler measures a straight path between two square centres, without waypoints. [D-025]
- On the live scene the measurement is shown on the player view (`04` §11). [Q-027]

## 6. Out of the MVP

Automatic grid detection, hex grids and physical screen scale for miniatures are not part of the MVP (`01` §6, `01` §7).
