import type { Grid, Image } from '@emberglass/shared';

// The geometry of the map canvas (specs/08-ux-journeys.md §3, specs/06-grid-and-measurement.md §2,
// specs/03-domain-model.md §6, D-090), free of React and Konva so that it is tested on its own.
//
// The canvas draws in world pixels. A scene with a map uses the pixels of the display version,
// the only version the canvas loads (specs/07-security-and-access.md §5); the grid is stored in
// the original's pixels and multiplied by display ÷ original width here, never read as display
// pixels. A scene without a map has no pixels of its own: each square is CELL_PX world pixels.

export const CELL_PX = 64;
// A grid finer than this many squares across one axis is not drawn line by line.
export const MAX_LINES_PER_AXIS = 2000;

export interface Size {
  width: number;
  height: number;
}

/** A map as the canvas needs it: its original size, the size of the version shown, and its URL. */
export interface MapInfo {
  original: Size;
  display: Size;
}

/**
 * The map of an image record. The display size is the record's (D-080); a record written
 * before the upload pipeline has none, and then the loaded display version's own size is
 * used once it has arrived. Undefined while neither is known.
 */
export function mapInfo(image: Image, loaded?: Size): MapInfo | undefined {
  const display = image.variants.display ?? (loaded && loaded.width > 0 ? loaded : undefined);
  if (!display) return undefined;
  return { original: { width: image.width, height: image.height }, display };
}

/** The size of what the canvas draws: the display version, or the map-less extent. */
export function worldSize(grid: Grid, map: MapInfo | undefined): Size {
  return map ? map.display : { width: grid.columns * CELL_PX, height: grid.rows * CELL_PX };
}

/**
 * The square size in original pixels. Until the grid is calibrated (PRP-03) it has no size,
 * and the stored columns are read as the map's width in squares, as the known-dimensions
 * method of specs/06-grid-and-measurement.md §1 does (D-090).
 */
export function squareSize(grid: Grid, map: MapInfo): number {
  return grid.size ?? map.original.width / grid.columns;
}

export interface GridLines {
  /** World x of every vertical line. */
  xs: number[];
  /** World y of every horizontal line. */
  ys: number[];
}

function positions(offset: number, step: number, extent: number): number[] {
  if (!(step > 0) || extent / step > MAX_LINES_PER_AXIS) return [];
  const first = ((offset % step) + step) % step;
  const lines: number[] = [];
  for (let at = first; at <= extent + 1e-9; at += step) lines.push(at);
  return lines;
}

/** Where the overlay's lines go, in world pixels. */
export function gridLines(grid: Grid, map: MapInfo | undefined): GridLines {
  const world = worldSize(grid, map);
  if (!map) return { xs: positions(0, CELL_PX, world.width), ys: positions(0, CELL_PX, world.height) };
  const scale = map.display.width / map.original.width;
  const step = squareSize(grid, map) * scale;
  return {
    xs: positions(grid.offset_x * scale, step, world.width),
    ys: positions(grid.offset_y * scale, step, world.height),
  };
}

/** Screen = world × scale + (x, y). */
export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export const MIN_SCALE = 0.02;
export const MAX_SCALE = 8;
const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/** The whole world centred in the viewport, as large as it fits. */
export function fitCamera(world: Size, viewport: Size): Camera {
  if (world.width <= 0 || world.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { x: 0, y: 0, scale: 1 };
  }
  const scale = clampScale(Math.min(viewport.width / world.width, viewport.height / world.height));
  return {
    x: (viewport.width - world.width * scale) / 2,
    y: (viewport.height - world.height * scale) / 2,
    scale,
  };
}

/** Zooms by `factor`, keeping the world point under `at` (screen pixels) where it is. */
export function zoomAt(camera: Camera, factor: number, at: { x: number; y: number }): Camera {
  const scale = clampScale(camera.scale * factor);
  const ratio = scale / camera.scale;
  return { scale, x: at.x - (at.x - camera.x) * ratio, y: at.y - (at.y - camera.y) * ratio };
}

export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x + dx, y: camera.y + dy };
}

export const ZOOM_STEP = 1.25;
export const WHEEL_ZOOM_STEP = 1.1;
export const PAN_STEP_PX = 64;

/** The camera after a key press on the canvas, or undefined when the key does nothing there. */
export function cameraForKey(
  camera: Camera,
  key: string,
  shift: boolean,
  world: Size,
  viewport: Size,
): Camera | undefined {
  const centre = { x: viewport.width / 2, y: viewport.height / 2 };
  const step = shift ? PAN_STEP_PX * 4 : PAN_STEP_PX;
  switch (key) {
    case '+':
    case '=':
      return zoomAt(camera, ZOOM_STEP, centre);
    case '-':
    case '_':
      return zoomAt(camera, 1 / ZOOM_STEP, centre);
    case '0':
      return fitCamera(world, viewport);
    // An arrow moves the view that way, so the map moves the other way.
    case 'ArrowLeft':
      return panBy(camera, step, 0);
    case 'ArrowRight':
      return panBy(camera, -step, 0);
    case 'ArrowUp':
      return panBy(camera, 0, step);
    case 'ArrowDown':
      return panBy(camera, 0, -step);
    default:
      return undefined;
  }
}
