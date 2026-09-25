import { useEffect, useEffectEvent, useId, useRef, useState, type KeyboardEvent } from 'react';
import type Konva from 'konva';
import { Group, Image as KonvaImage, Layer, Line, Rect, Stage } from 'react-konva';
import { imageFileUrl, type Grid, type Image } from '@emberglass/shared';
import { Button } from '../ui/Button.js';
import { normalise, type Rect as Box } from './calibration.js';
import { t } from '../ui/messages.js';
import {
  cameraForKey,
  fitCamera,
  gridLines,
  mapInfo,
  WHEEL_ZOOM_STEP,
  worldSize,
  ZOOM_STEP,
  zoomAt,
  type Camera,
  type Size,
} from './geometry.js';
import './canvas.css';

// The map canvas both views draw (specs/08-ux-journeys.md §3, specs/06-grid-and-measurement.md §2,
// specs/03-domain-model.md §6, D-006, D-026, D-090): the map's display version as the background,
// never the original (specs/07-security-and-access.md §5), or a map-less scene's extent on a
// neutral dark background, with the grid overlay on top.
//
// `dm` adds the camera controls: wheel and keyboard zoom, drag and keyboard pan, and a reset
// that fits the map; the overlay is drawn faintly when players do not see it (D-026). `player`
// has no control and nothing that takes focus, always fits the map (specs/04-live-sync.md §9),
// and draws no overlay when the grid is hidden for players. The player view uses it from LIV-03.
//
// While the DM calibrates by rectangle (PRP-03, specs/06-grid-and-measurement.md §1, D-094), a
// drag on the map draws a rectangle instead of panning, reported in the original's pixels.

// Konva draws on a canvas, so these are colours, not the CSS tokens: the void around the
// scene is the page background of tokens.css, a map-less extent a neutral dark grey (D-016);
// each grid line is light over a dark halo, so it shows on dark and light maps (D-093).
export const CANVAS_COLOURS = {
  void: '#14110f',
  extent: '#2b2b2b',
  grid: '#f2ece6',
  halo: '#14110f',
  // The accent of tokens.css, for the rectangle measured during calibration.
  measure: '#f0a04b',
} as const;
// A press-and-release shorter than this, in screen pixels either way, is a click, not a rectangle.
const MIN_RECT_PX = 4;
export const GRID_OPACITY = { shown: 0.7, faint: 0.25 } as const;

type Mode = 'dm' | 'player';

/** How the overlay is drawn for a view: the DM always sees it (D-026), players only when visible. */
export function overlayOpacity(mode: Mode, visible: boolean): number {
  if (visible) return GRID_OPACITY.shown;
  return mode === 'dm' ? GRID_OPACITY.faint : 0;
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
 * What the canvas needs of a map image: its id, its size and its display version's size. The
 * player view will build it from what its snapshot carries (LIV-03), never the DM's record.
 */
export type CanvasMap = Pick<Image, 'id' | 'width' | 'height' | 'variants'>;

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
 * again when the map itself changes, not when its record is rebuilt.
 */
function useDisplayImage(id: string | undefined, onError: (() => void) | undefined): HTMLImageElement | undefined {
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
  }, [id]);
  return id !== undefined && loaded?.id === id ? loaded.element : undefined;
}

export function MapCanvas({
  grid,
  map,
  mode,
  label,
  onMapError,
  measure,
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
}) {
  const helpId = useId();
  const [viewportRef, viewport] = useViewport();
  const displayImage = useDisplayImage(map?.id, onMapError);
  const info = map
    ? mapInfo(map, displayImage && { width: displayImage.naturalWidth, height: displayImage.naturalHeight })
    : undefined;
  const world = worldSize(grid, info);
  const ready = map === null || info !== undefined;

  // The DM's own camera, kept only for the world it was set on: another scene or map fits again.
  const worldKey = `${map?.id ?? 'none'}:${world.width}x${world.height}`;
  const [manual, setManual] = useState<{ key: string; camera: Camera }>();
  const fitted = fitCamera(world, viewport);
  const camera = mode === 'dm' && manual?.key === worldKey ? manual.camera : fitted;
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
  const [dragging, setDragging] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } }>();

  function onKeyDown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
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

  function onMeasureDown(event: Konva.KonvaEventObject<PointerEvent>) {
    const at = worldPoint(event);
    if (at) setDragging({ start: at, end: at });
  }

  function onMeasureMove(event: Konva.KonvaEventObject<PointerEvent>) {
    const at = worldPoint(event);
    if (at) setDragging((current) => current && { ...current, end: at });
  }

  function onMeasureUp(event: Konva.KonvaEventObject<PointerEvent>) {
    const at = worldPoint(event) ?? dragging?.end;
    const current = dragging;
    setDragging(undefined);
    if (!current || !at || !info || !measure) return;
    const box = normalise({
      x: current.start.x,
      y: current.start.y,
      width: at.x - current.start.x,
      height: at.y - current.start.y,
    });
    if (box.width * camera.scale < MIN_RECT_PX || box.height * camera.scale < MIN_RECT_PX) return;
    measure.onDraw(scaled(box, info.original.width / info.display.width));
  }

  // The rectangle being dragged, or the one last measured, in world pixels.
  const shownRect: Box | undefined = dragging
    ? normalise({
        x: dragging.start.x,
        y: dragging.start.y,
        width: dragging.end.x - dragging.start.x,
        height: dragging.end.y - dragging.start.y,
      })
    : measuring && measure.rect
      ? scaled(measure.rect, info.display.width / info.original.width)
      : undefined;

  const handlers = !dm
    ? {}
    : measuring
      ? { onWheel, onPointerDown: onMeasureDown, onPointerMove: onMeasureMove, onPointerUp: onMeasureUp }
      : { onWheel, onDragMove: onDrag, onDragEnd: onDrag };

  const centre = { x: viewport.width / 2, y: viewport.height / 2 };
  const stage = (
    <Stage
      width={viewport.width}
      height={viewport.height}
      x={camera.x}
      y={camera.y}
      scaleX={camera.scale}
      scaleY={camera.scale}
      draggable={dm && !measuring}
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
            name="measure"
            {...shownRect}
            stroke={CANVAS_COLOURS.measure}
            strokeWidth={2}
            dash={[6, 4]}
            strokeScaleEnabled={false}
          />
        ) : null}
      </Layer>
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

  if (!dm) {
    return (
      <div ref={viewportRef} className="eg-canvas eg-canvas--player" {...state}>
        {stage}
      </div>
    );
  }
  return (
    <div className="eg-canvas eg-canvas--dm">
      <div className="eg-canvas__toolbar" role="group" aria-label={t('canvas.controls')}>
        <Button size="small" onClick={() => changeCamera((current) => zoomAt(current, ZOOM_STEP, centre))}>
          {t('canvas.zoomIn')}
        </Button>
        <Button size="small" onClick={() => changeCamera((current) => zoomAt(current, 1 / ZOOM_STEP, centre))}>
          {t('canvas.zoomOut')}
        </Button>
        <Button size="small" onClick={() => setManual(undefined)}>
          {t('canvas.fit')}
        </Button>
        <p id={helpId} className="eg-canvas__help">
          {t('canvas.help')}
        </p>
      </div>
      <div
        ref={viewportRef}
        className={measuring ? 'eg-canvas__viewport eg-canvas__viewport--measure' : 'eg-canvas__viewport'}
        role="application"
        aria-label={label}
        aria-describedby={helpId}
        tabIndex={0}
        onKeyDown={onKeyDown}
        {...state}
      >
        {stage}
      </div>
    </div>
  );
}
