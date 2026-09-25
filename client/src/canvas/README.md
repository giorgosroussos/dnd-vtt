# canvas

The react-konva map, grid and tokens shared by both views (`specs/02-architecture.md` §1, D-006).

- `geometry.ts`: world size, grid line positions from original-image dimensions, and the camera (fit, zoom, pan, keys), with no React or Konva (D-090).
- `calibration.ts`: the arithmetic of the three calibration methods and of the far-corner magnifier, in original-image pixels (D-094).
- `MapCanvas.tsx`: the canvas in `dm` mode (camera controls, faint overlay when hidden for players, D-026, a rectangle measured by dragging while calibrating, D-094, and token selection, dragging, keyboard moves and placing, D-100) or `player` mode (no controls, fitted, no overlay when hidden, no hidden token). The DM view uses it from PRP-02; the player view from LIV-03.
- `tokens.ts`: token positions in decimal grid units to world pixels through the calibration, footprints per size, snapping (whole squares, Tiny half squares, Alt free) and placement, with no React or Konva (PRP-04, D-023, D-100).
- `TokenLayer.tsx`: the tokens, each from its asset's display version with its label; in `dm` mode hidden ones semi-transparent with a marker (Q-054), in `player` mode none of them.
