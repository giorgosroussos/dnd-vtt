# canvas

The react-konva map, grid and tokens shared by both views (`specs/02-architecture.md` §1, D-006).

- `geometry.ts`: world size, grid line positions from original-image dimensions, and the camera (fit, zoom, pan, keys), with no React or Konva (D-090).
- `calibration.ts`: the arithmetic of the three calibration methods and of the far-corner magnifier, in original-image pixels (D-094).
- `MapCanvas.tsx`: the canvas in `dm` mode (camera controls, faint overlay when hidden for players, D-026, and a rectangle measured by dragging while calibrating, D-094) or `player` mode (no controls, fitted, no overlay when hidden). The DM view uses it from PRP-02; the player view from LIV-03.

Tokens arrive with PRP-04.
