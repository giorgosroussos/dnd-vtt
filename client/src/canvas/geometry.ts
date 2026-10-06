import {
  CAMERA_BOUNDS,
  FIT_CAMERA,
  MAX_GRID_LINES_PER_AXIS,
  type Grid,
  type Image,
  type PlayerCamera,
  type Screen,
} from '@emberglass/shared';

// The geometry of the map canvas (specs/08-ux-journeys.md §3, specs/06-grid-and-measurement.md §2,
// specs/03-domain-model.md §6, D-090), free of React and Konva so that it is tested on its own.
//
// The canvas draws in world pixels. A scene with a map uses the pixels of the display version,
// the only version the canvas loads (specs/07-security-and-access.md §5); the grid is stored in
// the original's pixels and multiplied by display ÷ original width here, never read as display
// pixels. A scene without a map has no pixels of its own: each square is CELL_PX world pixels.

export const CELL_PX = 64;
// A grid finer than this many squares across one axis is not drawn line by line.
export const MAX_LINES_PER_AXIS = MAX_GRID_LINES_PER_AXIS;

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
export function mapInfo(image: Pick<Image, 'width' | 'height' | 'variants'>, loaded?: Size): MapInfo | undefined {
  const display = image.variants.display ?? (loaded && loaded.width > 0 ? loaded : undefined);
  if (!display) return undefined;
  return { original: { width: image.width, height: image.height }, display };
}

/** The size of what the canvas draws: the display version, or the map-less extent. */
export function worldSize(grid: Grid, map: MapInfo | undefined): Size {
  return map ? map.display : { width: grid.columns * CELL_PX, height: grid.rows * CELL_PX };
}

/**
 * The square size in original pixels. Until the grid is calibrated (D-094) it has no size,
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
  return fitBox({ x: 0, y: 0, width: world.width, height: world.height }, viewport);
}

/** A rectangle of the world, in world pixels, centred in the viewport as large as it fits. */
export function fitBox(box: { x: number; y: number; width: number; height: number }, viewport: Size): Camera {
  if (box.width <= 0 || box.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { x: 0, y: 0, scale: 1 };
  }
  const scale = clampScale(Math.min(viewport.width / box.width, viewport.height / box.height));
  return {
    x: (viewport.width - box.width * scale) / 2 - box.x * scale,
    y: (viewport.height - box.height * scale) / 2 - box.y * scale,
    scale,
  };
}

/** Zooms by `factor`, keeping the world point under `at` (screen pixels) where it is. */
export function zoomAt(camera: Camera, factor: number, at: { x: number; y: number }): Camera {
  const scale = clampScale(camera.scale * factor);
  const ratio = scale / camera.scale;
  return { scale, x: at.x - (at.x - camera.x) * ratio, y: at.y - (at.y - camera.y) * ratio };
}

/**
 * The camera a share `progress` (0 to 1) of the way from `from` to `to` (DMT-03): the world point at the
 * viewport's centre moves in a straight line and the zoom changes evenly in proportion, so a glide between
 * two cameras neither swings aside nor rushes the zoom.
 */
export function cameraBetween(from: Camera, to: Camera, progress: number, viewport: Size): Camera {
  if (progress <= 0) return from;
  if (progress >= 1 || !(from.scale > 0) || !(to.scale > 0)) return to;
  const centre = { x: viewport.width / 2, y: viewport.height / 2 };
  const world = (camera: Camera) => ({
    x: (centre.x - camera.x) / camera.scale,
    y: (centre.y - camera.y) / camera.scale,
  });
  const [a, b] = [world(from), world(to)];
  const scale = Math.exp(Math.log(from.scale) + (Math.log(to.scale) - Math.log(from.scale)) * progress);
  return {
    scale,
    x: centre.x - (a.x + (b.x - a.x) * progress) * scale,
    y: centre.y - (a.y + (b.y - a.y) * progress) * scale,
  };
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

// --- the player camera (LIV-06; specs/04-live-sync.md §9, Q-038, Q-080, D-018, D-046, D-119) ---
//
// The player camera is a rectangle of the world in fractions of its width and height (`PlayerCamera`),
// so the same camera means the same part of the map on every screen whatever its pixels. A screen
// shows the rectangle as large as it fits, centred, so a screen of another shape shows a little more
// along one axis. The DM view draws the frame of what the TV sees: the rectangle widened to the TV's
// shape. Moving or resizing that frame gives the next camera, which is that frame itself.

/** A rectangle of the world in world pixels, from its top-left corner. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A TV's shape when no screen has reported one: the common 16:9 of TVs and projectors. */
export const DEFAULT_ASPECT = 16 / 9;
const MIN_ASPECT = 1 / 4;
const MAX_ASPECT = 4;

/** Width ÷ height of the screen the frame follows, kept within reason. */
export function screenAspect(screen: Screen | null | undefined): number {
  if (!screen || screen.width <= 0 || screen.height <= 0) return DEFAULT_ASPECT;
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, screen.width / screen.height));
}

/** The camera a screen of `viewport` pixels draws for the player camera `rect`. */
export function viewOf(rect: PlayerCamera, world: Size, viewport: Size): Camera {
  const width = rect.width * world.width;
  const height = rect.height * world.height;
  if (!(width > 0) || !(height > 0) || viewport.width <= 0 || viewport.height <= 0) return fitCamera(world, viewport);
  const scale = clampScale(Math.min(viewport.width / width, viewport.height / height));
  return {
    scale,
    x: viewport.width / 2 - rect.centre_x * world.width * scale,
    y: viewport.height / 2 - rect.centre_y * world.height * scale,
  };
}

/** What a screen of `aspect` shows of the camera `rect`, in world pixels: the rectangle widened to its shape. */
export function frameOf(rect: PlayerCamera, world: Size, aspect: number): Box {
  let width = rect.width * world.width;
  let height = rect.height * world.height;
  if (width / height > aspect) height = width / aspect;
  else width = height * aspect;
  return {
    x: rect.centre_x * world.width - width / 2,
    y: rect.centre_y * world.height - height / 2,
    width,
    height,
  };
}

const round = (value: number): number => Math.round(value * 1e6) / 1e6;
const within = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** The player camera that shows `box`, kept within the contract's bounds: its centre on the world. */
export function rectOf(box: Box, world: Size): PlayerCamera {
  if (world.width <= 0 || world.height <= 0) return FIT_CAMERA;
  const size = (value: number) => round(within(value, CAMERA_BOUNDS.minSize, CAMERA_BOUNDS.maxSize));
  return {
    centre_x: round(within((box.x + box.width / 2) / world.width, 0, 1)),
    centre_y: round(within((box.y + box.height / 2) / world.height, 0, 1)),
    width: size(box.width / world.width),
    height: size(box.height / world.height),
  };
}

/** The share of room left around the map and the fitted frame when the DM's view fits them. */
export const LIVE_FIT_MARGIN = 1.1;

/**
 * What the DM's own view fits in live mode (LIV-06 review U-H1): the map and the frame of the TV fitted
 * to it, with a margin, so the frame's edges and corners are on screen to grab. It depends only on the
 * world and the TV's shape, so steering the TV never moves the DM's view.
 */
export function liveFitBox(world: Size, aspect: number): Box {
  const frame = frameOf(FIT_CAMERA, world, aspect);
  const x = Math.min(0, frame.x);
  const y = Math.min(0, frame.y);
  const union = {
    x,
    y,
    width: Math.max(world.width, frame.x + frame.width) - x,
    height: Math.max(world.height, frame.y + frame.height) - y,
  };
  return scaleBox(union, LIVE_FIT_MARGIN);
}

/** Whether two player cameras are the same rectangle. */
export const sameRect = (a: PlayerCamera, b: PlayerCamera): boolean =>
  a.centre_x === b.centre_x && a.centre_y === b.centre_y && a.width === b.width && a.height === b.height;

/** `box` moved by (dx, dy) world pixels. */
export const moveBox = (box: Box, dx: number, dy: number): Box => ({ ...box, x: box.x + dx, y: box.y + dy });

/** `box` scaled by `factor` about its centre. */
export function scaleBox(box: Box, factor: number): Box {
  const width = box.width * factor;
  const height = box.height * factor;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

/** The part of the world the DM's view shows, in world pixels (UIX-01: Send my view). */
export function visibleBox(camera: Camera, viewport: Size): Box {
  return {
    x: -camera.x / camera.scale,
    y: -camera.y / camera.scale,
    width: viewport.width / camera.scale,
    height: viewport.height / camera.scale,
  };
}

/** The smallest box of the shape `aspect` that holds `box`, on the same centre. */
export function coverBox(box: Box, aspect: number): Box {
  const width = Math.max(box.width, box.height * aspect);
  const height = width / aspect;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

/**
 * The player camera Follow my view sends (DMT-03, specs/04-live-sync.md §9, Q-113): the whole of `visible`,
 * the part of the world the DM's view shows, widened about its centre to the TV's shape so that the TV crops
 * none of it. A TV wider than the DM's view widens it, a narrower one raises it; neither side ever shrinks.
 * It is then kept within the contract's bounds by one factor on both sides, so the shape holds, and its
 * centre on the world.
 */
export function followRect(visible: Box, world: Size, aspect: number): PlayerCamera {
  if (world.width <= 0 || world.height <= 0 || !(visible.width > 0) || !(visible.height > 0) || !(aspect > 0)) {
    return FIT_CAMERA;
  }
  const cover = coverBox(visible, aspect);
  const width = cover.width / world.width;
  const height = cover.height / world.height;
  const over = Math.max(width, height) / CAMERA_BOUNDS.maxSize;
  const under = CAMERA_BOUNDS.minSize / Math.min(width, height);
  // A shape too extreme to fit the bounds at any size is clamped side by side, as rectOf does.
  const factor = over > 1 && under > 1 ? 1 : over > 1 ? 1 / over : under > 1 ? under : 1;
  const size = (value: number) => round(within(value * factor, CAMERA_BOUNDS.minSize, CAMERA_BOUNDS.maxSize));
  return {
    centre_x: round(within((cover.x + cover.width / 2) / world.width, 0, 1)),
    centre_y: round(within((cover.y + cover.height / 2) / world.height, 0, 1)),
    width: size(width),
    height: size(height),
  };
}

/** The smallest frame, as a share of the world's larger side: about two squares of a 30-square map. */
export const MIN_FRAME_SHARE = 0.05;
/** A TV's width in CSS pixels while no screen has reported one, for the frame's limits. */
export const DEFAULT_SCREEN_WIDTH = 1920;

/** The widths, in world pixels, a frame may take: what the TV can really show, and the contract's bounds. */
export interface FrameLimits {
  min: number;
  max: number;
}

/**
 * How narrow and how wide the frame may be (LIV-06 review C-M1, C-M2). A screen draws the camera at
 * most MAX_SCALE and at least MIN_SCALE, so a frame narrower than the TV's width ÷ MAX_SCALE would show
 * the DM less than the TV shows; the camera's sides stay within CAMERA_BOUNDS, both by one factor, so
 * the frame keeps the TV's shape at either end.
 */
export function frameLimits(world: Size, aspect: number, screen: Screen | null | undefined): FrameLimits {
  const tvWidth = screen && screen.width > 0 ? screen.width : DEFAULT_SCREEN_WIDTH;
  const min = Math.max(
    tvWidth / MAX_SCALE,
    Math.max(world.width, world.height) * MIN_FRAME_SHARE,
    world.width * CAMERA_BOUNDS.minSize,
    world.height * CAMERA_BOUNDS.minSize * aspect,
  );
  const max = Math.min(
    tvWidth / MIN_SCALE,
    world.width * CAMERA_BOUNDS.maxSize,
    world.height * CAMERA_BOUNDS.maxSize * aspect,
  );
  return { min, max: Math.max(min, max) };
}

/** `box` in the TV's shape, its width within `limits`, about its centre. */
export function boundFrame(box: Box, aspect: number, limits: FrameLimits): Box {
  const width = within(box.width, limits.min, limits.max);
  const height = width / aspect;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

/**
 * The frame resized by dragging one corner to `to`, the opposite corner `anchor` staying where it is
 * and the frame keeping the TV's shape (D-046), within `limits`.
 */
export function resizeBox(
  anchor: { x: number; y: number },
  to: { x: number; y: number },
  aspect: number,
  limits: FrameLimits,
): Box {
  const width = within(Math.max(Math.abs(to.x - anchor.x), Math.abs(to.y - anchor.y) * aspect), limits.min, limits.max);
  const height = width / aspect;
  return {
    x: to.x < anchor.x ? anchor.x - width : anchor.x,
    y: to.y < anchor.y ? anchor.y - height : anchor.y,
    width,
    height,
  };
}

/**
 * The frame after a key press while the DM steers the TV (Q-080, keyboard): an arrow moves it an
 * eighth of its size (Shift, half), + and − zoom the TV in and out, and 0 fits the TV to the map.
 * Undefined when the key does nothing there.
 */
export function frameForKey(box: Box, key: string, shift: boolean): Box | 'fit' | undefined {
  const step = (shift ? 0.5 : 0.125) * Math.min(box.width, box.height);
  switch (key) {
    case '+':
    case '=':
      return scaleBox(box, 1 / ZOOM_STEP);
    case '-':
    case '_':
      return scaleBox(box, ZOOM_STEP);
    case '0':
      return 'fit';
    case 'ArrowLeft':
      return moveBox(box, -step, 0);
    case 'ArrowRight':
      return moveBox(box, step, 0);
    case 'ArrowUp':
      return moveBox(box, 0, -step);
    case 'ArrowDown':
      return moveBox(box, 0, step);
    default:
      return undefined;
  }
}
