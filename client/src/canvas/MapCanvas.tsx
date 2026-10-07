import {
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import type Konva from 'konva';
import { Circle, Group, Image as KonvaImage, Label, Layer, Line, Rect, Shape, Stage, Tag, Text } from 'react-konva';
import {
  applyStroke,
  FIT_CAMERA,
  FOG_BRUSH_RADIUS,
  FOG_STROKE_MAX_POINTS,
  FOG_STROKE_MAX_WORK,
  fogExtent,
  imageFileUrl,
  strokeWork,
  type FogMask,
  type FogStroke,
  type Grid,
  type Image,
  type Measurement,
  type PlayerCamera,
  type Screen,
  type TokenSize,
} from '@emberglass/shared';
import { Icon } from '../ui/icons.js';
import { CANVAS_FONT, THEME } from '../ui/theme.js';
import { formatDecimal, formatNumber, normalise, type Rect as Box } from './calibration.js';
import { t } from '../ui/messages.js';
import {
  boundFrame,
  cameraForKey,
  cameraBetween,
  coverBox,
  followRect,
  fitBox,
  fitCamera,
  frameLimits,
  liveFitBox,
  sameRect,
  screenAspect,
  frameOf,
  gridLines,
  mapInfo,
  panBy,
  rectOf,
  resizeBox,
  scaleBox,
  viewOf,
  visibleBox,
  WHEEL_ZOOM_STEP,
  worldSize,
  ZOOM_STEP,
  zoomAt,
  type Box as WorldBox,
  type Camera,
  type Size,
} from './geometry.js';
import { labelOffset, rulerForKey, sameSquare, squareAt, squareCentre, type RulerPath } from './ruler.js';
import { FogLayer } from './FogLayer.js';
import { PingLayer, type PingPoint } from './PingLayer.js';
import { TokenLayer, type TokenControls } from './TokenLayer.js';
import { MAP_NOTE_RADIUS_PX, MapNoteLayer, type CanvasMapNote, type MapNoteControls } from './MapNoteLayer.js';
import { bounded, compose, type TouchView } from '../player/touchView.js';
import { useTouchGestures } from '../player/useTouchGestures.js';
import {
  clampToWorld,
  footprint,
  gridFrame,
  nudge,
  placePosition,
  toGrid,
  toWorld,
  type CanvasToken,
  type Point,
} from './tokens.js';
import './canvas.css';

// The map canvas both views draw (specs/08-ux-journeys.md §3, specs/06-grid-and-measurement.md §2,
// specs/03-domain-model.md §6, D-006, D-026, D-090): the map's display version as the background,
// never the original (specs/07-security-and-access.md §5), or a map-less scene's extent on a
// neutral dark background, with the grid overlay on top.
//
// `dm` adds the camera controls: wheel and keyboard zoom, drag and keyboard pan, and a reset
// that fits the map; the overlay is drawn faintly when players do not see it (D-026). `player`
// has no control and nothing that takes focus, always fits the map (specs/04-live-sync.md §9),
// and draws no overlay when the grid is hidden for players. The player view uses it (LIV-03).
//
// The player camera (LIV-06, specs/04-live-sync.md §9, specs/08-ux-journeys.md §2, Q-080, D-046, D-119):
// the player mode draws the part of the world the DM framed for the TV, fitted when the scene went
// live. In live mode the DM mode draws that frame, widened to the TV's shape, over the map, the map
// outside it dimmed: its border drags to pan the TV and its corners resize it to zoom, keeping the TV's
// shape, and the camera is sent on the drop. The DM's own camera never moves with it. The scene's TV
// camera buttons (UIX-01, specs/08-ux-journeys.md §11) act through the canvas's handle: Send my view
// frames what the DM's view shows, TV zoom scales the frame, Fit map fits it; while the TV camera is
// locked the frame does not move and the handle sends nothing. While Follow my view is on (DMT-03,
// specs/04-live-sync.md §9, Q-113), the frame and the dimming are not drawn, the canvas edge is ringed in the
// accent colour instead, and every change of the DM's view or of the TV's shape reports the camera that
// shows the whole view on the TV (`followRect`); how often it is sent is the caller's.
//
// The DM mode's chrome (UIX-01): a floating tool rail (Select, Ruler, Ping, Fog regions, Add token,
// Undo, Redo), the grid and diagonal rule bottom left, and the DM's own zoom bottom right. Space held
// down makes a drag pan the view, whatever the tool. A selected token's popover is placed beside it while
// it is open: a click on the token opens it, and a drag of the token or a pan closes it (D-156).
//
// The ruler (LIV-07, specs/06-grid-and-measurement.md §5, specs/04-live-sync.md §11, Q-027, Q-048): both
// modes draw the measurement they are given, a line between two square centres and its distance beside
// the end. In the DM mode the Ruler toggle (or M on the canvas) turns measuring on: a drag on the map
// then measures from the square pressed to the square under the pointer instead of panning, tokens and
// the TV frame are left alone, and the arrow keys move the end a square (Shift, the whole ruler), Enter
// starts again at the centre of the view and Escape clears, then stops measuring. What a measurement
// does beyond this canvas, and whether it reaches the TV, is the caller's.
//
// While the DM calibrates by rectangle (PRP-03, specs/06-grid-and-measurement.md §1, D-094), a
// drag on the map draws a rectangle instead of panning, reported in the original's pixels.
//
// Tokens (PRP-04, D-100) are drawn over the grid by TokenLayer. In the DM mode a click selects one
// and a drag moves it; while a token is selected the arrow keys move it by a square (half a square
// for Tiny), Escape lets it go and Delete asks to delete it. While a token is being placed, a click
// on the map places it there and Enter at the centre of the view; Escape cancels.

// Konva draws on a canvas, so these are colours, not the CSS tokens: the void around the
// scene is the page background of tokens.css, a map-less extent a neutral dark grey (D-016);
// each grid line is light over a dark halo, so it shows on dark and light maps (D-093).
export const CANVAS_COLOURS = {
  void: THEME.canvas,
  extent: '#2b2b2b',
  grid: THEME.text,
  halo: THEME.canvas,
  // The accent, for the rectangle measured during calibration and the ruler.
  measure: THEME.accent,
  // The TV frame: the accent over a dark halo, the map outside it dimmed (UIX-01).
  tvFrame: THEME.accent,
  tvFrameText: THEME.onAccent,
  tvDim: 'rgba(8, 6, 4, 0.42)',
  // The footprint of a library asset dragged over the map (UXR-03): the accent, lightly filled.
  dropFill: 'rgba(232, 152, 72, 0.22)',
} as const;
// The TV frame's corner handles and the width of its border's grip, in screen pixels.
const HANDLE_PX = 12;
const FRAME_GRIP_PX = 14;
// A press-and-release shorter than this, in screen pixels either way, is a click, not a rectangle.
const MIN_RECT_PX = 4;
// A light line over a dark halo shows on any map (D-093); at half strength it stays quiet under the tokens,
// as the redesign's grid is (UIX-01).
export const GRID_OPACITY = { shown: 0.5, faint: 0.22 } as const;
// The strip the DM's tool rail covers, which a fitted map leaves free (UIX-01).
export const RAIL_INSET_PX = 68;
// The ruler's distance label, larger on the TV to be read across the room (LIV-07), and its gap to the end.
const RULER_LABEL = {
  dm: { fontSize: 14, padding: 4, gap: { x: 12, y: 8 } },
  player: { fontSize: 32, padding: 8, gap: { x: 18, y: 8 } },
} as const;

type Mode = 'dm' | 'player';

/** How the overlay is drawn for a view: the DM always sees it (D-026), players only when visible. */
export function overlayOpacity(mode: Mode, visible: boolean): number {
  if (visible) return GRID_OPACITY.shown;
  return mode === 'dm' ? GRID_OPACITY.faint : 0;
}

/** How long the player view takes to glide to a new camera (DMT-03): short, so Send my view stays immediate. */
export const GLIDE_MS = 120;

const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * `target`, reached by a short glide from the camera drawn before it (DMT-03): Follow my view sends the
 * DM's view about ten times a second, and a TV that jumped to each would step. A new world or viewport
 * (`key`), the first camera and reduced motion take the target at once.
 */
function useGlide(target: Camera, viewport: Size, key: string, enabled: boolean): Camera {
  const [drawn, setDrawn] = useState<{ key: string; camera: Camera }>({ key, camera: target });
  const latest = useRef(drawn);
  latest.current = drawn;
  const targetKey = `${target.x}:${target.y}:${target.scale}`;
  const to = useRef({ target, viewport });
  to.current = { target, viewport };
  useEffect(() => {
    const { target: goal, viewport: within } = to.current;
    const start = latest.current;
    const same = start.camera.x === goal.x && start.camera.y === goal.y && start.camera.scale === goal.scale;
    if (same && start.key === key) return;
    if (!enabled || start.key !== key || reducedMotion() || typeof requestAnimationFrame !== 'function') {
      setDrawn({ key, camera: goal });
      return;
    }
    let began: number | undefined;
    let frame = requestAnimationFrame(function step(now) {
      began ??= now;
      const progress = Math.min(1, (now - began) / GLIDE_MS);
      // Ease out: quick to leave, gentle to arrive.
      const eased = 1 - (1 - progress) ** 3;
      setDrawn({ key, camera: progress >= 1 ? goal : cameraBetween(start.camera, goal, eased, within) });
      if (progress < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [key, targetKey, enabled]);
  return enabled && drawn.key === key ? drawn.camera : target;
}

function useViewport(): [React.RefObject<HTMLDivElement | null>, Size] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((current) =>
        current.width === Math.floor(width) && current.height === Math.floor(height)
          ? current
          : { width: Math.floor(width), height: Math.floor(height) },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

/**
 * Whether a scrolling box hides content above or below its view: the tool rail scrolls without a scrollbar
 * on a short canvas, and fades at the edge with more beyond it (review U-M2).
 */
function useScrollEdges(): [(element: HTMLDivElement | null) => void, { above: boolean; below: boolean }] {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ above: false, below: false });
  useEffect(() => {
    if (!element) return;
    const measure = () => {
      const above = element.scrollTop > 1;
      const below = element.scrollTop + element.clientHeight < element.scrollHeight - 1;
      setEdges((current) => (current.above === above && current.below === below ? current : { above, below }));
    };
    measure();
    element.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [element]);
  return [setElement, edges];
}

/**
 * What the canvas needs of a map image: its id, its size and its display version's size. The
 * player view builds it from what its snapshot carries (LIV-03), never the DM's record.
 */
export type CanvasMap = Pick<Image, 'id' | 'width' | 'height' | 'variants'>;

interface Drag {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

/** A token being placed: a click on the map, or Enter, says where (specs/05-assets-and-images.md §5). */
export interface Placing {
  size: TokenSize;
  /** What is placed: a token (the default), or a map note (UXR-08), whose point is the square's centre. */
  kind?: 'token' | 'note' | undefined;
  /** Where the token goes, in grid units, snapped unless Alt was held. */
  onPlace: (at: Point) => void;
  onCancel: () => void;
}

/** A library asset dragged onto the map (UXR-03, specs/05-assets-and-images.md §5). */
export interface AssetDrop {
  /** The dragged asset's size, or undefined when the drag is not an asset the map takes. */
  sizeOf: (types: readonly string[]) => TokenSize | undefined;
  /** Where the token goes, in grid units, snapped unless Alt was held. */
  onDrop: (at: Point) => void;
}

/** The DM's token controls: selection, moves and the deletion request. */
export interface CanvasTokenControls extends TokenControls {
  onDeselect: () => void;
  onDelete: (id: string) => void;
}

/** The frame of what the TV sees, in live mode (LIV-06). */
export interface TvFrame {
  camera: PlayerCamera;
  /** The screen the frame follows, whose shape it keeps; null while none has reported (16:9). */
  screen: Screen | null;
  /** The live connection is down: the frame is shown but cannot be moved (D-116). */
  offline: boolean;
  /** Lock TV camera (UIX-01): the frame is shown but cannot be moved, and the handle sends nothing. */
  locked: boolean;
  /** A new player camera: on a drop or one of the TV camera buttons. */
  onChange: (camera: PlayerCamera) => void;
  /**
   * Follow my view (DMT-03): while set, the frame is not drawn, since the TV shows the DM's whole view, and
   * the canvas reports the camera that shows all of it, widened to the TV's shape, whenever it changes.
   */
  follow?: ((camera: PlayerCamera) => void) | undefined;
}

/** What the scene's controls outside the canvas ask of it (UIX-01). */
export interface CanvasHandle {
  /** Frames on the TV what the DM's view shows now, in the TV's shape. */
  sendView: () => void;
  /** Zooms the TV in or out by one step, around the frame's centre. */
  tvZoom: (direction: 'in' | 'out') => void;
  /** Fits the whole map on the TV. */
  tvFit: () => void;
  /** Centres the DM's view on a token, keeping the zoom. */
  centreOn: (tokenId: string) => void;
}

/** The DM mode's tool rail (UIX-01, specs/08-ux-journeys.md §11). */
export interface CanvasRail {
  /** Select: leaves the ruler and stops placing. */
  onSelect: () => void;
  /** Add token: opens the picker; absent while tokens cannot be added. */
  onAddToken?: (() => void) | undefined;
  /** Add note (UXR-08): places a map note by a click on the map; absent while none can be placed. */
  onAddNote?: (() => void) | undefined;
  /** Undo and Redo, in live mode. */
  history?: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void } | undefined;
}

/** Where a selected token is drawn, in pixels from the canvas's corner, for its popover. */
export interface TokenAnchor {
  left: number;
  top: number;
  side: number;
  viewport: Size;
}

type Corner = 'nw' | 'ne' | 'sw' | 'se';
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];
const cornerOf = (box: WorldBox, corner: Corner) => ({
  x: corner.endsWith('w') ? box.x : box.x + box.width,
  y: corner.startsWith('n') ? box.y : box.y + box.height,
});
const OPPOSITE: Record<Corner, Corner> = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' };

/** The ruler (LIV-07): what is drawn, and in the DM view the tool that measures. */
export interface RulerView {
  /** The measurement drawn, its distance already counted, or null. */
  shown: Measurement | null;
  /** DM view only: measuring with the pointer and the keys. */
  tool?: RulerTool | undefined;
}

export interface RulerTool {
  on: boolean;
  onToggle: (on: boolean) => void;
  /** A new measurement: while a drag goes on (`final` false), and on its release or a key (true). */
  onMeasure: (path: RulerPath, final: boolean) => void;
  onClear: () => void;
}

/** The pings drawn (TBL-01), and in the DM view on the live scene the tool that pings. */
export interface PingView {
  shown: readonly PingPoint[];
  tool?: PingTool | undefined;
}

export interface PingTool {
  on: boolean;
  onToggle: (on: boolean) => void;
  /** A point pinged, in grid units: a click on the map, or Enter at the centre of the view. */
  onPing: (at: Point) => void;
}

/** The painted fog (TBL-04), and in the DM view the brush that paints it. */
export interface FogView {
  fog: FogMask;
  tool?: FogTool | undefined;
}

export interface FogTool {
  on: boolean;
  onToggle: (on: boolean) => void;
  /** Whether the brush erases (E switches it). */
  erase: boolean;
  onErase: (erase: boolean) => void;
  /** The brush's radius in squares ([ and ] step it). */
  radius: number;
  onRadius: (radius: number) => void;
  /** A stroke finished, in grid units: answers whether it was taken, so a refused one stops showing. */
  onPaint: (stroke: FogStroke) => Promise<boolean>;
}

/** A rectangle measured on the map during calibration, in the original image's pixels. */
export interface Measure {
  rect: Box | undefined;
  onDraw: (rect: Box) => void;
}

const scaled = (box: Box, ratio: number): Box => ({
  x: box.x * ratio,
  y: box.y * ratio,
  width: box.width * ratio,
  height: box.height * ratio,
});

/**
 * The display version of the map, once loaded; only that version is ever requested, and only
 * again when the map itself changes, or its display version was regenerated at another size
 * (`size`, REL-01), not when its record is rebuilt. Until the new one arrives the old one is
 * drawn, at the new size.
 */
function useDisplayImage(
  id: string | undefined,
  size: string,
  onError: (() => void) | undefined,
): HTMLImageElement | undefined {
  const [loaded, setLoaded] = useState<{ id: string; element: HTMLImageElement }>();
  const failed = useEffectEvent(() => onError?.());
  useEffect(() => {
    if (id === undefined) return;
    const element = new window.Image();
    element.onload = () => setLoaded({ id, element });
    element.onerror = () => failed();
    element.src = imageFileUrl(id, 'display');
    return () => {
      element.onload = null;
      element.onerror = null;
    };
  }, [id, size]);
  return id !== undefined && loaded?.id === id ? loaded.element : undefined;
}

export function MapCanvas({
  grid,
  map,
  mode,
  label,
  onMapError,
  measure,
  tokens = [],
  tokenControls,
  placing,
  assetDrop,
  rail,
  status,
  popover,
  preview,
  mapNotes = [],
  mapNoteControls,
  notePopover,
  notePreview,
  ref,
  labelScale = 1,
  camera: playerCamera,
  touch,
  tvFrame,
  ruler,
  ping,
  fog,
}: {
  grid: Grid;
  /** The scene's map image, or null for a scene without a map. */
  map: CanvasMap | null;
  mode: Mode;
  /** The DM's name for the canvas, naming the scene. */
  label?: string;
  onMapError?: () => void;
  /** DM view only: a drag measures a rectangle instead of panning. */
  measure?: Measure | undefined;
  /** The scene's tokens; the player mode draws only the visible ones. */
  tokens?: readonly CanvasToken[];
  /** DM view only: selecting, moving and deleting tokens. */
  tokenControls?: CanvasTokenControls | undefined;
  /** DM view only: a token being placed by a click on the map. */
  placing?: Placing | undefined;
  /** DM view only: a library asset dragged onto the map. */
  assetDrop?: AssetDrop | undefined;
  /** DM view only: the tool rail (UIX-01). */
  rail?: CanvasRail | undefined;
  /** DM view only: the grid and diagonal rule, bottom left (UIX-01). */
  status?: ReactNode;
  /** DM view only: the selected token's popover, placed beside it (UIX-01). */
  popover?: ((anchor: TokenAnchor) => ReactNode) | undefined;
  /** DM view only: the read-only preview of a token the mouse rests on, placed beside it (UXR-06). */
  preview?: ((tokenId: string, anchor: TokenAnchor) => ReactNode) | undefined;
  /** DM view only: the notes pinned on the map (UXR-08), drawn as icons; the player mode never draws them. */
  mapNotes?: readonly CanvasMapNote[];
  /** DM view only: opening, moving and previewing map notes. */
  mapNoteControls?: MapNoteControls | undefined;
  /** DM view only: the open map note's popover, placed beside its icon (UXR-08). */
  notePopover?: ((anchor: TokenAnchor) => ReactNode) | undefined;
  /** DM view only: the read-only preview of a map note the mouse rests on (UXR-08). */
  notePreview?: ((noteId: string, anchor: TokenAnchor) => ReactNode) | undefined;
  /** DM view only: what the scene's TV camera buttons and token list ask of the canvas. */
  ref?: Ref<CanvasHandle> | undefined;
  /** Player view only: how much larger than the DM's labels and badges are drawn, to read across a room. */
  labelScale?: number;
  /** Player view only: the player camera; fitted to the map when absent. */
  camera?: PlayerCamera | undefined;
  /** Player view on a handheld only (UXR-05): the screen's own pinch zoom and pan over the player camera. */
  touch?: { view: TouchView; onView: (view: TouchView) => void } | undefined;
  /** DM view in live mode only: the frame of what the TV sees, which steers it. */
  tvFrame?: TvFrame | undefined;
  /** The measurement drawn, and in the DM view the ruler tool (LIV-07). */
  ruler?: RulerView | undefined;
  /** The pings drawn, and in the DM view the ping tool (TBL-01). */
  ping?: PingView | undefined;
  /** The fog regions drawn, and in the DM view the fog tool (TBL-03). */
  fog?: FogView | undefined;
}) {
  const helpId = useId();
  const [viewportRef, viewport] = useViewport();
  const [railRef, railEdges] = useScrollEdges();
  const shownSize = map?.variants.display ? `${map.variants.display.width}x${map.variants.display.height}` : '';
  const displayImage = useDisplayImage(map?.id, shownSize, onMapError);
  const info = map
    ? mapInfo(map, displayImage && { width: displayImage.naturalWidth, height: displayImage.naturalHeight })
    : undefined;
  const world = worldSize(grid, info);
  const ready = map === null || info !== undefined;

  // The DM's own camera, kept only for the world it was set on: another scene or map fits again.
  const worldKey = `${map?.id ?? 'none'}:${world.width}x${world.height}`;
  const [manual, setManual] = useState<{ key: string; camera: Camera }>();
  // In live mode the DM's view fits the map and the TV's fitted frame, with room around them, so the
  // frame's edges and corners can be grabbed (LIV-06 review U-H1); it never follows the TV's camera.
  const liveAspect = mode === 'dm' && ready && tvFrame ? screenAspect(tvFrame.screen) : undefined;
  // The DM's fit leaves the tool rail's strip free, so the map's left edge and the TV frame's corners are
  // not under it (UIX-01).
  const inset = mode === 'dm' && rail ? RAIL_INSET_PX : 0;
  const fitArea = { width: Math.max(viewport.width - inset, 1), height: viewport.height };
  const fittedInArea =
    liveAspect === undefined ? fitCamera(world, fitArea) : fitBox(liveFitBox(world, liveAspect), fitArea);
  const fitted = { ...fittedInArea, x: fittedInArea.x + inset };
  // The player mode glides to each new camera (DMT-03), so a TV following the DM's view moves smoothly.
  const glided = useGlide(
    playerCamera ? viewOf(playerCamera, world, viewport) : fitted,
    viewport,
    `${worldKey}:${viewport.width}x${viewport.height}`,
    mode === 'player',
  );
  // A handheld's own view over the player camera (UXR-05): between the whole map and eight times the DM's camera.
  const touchMin = Math.min(1, fitted.scale / glided.scale);
  const camera =
    mode === 'dm'
      ? manual?.key === worldKey
        ? manual.camera
        : fitted
      : touch
        ? compose(glided, bounded(touch.view, glided, world, viewport, touchMin))
        : glided;
  const gestures = useTouchGestures(
    touch && ready
      ? {
          view: touch.view,
          onView: (view) => touch.onView(bounded(view, glided, world, viewport, touchMin)),
          min: touchMin,
        }
      : undefined,
  );
  // The camera as a key: whatever moves the map under the pointer hides a preview (UXR-06,
  // specs/08-ux-journeys.md §14).
  const view = `${camera.x},${camera.y},${camera.scale}`;
  // From the latest camera, not this render's: wheel and drag events arrive outside React's
  // synchronous updates, and several can land before the next render (D-093).
  const changeCamera = (change: (current: Camera) => Camera) =>
    setManual((previous) => ({
      key: worldKey,
      camera: change(previous?.key === worldKey ? previous.camera : fitted),
    }));

  const lines = ready ? gridLines(grid, info) : { xs: [], ys: [] };
  const segments = [
    ...lines.xs.map((x) => ({ key: `x${x}`, axis: 'x', points: [x, 0, x, world.height] })),
    ...lines.ys.map((y) => ({ key: `y${y}`, axis: 'y', points: [0, y, world.width, y] })),
  ];
  const opacity = overlayOpacity(mode, grid.visible);
  const dm = mode === 'dm';
  const measuring = dm && measure !== undefined && info !== undefined;
  const frame = ready ? gridFrame(grid, info) : undefined;
  const place = dm && !measuring && placing && frame ? { ...placing, frame } : undefined;
  const placingNow = place !== undefined;
  // The ruler measures only when neither calibration nor placing has the pointer, on a drawn grid.
  const rulerTool = dm && !measuring && !placingNow && frame ? ruler?.tool : undefined;
  const rulerOn = rulerTool?.on === true;
  // The ping tool (TBL-01), under the same conditions; a click pings and a drag still pans.
  const pingTool = dm && !measuring && !placingNow && frame ? ping?.tool : undefined;
  const pingOn = pingTool?.on === true && !rulerOn;
  // The fog brush (TBL-04): a drag paints or erases a stroke, sent when the pointer is released; the stroke
  // so far is shown as the fog it would leave, and a stroke sent goes on showing until the fog it made
  // arrives, or until it is refused.
  const fogTool = dm && !measuring && !placingNow && frame ? fog?.tool : undefined;
  const fogOn = fogTool?.on === true && !rulerOn && !pingOn;
  const fogStroke = useRef<Point[]>(undefined);
  const fogPan = useRef<{ x: number; y: number }>(undefined);
  const [fogPainting, setFogPainting] = useState(false);
  const [fogPreview, setFogPreview] = useState<{ base: FogMask; mask: FogMask }>();
  const brushCursor = useRef<Konva.Circle>(null);
  if (fogPreview && fogPreview.base !== fog?.fog && !fogPainting) setFogPreview(undefined);
  if (!fogOn && fogPainting) {
    fogStroke.current = undefined;
    setFogPainting(false);
    setFogPreview(undefined);
  }
  const extent = frame ? fogExtent(grid, info ? info.original : null) : undefined;
  const shownFog = fogPreview && fogPreview.base === fog?.fog ? fogPreview.mask : fog?.fog;
  // Space held down: a drag pans the view, whatever the tool (UIX-01).
  const [spaceHeld, setSpaceHeld] = useState(false);
  const panning = dm && spaceHeld;
  // Tokens are selected and dragged only when nothing else uses the pointer.
  const selecting = dm && !measuring && !placingNow && !rulerOn && !pingOn && !fogOn && !panning;
  // The token the mouse rests on, previewed only while tokens may be selected (UXR-06).
  const [previewId, setPreviewId] = useState<string>();
  const previewing = selecting && tokenControls !== undefined && preview !== undefined;
  if (!previewing && previewId !== undefined) setPreviewId(undefined);
  const controls =
    selecting && tokenControls
      ? previewing
        ? { ...tokenControls, onPreview: setPreviewId }
        : tokenControls
      : undefined;
  const selected = controls && tokens.find((token) => token.id === controls.selectedId);
  // Map notes (UXR-08) are clicked and dragged under the same conditions as tokens, and previewed likewise.
  const [notePreviewId, setNotePreviewId] = useState<string>();
  const notePreviewing = selecting && mapNoteControls !== undefined && notePreview !== undefined;
  if (!notePreviewing && notePreviewId !== undefined) setNotePreviewId(undefined);
  const noteControls =
    dm && selecting && mapNoteControls
      ? notePreviewing
        ? { ...mapNoteControls, onPreview: setNotePreviewId }
        : mapNoteControls
      : undefined;
  // The TV frame, in world pixels: the one being dragged, or the player camera widened to the TV's shape.
  const [frameDraft, setFrameDraft] = useState<WorldBox>();
  const frameAnchor = useRef<{ x: number; y: number }>(undefined);
  const tv = dm && ready && tvFrame ? tvFrame : undefined;
  const aspect = liveAspect ?? 1;
  // The frame is never narrower than the TV can zoom to, nor wider than it can show (review C-M1, C-M2).
  const limits = tv ? frameLimits(world, aspect, tv.screen) : undefined;
  const frameBox = tv && limits ? boundFrame(frameOf(tv.camera, world, aspect), aspect, limits) : undefined;
  // Follow my view (DMT-03): the TV shows the DM's whole view, so there is no frame to show or move.
  const following = tv?.follow !== undefined;
  const shownFrame = tv && !following ? (frameDraft ?? frameBox) : undefined;
  const frameMovable =
    tv !== undefined &&
    !following &&
    !tv.offline &&
    !tv.locked &&
    !measuring &&
    !placingNow &&
    !rulerOn &&
    !pingOn &&
    !fogOn &&
    !panning;
  // The camera that shows `box`; nothing is sent when that is the camera already (review C-M2, U-M1).
  const cameraFor = (box: WorldBox | 'fit'): PlayerCamera =>
    box === 'fit' || !limits ? FIT_CAMERA : rectOf(boundFrame(box, aspect, limits), world);
  const steerTo = (box: WorldBox | 'fit') => {
    if (!tv || tv.locked) return;
    const next = cameraFor(box);
    if (!sameRect(next, tv.camera)) tv.onChange(next);
  };

  // Follow my view (DMT-03): the camera that shows the DM's whole view on the TV, reported when it changes.
  const followed =
    following && viewport.width > 0 && viewport.height > 0
      ? followRect(visibleBox(camera, viewport), world, aspect)
      : undefined;
  const followKey = followed && `${followed.centre_x}:${followed.centre_y}:${followed.width}:${followed.height}`;
  const toFollow = useRef<{ camera: PlayerCamera; report: (camera: PlayerCamera) => void }>(undefined);
  toFollow.current = followed && tv?.follow ? { camera: followed, report: tv.follow } : undefined;
  useEffect(() => {
    if (followKey !== undefined) toFollow.current?.report(toFollow.current.camera);
  }, [followKey]);

  // The scene's TV camera buttons and token list (UIX-01).
  useImperativeHandle(ref, () => ({
    sendView: () => steerTo(coverBox(visibleBox(camera, viewport), aspect)),
    tvZoom: (direction) => {
      if (frameBox) steerTo(scaleBox(frameBox, direction === 'in' ? 1 / ZOOM_STEP : ZOOM_STEP));
    },
    tvFit: () => steerTo('fit'),
    centreOn: (tokenId) => {
      const token = tokens.find((each) => each.id === tokenId);
      if (!token || !frame) return;
      const at = toWorld(frame, token);
      const half = (footprint(token.size) * frame.square) / 2;
      changeCamera((current) => ({
        ...current,
        x: viewport.width / 2 - (at.x + half) * current.scale,
        y: viewport.height / 2 - (at.y + half) * current.scale,
      }));
    },
  }));

  // Space held pans: read from the window, and not while a text field has focus.
  useEffect(() => {
    if (!dm) return;
    const typing = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement);
    const down = (event: globalThis.KeyboardEvent) => {
      if (event.code === 'Space' && !typing(event.target) && !event.repeat) setSpaceHeld(true);
    };
    const up = (event: globalThis.KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false);
    };
    const blur = () => setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [dm]);
  // The drag being measured: the ref is what the handlers read, the state what is drawn, so a
  // release seen twice (by the stage and by the window) reports once.
  const dragRef = useRef<Drag>(undefined);
  const [dragging, setDraggingState] = useState<Drag>();
  const setDragging = (drag: Drag | undefined) => {
    dragRef.current = drag;
    setDraggingState(drag);
  };

  // Centred on `at`, snapped unless Alt, and kept on the map.
  const placeAt = (target: Placing & { frame: typeof frame & object }, at: Point, alt: boolean): Point =>
    clampToWorld(target.frame, world, placePosition(target.frame, at, target.size, alt), target.size, !alt);

  // A library asset dragged over the map: its footprint where it would land (UXR-03).
  const [dropping, setDropping] = useState<{ at: Point; size: TokenSize }>();
  const dropTarget = dm && !measuring && frame ? assetDrop : undefined;
  const dropPoint = (event: ReactDragEvent<HTMLDivElement>): { at: Point; size: TokenSize } | undefined => {
    const size = dropTarget?.sizeOf([...event.dataTransfer.types]);
    if (!size || !frame) return undefined;
    const box = event.currentTarget.getBoundingClientRect();
    const pointer = {
      x: (event.clientX - box.left - camera.x) / camera.scale,
      y: (event.clientY - box.top - camera.y) / camera.scale,
    };
    return { at: placeAt({ size, frame, onPlace: () => {}, onCancel: () => {} }, pointer, event.altKey), size };
  };
  const dropHandlers = dropTarget
    ? {
        onDragOver: (event: ReactDragEvent<HTMLDivElement>) => {
          const point = dropPoint(event);
          if (!point) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDropping((now) =>
            now && now.size === point.size && now.at.x === point.at.x && now.at.y === point.at.y ? now : point,
          );
        },
        onDragLeave: (event: ReactDragEvent<HTMLDivElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(undefined);
        },
        onDrop: (event: ReactDragEvent<HTMLDivElement>) => {
          const point = dropPoint(event);
          setDropping(undefined);
          if (!point) return;
          event.preventDefault();
          dropTarget.onDrop(point.at);
        },
      }
    : {};

  // The world point at the centre of the view, where Enter places a token.
  const centreWorld = (): Point => ({
    x: (viewport.width / 2 - camera.x) / camera.scale,
    y: (viewport.height / 2 - camera.y) / camera.scale,
  });

  // The measurement drawn: its ends' centres in the world, and the path the keys move from.
  const shownRuler = frame && ruler?.shown ? ruler.shown : undefined;
  const rulerEnds =
    shownRuler && frame ? [squareCentre(frame, shownRuler.from), squareCentre(frame, shownRuler.to)] : [];
  const shownPath: RulerPath | null = shownRuler ? { from: shownRuler.from, to: shownRuler.to } : null;
  const distanceText = shownRuler ? t('canvas.rulerDistance', { feet: formatNumber(shownRuler.feet) }) : '';
  // Kept inside the view, so the distance is readable wherever the end lies (review U-M3). The label's width
  // is estimated from its text, bold digits being about 0.62 of the font size wide.
  const labelStyle = RULER_LABEL[mode];
  const distanceOffset =
    rulerEnds.length === 2
      ? labelOffset(
          { x: camera.x + rulerEnds[1]!.x * camera.scale, y: camera.y + rulerEnds[1]!.y * camera.scale },
          {
            width: distanceText.length * labelStyle.fontSize * 0.62 + labelStyle.padding * 2,
            height: labelStyle.fontSize + labelStyle.padding * 2,
          },
          viewport,
          labelStyle.gap,
        )
      : { offsetX: 0, offsetY: 0 };

  const ARROWS: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };

  function onKeyDown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (place) {
      if (event.key === 'Enter') {
        event.preventDefault();
        place.onPlace(placeAt(place, centreWorld(), false));
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        place.onCancel();
        return;
      }
    }
    // F turns the fog brush on and off; with it on, Enter paints a dab at the centre of the view, E switches
    // painting and erasing, [ and ] make the brush smaller and larger, and Escape drops the stroke under way,
    // or leaves the brush when there is none.
    if (fogTool && (event.key === 'f' || event.key === 'F')) {
      event.preventDefault();
      if (!event.repeat) fogTool.onToggle(!fogOn);
      return;
    }
    if (fogOn && fogTool && frame) {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!event.repeat) sendStroke([toGrid(frame, centreWorld())]);
        return;
      }
      if (event.key === 'e' || event.key === 'E') {
        event.preventDefault();
        if (!event.repeat) fogTool.onErase(!fogTool.erase);
        return;
      }
      if (event.key === '[' || event.key === ']') {
        event.preventDefault();
        const step = event.key === '[' ? -FOG_BRUSH_RADIUS.step : FOG_BRUSH_RADIUS.step;
        const next = Math.min(FOG_BRUSH_RADIUS.max, Math.max(FOG_BRUSH_RADIUS.min, fogTool.radius + step));
        if (next !== fogTool.radius) fogTool.onRadius(next);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (fogStroke.current) {
          fogStroke.current = undefined;
          setFogPainting(false);
          setFogPreview(undefined);
        } else fogTool.onToggle(false);
        return;
      }
    }
    // P turns the ping tool on and off; with it on, Enter pings the centre of the view and Escape leaves it.
    if (pingTool && (event.key === 'p' || event.key === 'P')) {
      event.preventDefault();
      if (!event.repeat) pingTool.onToggle(!pingOn);
      return;
    }
    if (pingOn && frame) {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!event.repeat) pingTool.onPing(toGrid(frame, centreWorld()));
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        pingTool.onToggle(false);
        return;
      }
    }
    // M turns the ruler on and off from the canvas itself (LIV-07).
    if (rulerTool && (event.key === 'm' || event.key === 'M')) {
      event.preventDefault();
      if (!event.repeat) rulerTool.onToggle(!rulerOn);
      return;
    }
    if (rulerOn && frame) {
      const centre = squareAt(frame, centreWorld());
      if (event.key === 'Escape') {
        event.preventDefault();
        if (shownPath) rulerTool.onClear();
        else rulerTool.onToggle(false);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        rulerTool.onMeasure({ from: centre, to: centre }, true);
        return;
      }
      const next = rulerForKey(shownPath, event.key, event.shiftKey, centre);
      if (next) {
        event.preventDefault();
        rulerTool.onMeasure(next, true);
        return;
      }
    }
    // With the ruler off, Escape still takes a measurement off, another browser's too (review U-L4), unless
    // Escape means something else here first (a selected token).
    const rulerEscape = rulerTool && !rulerOn && shownPath && !selected && event.key === 'Escape';
    if (rulerEscape) {
      event.preventDefault();
      rulerTool.onClear();
      return;
    }
    // Space pans with the pointer; on the map it scrolls nothing (UIX-01).
    if (event.key === ' ') {
      event.preventDefault();
      return;
    }
    // Fit, in live mode, fits the map and the TV's frame (review U-H1).
    if (event.key === '0' && !event.shiftKey) {
      event.preventDefault();
      setManual(undefined);
      return;
    }
    // Escape closes an open map note's popover (UXR-08).
    if (event.key === 'Escape' && mapNoteControls?.openId !== undefined) {
      event.preventDefault();
      mapNoteControls.onClosePopover();
      return;
    }
    if (controls && selected) {
      const arrow = ARROWS[event.key];
      // A group moves together, each token by its own step (UXR-02).
      const group = (controls.selectedIds ?? []).flatMap((id) => tokens.filter((token) => token.id === id));
      if (arrow && group.length > 1 && controls.onMoveMany) {
        event.preventDefault();
        controls.onMoveMany(group.map((token) => ({ id: token.id, at: nudge(token, token.size, arrow[0], arrow[1]) })));
        return;
      }
      if (arrow) {
        event.preventDefault();
        controls.onMove(selected.id, nudge(selected, selected.size, arrow[0], arrow[1]));
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        controls.onDeselect();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        controls.onDelete(selected.id);
        return;
      }
    }
    if (!cameraForKey(camera, event.key, event.shiftKey, world, viewport)) return;
    event.preventDefault();
    const { key, shiftKey } = event;
    changeCamera((current) => cameraForKey(current, key, shiftKey, world, viewport) ?? current);
  }

  function onWheel(event: Konva.KonvaEventObject<WheelEvent>) {
    event.evt.preventDefault();
    // A sideways swipe has no vertical part and means no zoom.
    if (event.evt.deltaY === 0) return;
    const at = event.target.getStage()?.getPointerPosition() ?? { x: viewport.width / 2, y: viewport.height / 2 };
    const factor = event.evt.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
    changeCamera((current) => zoomAt(current, factor, at));
  }

  function onDrag(event: Konva.KonvaEventObject<DragEvent>) {
    const stage = event.target;
    if (stage !== stage.getStage()) return;
    const position = { x: stage.x(), y: stage.y() };
    changeCamera((current) => ({ ...current, ...position }));
  }

  const worldPoint = (event: Konva.KonvaEventObject<PointerEvent>) =>
    event.target.getStage()?.getRelativePointerPosition();

  // The pointer is captured on press, so a release over the panel above still reaches the stage;
  // a release the stage never sees ends the drag from the window, with the last point dragged to
  // (D-096).
  function onMeasureDown(event: Konva.KonvaEventObject<PointerEvent>) {
    const at = worldPoint(event);
    if (!at) return;
    const content = event.target.getStage()?.content;
    if (typeof event.evt.pointerId === 'number') content?.setPointerCapture?.(event.evt.pointerId);
    setDragging({ start: at, end: at });
  }

  function onMeasureMove(event: Konva.KonvaEventObject<PointerEvent>) {
    const current = dragRef.current;
    if (!current) return;
    // No button held: the release happened where nothing saw it.
    if (event.evt.buttons === 0) return finishMeasure(undefined);
    const at = worldPoint(event);
    if (at) setDragging({ ...current, end: at });
  }

  function finishMeasure(at: { x: number; y: number } | undefined) {
    const current = dragRef.current;
    setDragging(undefined);
    if (!current || !info || !measure) return;
    const end = at ?? current.end;
    const box = normalise({
      x: current.start.x,
      y: current.start.y,
      width: end.x - current.start.x,
      height: end.y - current.start.y,
    });
    if (box.width * camera.scale < MIN_RECT_PX || box.height * camera.scale < MIN_RECT_PX) return;
    measure.onDraw(scaled(box, info.original.width / info.display.width));
  }

  // A ruler drag: from the square pressed to the square under the pointer, reported on each new square. A
  // drag with the right or middle button pans the view instead, so the DM can reach squares off screen
  // while measuring (review U-M2).
  const rulerDrag = useRef<RulerPath>(undefined);
  const rulerPan = useRef<{ x: number; y: number }>(undefined);
  const [rulerDragging, setRulerDragging] = useState(false);
  function onRulerDown(event: Konva.KonvaEventObject<PointerEvent>) {
    const at = worldPoint(event);
    if (!at || !frame || !rulerTool) return;
    const content = event.target.getStage()?.content;
    if (typeof event.evt.pointerId === 'number') content?.setPointerCapture?.(event.evt.pointerId);
    if (event.evt.button === 1 || event.evt.button === 2) {
      event.evt.preventDefault();
      rulerPan.current = { x: event.evt.clientX, y: event.evt.clientY };
      setRulerDragging(true);
      return;
    }
    const square = squareAt(frame, at);
    rulerDrag.current = { from: square, to: square };
    setRulerDragging(true);
    rulerTool.onMeasure(rulerDrag.current, false);
  }
  function onRulerMove(event: Konva.KonvaEventObject<PointerEvent>) {
    const pan = rulerPan.current;
    if (pan) {
      if (event.evt.buttons === 0) return finishRuler();
      const { clientX, clientY } = event.evt;
      rulerPan.current = { x: clientX, y: clientY };
      changeCamera((current) => panBy(current, clientX - pan.x, clientY - pan.y));
      return;
    }
    const current = rulerDrag.current;
    if (!current || !frame || !rulerTool) return;
    if (event.evt.buttons === 0) return finishRuler();
    const at = worldPoint(event);
    if (!at) return;
    const square = squareAt(frame, at);
    if (sameSquare(square, current.to)) return;
    rulerDrag.current = { from: current.from, to: square };
    rulerTool.onMeasure(rulerDrag.current, false);
  }
  function finishRuler() {
    if (rulerPan.current) {
      rulerPan.current = undefined;
      setRulerDragging(false);
      return;
    }
    const current = rulerDrag.current;
    rulerDrag.current = undefined;
    setRulerDragging(false);
    if (current) rulerTool?.onMeasure(current, true);
  }
  const rulerReleased = useEffectEvent(() => finishRuler());
  useEffect(() => {
    if (!rulerDragging) return;
    const up = () => rulerReleased();
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [rulerDragging]);

  const releasedElsewhere = useEffectEvent(() => finishMeasure(undefined));
  const cancelled = useEffectEvent(() => setDragging(undefined));
  const isDragging = dragging !== undefined;
  useEffect(() => {
    if (!isDragging) return;
    const up = () => releasedElsewhere();
    const cancel = () => cancelled();
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [isDragging]);

  // The rectangle being dragged, or the one last measured, in world pixels; none once measuring ends.
  const shownRect: Box | undefined = !measuring
    ? undefined
    : dragging
      ? normalise({
          x: dragging.start.x,
          y: dragging.start.y,
          width: dragging.end.x - dragging.start.x,
          height: dragging.end.y - dragging.start.y,
        })
      : measure.rect
        ? scaled(measure.rect, info.display.width / info.original.width)
        : undefined;
  // While dragging, the rectangle's size in original pixels beside it, kept upright and readable at any zoom.
  const dragSize =
    measuring && dragging && shownRect
      ? t('canvas.measureSize', {
          width: formatDecimal((shownRect.width * info.original.width) / info.display.width),
          height: formatDecimal((shownRect.height * info.original.width) / info.display.width),
        })
      : undefined;

  // The frame dropped where it was dragged, or resized from a corner: the camera it shows is sent, and
  // the frame is put where that camera draws it, kept on the world, even when the camera is unchanged.
  function frameDropped(node: Konva.Node, box: WorldBox, at: (placed: WorldBox) => { x: number; y: number }) {
    setFrameDraft(undefined);
    frameAnchor.current = undefined;
    if (!tv || !limits) return;
    const next = cameraFor(box);
    node.position(at(boundFrame(frameOf(next, world, aspect), aspect, limits)));
    if (!sameRect(next, tv.camera)) tv.onChange(next);
  }

  // A click that did not drag the view: places the token being placed, or lets the selection go.
  function onStageClick(event: Konva.KonvaEventObject<MouseEvent>) {
    if (event.target !== event.target.getStage()) return;
    if (place) {
      const at = event.target.getStage()?.getRelativePointerPosition();
      if (at) place.onPlace(placeAt(place, at, event.evt.altKey));
      return;
    }
    if (mapNoteControls?.openId !== undefined) mapNoteControls.onClosePopover();
    if (controls?.selectedId !== undefined) controls.onDeselect();
  }

  // The fog brush (TBL-04). A point is kept to a thousandth of a square, as a free token position is.
  const brushPoint = (at: Point): Point => {
    const grid = toGrid(frame!, at);
    return { x: Math.round(grid.x * 1000) / 1000 + 0, y: Math.round(grid.y * 1000) / 1000 + 0 };
  };
  /** Shows the stroke so far as the fog it would leave, by the same rule the server applies. */
  function previewStroke(points: Point[]) {
    if (!fogTool || !fog || !extent) return;
    const stroke: FogStroke = { mode: fogTool.erase ? 'erase' : 'paint', radius: fogTool.radius, points };
    setFogPreview({ base: fog.fog, mask: applyStroke(fog.fog, stroke, extent) });
  }
  /** Sends a stroke; one refused stops showing. */
  function sendStroke(points: Point[]) {
    if (!fogTool || points.length === 0) return;
    previewStroke(points);
    const stroke: FogStroke = { mode: fogTool.erase ? 'erase' : 'paint', radius: fogTool.radius, points };
    void fogTool.onPaint(stroke).then((taken) => {
      if (!taken) setFogPreview(undefined);
    });
  }
  function moveBrush(at: Point | undefined) {
    const cursor = brushCursor.current;
    if (!cursor) return;
    if (at) cursor.position(at);
    cursor.visible(at !== undefined);
    cursor.getLayer()?.batchDraw();
  }
  function onFogDown(event: Konva.KonvaEventObject<PointerEvent>) {
    const at = worldPoint(event);
    if (!at || !frame || !fogTool) return;
    const content = event.target.getStage()?.content;
    if (typeof event.evt.pointerId === 'number') content?.setPointerCapture?.(event.evt.pointerId);
    // The right or middle button pans, so the DM reaches the map off screen while painting.
    if (event.evt.button === 1 || event.evt.button === 2) {
      event.evt.preventDefault();
      fogPan.current = { x: event.evt.clientX, y: event.evt.clientY };
      setFogPainting(true);
      return;
    }
    if (event.evt.button !== 0) return;
    fogStroke.current = [brushPoint(at)];
    setFogPainting(true);
    previewStroke(fogStroke.current);
  }
  function onFogMove(event: Konva.KonvaEventObject<PointerEvent>) {
    const at = worldPoint(event);
    moveBrush(at ?? undefined);
    const pan = fogPan.current;
    if (pan) {
      if (event.evt.buttons === 0) return finishFog();
      const { clientX, clientY } = event.evt;
      fogPan.current = { x: clientX, y: clientY };
      changeCamera((current) => panBy(current, clientX - pan.x, clientY - pan.y));
      return;
    }
    const points = fogStroke.current;
    if (!points || !at || !fogTool) return;
    if (event.evt.buttons === 0) return finishFog();
    const point = brushPoint(at);
    const last = points.at(-1)!;
    // A new point every quarter of the radius: close enough that the stroke reads as one line.
    if (Math.hypot(point.x - last.x, point.y - last.y) < fogTool.radius / 4) return;
    points.push(point);
    const long =
      points.length >= FOG_STROKE_MAX_POINTS ||
      strokeWork({ mode: 'paint', radius: fogTool.radius, points }) > FOG_STROKE_MAX_WORK / 2;
    if (long) {
      // A stroke that long goes as it is, and the drag goes on as a new one from where it got to.
      sendStroke(points);
      fogStroke.current = [point];
      return;
    }
    previewStroke(points);
  }
  function finishFog() {
    if (fogPan.current) {
      fogPan.current = undefined;
      setFogPainting(false);
      return;
    }
    const points = fogStroke.current;
    fogStroke.current = undefined;
    setFogPainting(false);
    if (points) sendStroke(points);
  }
  const fogReleased = useEffectEvent(() => finishFog());
  useEffect(() => {
    if (!fogPainting) return;
    const up = () => fogReleased();
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [fogPainting]);

  // A click with the ping tool on pings the point clicked (TBL-01).
  function onPingClick(event: Konva.KonvaEventObject<MouseEvent>) {
    const at = event.target.getStage()?.getRelativePointerPosition();
    if (at && frame && pingTool) pingTool.onPing(toGrid(frame, at));
  }

  // A pan, by Space or by dragging the empty map, closes the selected token's popover, and it stays closed
  // when the pan ends (D-156). A token or the TV frame being dragged bubbles up here too, and is not a pan.
  function onPanStart(event: Konva.KonvaEventObject<DragEvent>) {
    if (event.target !== event.target.getStage()) return;
    tokenControls?.onClosePopover();
    mapNoteControls?.onClosePopover();
  }

  const panHandlers = { onWheel, onDragMove: onDrag, onDragEnd: onDrag };
  const toolHandlers = !dm
    ? {}
    : panning
      ? panHandlers
      : measuring
        ? {
            onWheel,
            onPointerDown: onMeasureDown,
            onPointerMove: onMeasureMove,
            onPointerUp: (event: Konva.KonvaEventObject<PointerEvent>) => finishMeasure(worldPoint(event) ?? undefined),
          }
        : rulerOn
          ? { onWheel, onPointerDown: onRulerDown, onPointerMove: onRulerMove, onPointerUp: () => finishRuler() }
          : pingOn
            ? { onWheel, onDragMove: onDrag, onDragEnd: onDrag, onClick: onPingClick }
            : fogOn
              ? {
                  onWheel,
                  onPointerDown: onFogDown,
                  onPointerMove: onFogMove,
                  onPointerUp: () => finishFog(),
                  onMouseLeave: () => moveBrush(undefined),
                }
              : { onWheel, onDragMove: onDrag, onDragEnd: onDrag, onClick: onStageClick };
  const handlers = dm ? { ...toolHandlers, onDragStart: onPanStart } : toolHandlers;

  const centre = { x: viewport.width / 2, y: viewport.height / 2 };
  const stage = (
    <Stage
      width={viewport.width}
      height={viewport.height}
      x={camera.x}
      y={camera.y}
      scaleX={camera.scale}
      scaleY={camera.scale}
      draggable={dm && (panning || (!measuring && !rulerOn && !fogOn))}
      listening={dm}
      {...handlers}
    >
      <Layer listening={false}>
        {map === null ? (
          <Rect name="extent" width={world.width} height={world.height} fill={CANVAS_COLOURS.extent} />
        ) : displayImage && ready ? (
          <KonvaImage name="map" image={displayImage} width={world.width} height={world.height} />
        ) : null}
      </Layer>
      <Layer listening={false}>
        {opacity > 0 ? (
          <Group name="grid" opacity={opacity}>
            {/* A dark halo under each light line keeps the grid visible on light maps too. */}
            {segments.map(({ key, points }) => (
              <Line
                key={`halo-${key}`}
                name="grid-halo"
                points={points}
                stroke={CANVAS_COLOURS.halo}
                strokeWidth={3}
                strokeScaleEnabled={false}
              />
            ))}
            {segments.map(({ key, points, axis }) => (
              <Line
                key={key}
                name={`grid-line grid-line-${axis}`}
                points={points}
                stroke={CANVAS_COLOURS.grid}
                strokeWidth={1}
                strokeScaleEnabled={false}
              />
            ))}
          </Group>
        ) : null}
        {shownRect ? (
          <Rect
            name="measure-halo"
            {...shownRect}
            stroke={CANVAS_COLOURS.halo}
            strokeWidth={4}
            strokeScaleEnabled={false}
          />
        ) : null}
        {shownRect ? (
          <Rect
            name="measure"
            {...shownRect}
            stroke={CANVAS_COLOURS.measure}
            strokeWidth={2}
            dash={[6, 4]}
            strokeScaleEnabled={false}
          />
        ) : null}
        {shownRect && dragSize ? (
          <Label
            name="measure-size"
            x={shownRect.x}
            y={shownRect.y}
            offsetY={24}
            scaleX={1 / camera.scale}
            scaleY={1 / camera.scale}
          >
            <Tag fill={CANVAS_COLOURS.halo} cornerRadius={3} />
            <Text text={dragSize} fill={CANVAS_COLOURS.grid} fontSize={13} padding={4} />
          </Label>
        ) : null}
      </Layer>
      {frame && fog && shownFog ? (
        <FogLayer
          fog={shownFog}
          frame={frame}
          scale={camera.scale}
          mode={mode}
          brush={fogOn && fogTool ? { radius: fogTool.radius, erase: fogTool.erase } : undefined}
          cursorRef={brushCursor}
        />
      ) : null}
      {frame ? (
        <TokenLayer
          tokens={tokens}
          frame={frame}
          scale={camera.scale}
          mode={mode}
          controls={controls}
          labelScale={dm ? 1 : labelScale}
          view={view}
        />
      ) : null}
      {dm && frame && mapNotes.length > 0 ? (
        <MapNoteLayer notes={mapNotes} frame={frame} scale={camera.scale} controls={noteControls} view={view} />
      ) : null}
      {tv && shownFrame ? (
        <Layer name="tv-frame-layer" listening={frameMovable} opacity={tv.offline ? 0.5 : 1}>
          {/* The map outside what the TV shows, dimmed (UIX-01): one shape with the frame cut out of it. */}
          <Shape
            name="tv-frame-dim"
            listening={false}
            fill={CANVAS_COLOURS.tvDim}
            fillRule="evenodd"
            sceneFunc={(context, shape) => {
              const reach = Math.max(world.width, world.height) * 20;
              context.beginPath();
              context.rect(-reach, -reach, reach * 3, reach * 3);
              context.rect(shownFrame.x, shownFrame.y, shownFrame.width, shownFrame.height);
              context.fillStrokeShape(shape);
            }}
          />
          <Rect
            name="tv-frame-halo"
            {...shownFrame}
            stroke={CANVAS_COLOURS.halo}
            strokeWidth={6}
            strokeScaleEnabled={false}
            listening={false}
          />
          <Rect
            name="tv-frame"
            {...shownFrame}
            stroke={CANVAS_COLOURS.tvFrame}
            strokeWidth={2}
            {...(tv.locked ? { dash: [10, 5] } : {})}
            strokeScaleEnabled={false}
            hitStrokeWidth={FRAME_GRIP_PX}
            fillEnabled={false}
            draggable={frameMovable}
            onPointerDown={(event) => {
              event.cancelBubble = true;
            }}
            onDragMove={(event) => {
              const base = frameDraft ?? frameBox!;
              setFrameDraft({ ...base, x: event.target.x(), y: event.target.y() });
            }}
            onDragEnd={(event) =>
              frameDropped(
                event.target,
                { ...(frameDraft ?? frameBox!), x: event.target.x(), y: event.target.y() },
                (placed) => ({ x: placed.x, y: placed.y }),
              )
            }
          />
          <Label
            name="tv-frame-label"
            x={shownFrame.x}
            y={shownFrame.y}
            offsetY={24}
            scaleX={1 / camera.scale}
            scaleY={1 / camera.scale}
            listening={false}
          >
            <Tag fill={CANVAS_COLOURS.tvFrame} cornerRadius={[5, 5, 0, 0]} />
            <Text
              text={t(tv.locked ? 'canvas.tvFrameLocked' : 'canvas.tvFrame')}
              fill={CANVAS_COLOURS.tvFrameText}
              fontFamily={CANVAS_FONT}
              fontStyle="bold"
              fontSize={12}
              padding={6}
            />
          </Label>
          {(tv.locked ? [] : CORNERS).map((corner) => {
            const at = cornerOf(shownFrame, corner);
            const side = HANDLE_PX / camera.scale;
            return (
              <Rect
                key={corner}
                name={`tv-frame-handle tv-frame-handle-${corner}`}
                x={at.x}
                y={at.y}
                offsetX={side / 2}
                offsetY={side / 2}
                width={side}
                height={side}
                fill={CANVAS_COLOURS.tvFrame}
                cornerRadius={2 / camera.scale}
                draggable={frameMovable}
                onPointerDown={(event) => {
                  event.cancelBubble = true;
                }}
                onDragStart={() => {
                  frameAnchor.current = cornerOf(frameBox!, OPPOSITE[corner]);
                }}
                onDragMove={(event) => {
                  const anchor = frameAnchor.current ?? cornerOf(frameBox!, OPPOSITE[corner]);
                  setFrameDraft(resizeBox(anchor, event.target.position(), aspect, limits!));
                }}
                onDragEnd={(event) => {
                  const anchor = frameAnchor.current ?? cornerOf(frameBox!, OPPOSITE[corner]);
                  frameDropped(event.target, resizeBox(anchor, event.target.position(), aspect, limits!), (placed) =>
                    cornerOf(placed, corner),
                  );
                }}
              />
            );
          })}
        </Layer>
      ) : null}
      {shownRuler && rulerEnds.length === 2 ? (
        // The measurement: a line between the two square centres over a dark halo, its ends marked, and
        // the distance beside the end, upright and readable at any zoom; larger on the TV (LIV-07).
        <Layer name="ruler-layer" listening={false}>
          <Line
            name="ruler-halo"
            points={[rulerEnds[0]!.x, rulerEnds[0]!.y, rulerEnds[1]!.x, rulerEnds[1]!.y]}
            stroke={CANVAS_COLOURS.halo}
            strokeWidth={dm ? 6 : 10}
            lineCap="round"
            strokeScaleEnabled={false}
          />
          <Line
            name="ruler-line"
            points={[rulerEnds[0]!.x, rulerEnds[0]!.y, rulerEnds[1]!.x, rulerEnds[1]!.y]}
            stroke={CANVAS_COLOURS.measure}
            strokeWidth={dm ? 3 : 5}
            lineCap="round"
            strokeScaleEnabled={false}
          />
          {rulerEnds.map((end, index) => (
            <Group key={index} name="ruler-end" {...end} scaleX={1 / camera.scale} scaleY={1 / camera.scale}>
              <Circle radius={dm ? 6 : 10} fill={CANVAS_COLOURS.measure} stroke={CANVAS_COLOURS.halo} strokeWidth={2} />
            </Group>
          ))}
          <Label
            name="ruler-distance"
            x={rulerEnds[1]!.x}
            y={rulerEnds[1]!.y}
            {...distanceOffset}
            scaleX={1 / camera.scale}
            scaleY={1 / camera.scale}
          >
            <Tag fill={CANVAS_COLOURS.halo} cornerRadius={4} />
            <Text
              text={distanceText}
              fill={CANVAS_COLOURS.grid}
              fontFamily={CANVAS_FONT}
              fontSize={RULER_LABEL[mode].fontSize}
              fontStyle="bold"
              padding={RULER_LABEL[mode].padding}
            />
          </Label>
        </Layer>
      ) : null}
      {frame && ping ? (
        <PingLayer pings={ping.shown} frame={frame} scale={camera.scale} labelScale={labelScale} />
      ) : null}
      {dropping && frame ? (
        // The footprint of the asset dragged over the map, where it would land (UXR-03).
        <Layer listening={false}>
          <Rect
            name="drop-target"
            {...toWorld(frame, dropping.at)}
            width={footprint(dropping.size) * frame.square}
            height={footprint(dropping.size) * frame.square}
            cornerRadius={(footprint(dropping.size) * frame.square) / 2}
            fill={CANVAS_COLOURS.dropFill}
            stroke={CANVAS_COLOURS.measure}
            strokeWidth={2 / camera.scale}
            dash={[6 / camera.scale, 4 / camera.scale]}
          />
        </Layer>
      ) : null}
      {place ? (
        // Where Enter places the token: the centre of the view, marked while placing (review).
        <Layer listening={false}>
          <Group name="place-target" {...centreWorld()} scaleX={1 / camera.scale} scaleY={1 / camera.scale}>
            <Circle radius={10} stroke={CANVAS_COLOURS.halo} strokeWidth={4} />
            <Circle radius={10} stroke={CANVAS_COLOURS.measure} strokeWidth={2} />
            <Line points={[-16, 0, 16, 0]} stroke={CANVAS_COLOURS.measure} strokeWidth={2} />
            <Line points={[0, -16, 0, 16]} stroke={CANVAS_COLOURS.measure} strokeWidth={2} />
          </Group>
        </Layer>
      ) : null}
    </Stage>
  );

  // The camera and the overlay state are on the element for the end-to-end tests, which read
  // the drawn pixels through them; none of it is hidden information.
  const state = {
    'data-camera-x': camera.x,
    'data-camera-y': camera.y,
    'data-camera-scale': camera.scale,
    'data-grid': opacity === 0 ? 'none' : grid.visible ? 'shown' : 'faint',
  };
  // The TV frame on screen, in pixels from the viewport's corner, for the end-to-end tests (LIV-06).
  const frameState = shownFrame
    ? {
        'data-tv-frame': JSON.stringify({
          left: camera.x + shownFrame.x * camera.scale,
          top: camera.y + shownFrame.y * camera.scale,
          width: shownFrame.width * camera.scale,
          height: shownFrame.height * camera.scale,
        }),
        'data-tv-locked': tv?.locked ? 'on' : 'off',
      }
    : following
      ? { 'data-tv-follow': 'on' }
      : {};
  // The measurement drawn, its squares, distance and ends in screen pixels, for the end-to-end tests (LIV-07).
  const rulerState =
    shownRuler && rulerEnds.length === 2
      ? {
          'data-ruler': JSON.stringify({
            from: shownRuler.from,
            to: shownRuler.to,
            feet: shownRuler.feet,
            start: { x: camera.x + rulerEnds[0]!.x * camera.scale, y: camera.y + rulerEnds[0]!.y * camera.scale },
            end: { x: camera.x + rulerEnds[1]!.x * camera.scale, y: camera.y + rulerEnds[1]!.y * camera.scale },
          }),
        }
      : {};
  // The fog drawn, its rows of fogged cells, for the end-to-end tests (TBL-04): on the TV what its snapshot
  // and events carry, in the DM view the same, a stroke under way included.
  const fogState = fog && shownFog ? { 'data-fog': JSON.stringify(shownFog) } : {};
  // Where each ping is drawn, in screen pixels from the viewport's corner, for the end-to-end tests (TBL-01).
  const pingState =
    frame && ping && ping.shown.length > 0
      ? {
          'data-pings': JSON.stringify(
            ping.shown.map((each) => {
              const at = toWorld(frame, each);
              return {
                x: each.x,
                y: each.y,
                left: camera.x + at.x * camera.scale,
                top: camera.y + at.y * camera.scale,
              };
            }),
          ),
        }
      : {};
  // Where each token is drawn, in screen pixels from the viewport's corner, for the end-to-end tests.
  // The player mode lists the tokens it draws, visible ones only, with nothing a player's snapshot
  // does not already carry (LIV-03).
  const tokenBoxes = frame
    ? JSON.stringify(
        (dm ? tokens : tokens.filter((token) => !token.hidden)).map((token) => {
          const at = toWorld(frame, token);
          return {
            id: token.id,
            label: token.label,
            // Whether the DM's map draws its notes badge (DMT-04); the player mode has none.
            ...(dm ? { hidden: token.hidden, note: token.note !== undefined } : {}),
            markers: token.markers ?? [],
            x: token.x,
            y: token.y,
            left: camera.x + at.x * camera.scale,
            top: camera.y + at.y * camera.scale,
            side: footprint(token.size) * frame.square * camera.scale,
          };
        }),
      )
    : undefined;

  // Where each map note's icon is drawn, in screen pixels from the viewport's corner, for the end-to-end tests; the
  // DM's viewport only (UXR-08).
  const noteBoxes =
    dm && frame
      ? JSON.stringify(
          mapNotes.map((note) => {
            const at = toWorld(frame, note);
            return {
              id: note.id,
              x: note.x,
              y: note.y,
              left: camera.x + at.x * camera.scale,
              top: camera.y + at.y * camera.scale,
            };
          }),
        )
      : undefined;

  if (!dm) {
    return (
      <div
        ref={viewportRef}
        className={touch ? 'eg-canvas eg-canvas--player eg-canvas--touch' : 'eg-canvas eg-canvas--player'}
        {...gestures}
        {...state}
        {...rulerState}
        {...pingState}
        {...fogState}
        data-tokens={tokenBoxes}
      >
        {stage}
      </div>
    );
  }
  const anchorOf = (token: CanvasToken | undefined): TokenAnchor | undefined => {
    if (!token || !frame) return undefined;
    const at = toWorld(frame, token);
    return {
      left: camera.x + at.x * camera.scale,
      top: camera.y + at.y * camera.scale,
      side: footprint(token.size) * frame.square * camera.scale,
      viewport,
    };
  };
  const selectedAnchor = popover ? anchorOf(selected) : undefined;
  // A map note's anchor: its icon, around its point (UXR-08).
  const noteAnchorOf = (note: CanvasMapNote | undefined): TokenAnchor | undefined => {
    if (!note || !frame) return undefined;
    const at = toWorld(frame, note);
    return {
      left: camera.x + at.x * camera.scale - MAP_NOTE_RADIUS_PX,
      top: camera.y + at.y * camera.scale - MAP_NOTE_RADIUS_PX,
      side: MAP_NOTE_RADIUS_PX * 2,
      viewport,
    };
  };
  const openNoteAnchor =
    notePopover && noteControls ? noteAnchorOf(mapNotes.find((note) => note.id === noteControls.openId)) : undefined;
  const notePreviewAnchor =
    notePreviewing && notePreviewId !== undefined
      ? noteAnchorOf(mapNotes.find((note) => note.id === notePreviewId))
      : undefined;
  const previewAnchor =
    previewing && previewId !== undefined ? anchorOf(tokens.find((token) => token.id === previewId)) : undefined;
  const help = measuring
    ? t('canvas.helpMeasure')
    : placingNow
      ? t(place.kind === 'note' ? 'canvas.helpPlaceNote' : 'canvas.helpPlace')
      : rulerOn
        ? t(tv ? 'canvas.helpRulerLive' : 'canvas.helpRuler')
        : pingOn
          ? t('canvas.helpPing')
          : fogOn
            ? t('canvas.helpFog')
            : rulerTool && shownPath && !selected
              ? t('canvas.helpRulerShown')
              : selected
                ? t('canvas.helpToken', { label: selected.label })
                : tv
                  ? t(tv.locked ? 'canvas.helpLiveLocked' : 'canvas.helpLive')
                  : t('canvas.help');
  const history = rail?.history;
  return (
    <div className="eg-canvas eg-canvas--dm">
      <div
        ref={viewportRef}
        className={
          panning
            ? 'eg-canvas__viewport eg-canvas__viewport--pan'
            : measuring || placingNow || rulerOn || pingOn || fogOn
              ? 'eg-canvas__viewport eg-canvas__viewport--measure'
              : 'eg-canvas__viewport'
        }
        role="application"
        aria-label={label}
        aria-describedby={helpId}
        tabIndex={0}
        onKeyDown={onKeyDown}
        {...state}
        {...frameState}
        {...rulerState}
        {...pingState}
        data-ruler-tool={rulerTool ? (rulerOn ? 'on' : 'off') : undefined}
        data-ping-tool={pingTool ? (pingOn ? 'on' : 'off') : undefined}
        data-fog-tool={fogTool ? (fogOn ? 'on' : 'off') : undefined}
        data-fog-brush={fogOn && fogTool ? `${fogTool.erase ? 'erase' : 'paint'} ${fogTool.radius}` : undefined}
        {...fogState}
        // A right-button drag pans while measuring, so it opens no context menu (review U-M2).
        onContextMenu={rulerOn || fogOn ? (event) => event.preventDefault() : undefined}
        {...dropHandlers}
        data-dropping={dropping ? JSON.stringify(dropping.at) : undefined}
        data-tokens={tokenBoxes}
        data-map-notes={noteBoxes}
      >
        {stage}
      </div>
      <p id={helpId} className="eg-visually-hidden">
        {help}
      </p>
      {rail ? (
        <div
          ref={railRef}
          className="eg-rail"
          role="toolbar"
          aria-label={t('canvas.tools')}
          aria-orientation="vertical"
          data-more-above={railEdges.above || undefined}
          data-more-below={railEdges.below || undefined}
        >
          <button
            type="button"
            className="eg-rail__tool"
            aria-label={t('canvas.toolSelect')}
            aria-pressed={!rulerOn && !pingOn && !fogOn && !placingNow && !measuring}
            onClick={rail.onSelect}
          >
            <Icon name="select" size={20} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className="eg-rail__tool"
            aria-label={t('canvas.toolRuler')}
            aria-pressed={rulerOn}
            aria-disabled={!rulerTool || undefined}
            onClick={() => rulerTool?.onToggle(!rulerOn)}
          >
            <Icon name="ruler" size={20} />
          </button>
          <button
            type="button"
            className="eg-rail__tool"
            aria-label={t('canvas.toolPing')}
            aria-pressed={pingOn}
            aria-disabled={!pingTool || undefined}
            aria-describedby={pingTool ? undefined : `${helpId}-ping`}
            onClick={() => pingTool?.onToggle(!pingOn)}
          >
            <Icon name="ping" size={20} />
          </button>
          <button
            type="button"
            className="eg-rail__tool"
            aria-label={t('canvas.toolFog')}
            aria-pressed={fogOn}
            aria-disabled={!fogTool || undefined}
            onClick={() => fogTool?.onToggle(!fogOn)}
          >
            <Icon name="fog" size={20} />
          </button>
          <span id={`${helpId}-ping`} className="eg-visually-hidden">
            {t('canvas.pingLiveOnly')}
          </span>
          <button
            type="button"
            className="eg-rail__tool"
            data-tool="add-token"
            aria-label={t('canvas.toolAddToken')}
            aria-pressed={placingNow && place.kind !== 'note'}
            aria-disabled={!rail.onAddToken || undefined}
            onClick={() => rail.onAddToken?.()}
          >
            <Icon name="addToken" size={20} />
          </button>
          <button
            type="button"
            className="eg-rail__tool"
            data-tool="add-note"
            aria-label={t('canvas.toolAddNote')}
            aria-pressed={placingNow && place.kind === 'note'}
            aria-disabled={!rail.onAddNote || undefined}
            onClick={() => rail.onAddNote?.()}
          >
            <Icon name="note" size={20} />
          </button>
          <span className="eg-rail__divider" aria-hidden="true" />
          <button
            type="button"
            className="eg-rail__tool"
            aria-label={t('canvas.undo')}
            aria-disabled={!history?.canUndo || undefined}
            onClick={() => history?.onUndo()}
          >
            <Icon name="undo" size={20} />
          </button>
          <button
            type="button"
            className="eg-rail__tool"
            aria-label={t('canvas.redo')}
            aria-disabled={!history?.canRedo || undefined}
            onClick={() => history?.onRedo()}
          >
            <Icon name="redo" size={20} />
          </button>
        </div>
      ) : null}
      {status ? <div className="eg-canvas__status">{status}</div> : null}
      <div className="eg-canvas__zoom" role="group" aria-label={t('canvas.controls')}>
        <button
          type="button"
          className="eg-icon-button"
          aria-label={t('canvas.zoomOut')}
          onClick={() => changeCamera((current) => zoomAt(current, 1 / ZOOM_STEP, centre))}
        >
          <Icon name="minus" />
        </button>
        <span className="eg-canvas__zoom-value">
          {t('canvas.zoomValue', { percent: Math.round(camera.scale * 100) })}
        </span>
        <button
          type="button"
          className="eg-icon-button"
          aria-label={t('canvas.zoomIn')}
          onClick={() => changeCamera((current) => zoomAt(current, ZOOM_STEP, centre))}
        >
          <Icon name="plus" />
        </button>
        <span className="eg-canvas__zoom-divider" aria-hidden="true" />
        <button
          type="button"
          className="eg-icon-button"
          aria-label={t('canvas.fit')}
          onClick={() => setManual(undefined)}
        >
          <Icon name="fit" />
        </button>
      </div>
      {selectedAnchor && popover ? popover(selectedAnchor) : null}
      {previewAnchor && previewId !== undefined && preview ? preview(previewId, previewAnchor) : null}
      {openNoteAnchor && notePopover ? notePopover(openNoteAnchor) : null}
      {notePreviewAnchor && notePreviewId !== undefined && notePreview
        ? notePreview(notePreviewId, notePreviewAnchor)
        : null}
    </div>
  );
}
