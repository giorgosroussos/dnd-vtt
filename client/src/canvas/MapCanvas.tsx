import { useEffect, useEffectEvent, useId, useRef, useState, type KeyboardEvent } from 'react';
import type Konva from 'konva';
import { Group, Image as KonvaImage, Layer, Line, Rect, Stage } from 'react-konva';
import { imageFileUrl, type Grid, type Image } from '@emberglass/shared';
import { Button } from '../ui/Button.js';
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

// Konva draws on a canvas, so these are colours, not the CSS tokens: the void around the
// scene is the page background of tokens.css, a map-less extent a neutral dark grey (D-016).
export const CANVAS_COLOURS = { void: '#14110f', extent: '#2b2b2b', grid: '#f2ece6' } as const;
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

/** The display version of the map, once loaded; only that version is ever requested. */
function useDisplayImage(map: Image | null, onError: (() => void) | undefined): HTMLImageElement | undefined {
  const [loaded, setLoaded] = useState<{ id: string; element: HTMLImageElement }>();
  const failed = useEffectEvent(() => onError?.());
  useEffect(() => {
    if (!map) return;
    const element = new window.Image();
    element.onload = () => setLoaded({ id: map.id, element });
    element.onerror = () => failed();
    element.src = imageFileUrl(map.id, 'display');
    return () => {
      element.onload = null;
      element.onerror = null;
    };
  }, [map]);
  return map && loaded?.id === map.id ? loaded.element : undefined;
}

export function MapCanvas({
  grid,
  map,
  mode,
  label,
  onMapError,
}: {
  grid: Grid;
  /** The scene's map image, or null for a scene without a map. */
  map: Image | null;
  mode: Mode;
  /** The DM's name for the canvas, naming the scene. */
  label?: string;
  onMapError?: () => void;
}) {
  const helpId = useId();
  const [viewportRef, viewport] = useViewport();
  const displayImage = useDisplayImage(map, onMapError);
  const info = map
    ? mapInfo(map, displayImage && { width: displayImage.naturalWidth, height: displayImage.naturalHeight })
    : undefined;
  const world = worldSize(grid, info);
  const ready = map === null || info !== undefined;

  // The DM's own camera, kept only for the world it was set on: another scene or map fits again.
  const worldKey = `${map?.id ?? 'none'}:${world.width}x${world.height}`;
  const [manual, setManual] = useState<{ key: string; camera: Camera }>();
  const camera = mode === 'dm' && manual?.key === worldKey ? manual.camera : fitCamera(world, viewport);
  const setCamera = (next: Camera) => setManual({ key: worldKey, camera: next });

  const lines = ready ? gridLines(grid, info) : { xs: [], ys: [] };
  const opacity = overlayOpacity(mode, grid.visible);
  const dm = mode === 'dm';

  function onKeyDown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = cameraForKey(camera, event.key, event.shiftKey, world, viewport);
    if (!next) return;
    event.preventDefault();
    setCamera(next);
  }

  function onWheel(event: Konva.KonvaEventObject<WheelEvent>) {
    event.evt.preventDefault();
    const at = event.target.getStage()?.getPointerPosition() ?? { x: viewport.width / 2, y: viewport.height / 2 };
    setCamera(zoomAt(camera, event.evt.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP, at));
  }

  function onDrag(event: Konva.KonvaEventObject<DragEvent>) {
    const stage = event.target;
    if (stage !== stage.getStage()) return;
    setCamera({ ...camera, x: stage.x(), y: stage.y() });
  }

  const centre = { x: viewport.width / 2, y: viewport.height / 2 };
  const stage = (
    <Stage
      width={viewport.width}
      height={viewport.height}
      x={camera.x}
      y={camera.y}
      scaleX={camera.scale}
      scaleY={camera.scale}
      draggable={dm}
      listening={dm}
      {...(dm ? { onWheel, onDragMove: onDrag, onDragEnd: onDrag } : {})}
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
            {lines.xs.map((x) => (
              <Line
                key={`x${x}`}
                name="grid-line grid-line-x"
                points={[x, 0, x, world.height]}
                stroke={CANVAS_COLOURS.grid}
                strokeWidth={1}
                strokeScaleEnabled={false}
              />
            ))}
            {lines.ys.map((y) => (
              <Line
                key={`y${y}`}
                name="grid-line grid-line-y"
                points={[0, y, world.width, y]}
                stroke={CANVAS_COLOURS.grid}
                strokeWidth={1}
                strokeScaleEnabled={false}
              />
            ))}
          </Group>
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
        <Button size="small" onClick={() => setCamera(zoomAt(camera, ZOOM_STEP, centre))}>
          {t('canvas.zoomIn')}
        </Button>
        <Button size="small" onClick={() => setCamera(zoomAt(camera, 1 / ZOOM_STEP, centre))}>
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
        className="eg-canvas__viewport"
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
