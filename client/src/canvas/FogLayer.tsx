import type Konva from 'konva';
import type { Ref } from 'react';
import { Circle, Layer, Shape } from 'react-konva';
import { FOG_CELLS_PER_SQUARE, type FogMask } from '@emberglass/shared';
import { THEME } from '../ui/theme.js';
import type { GridFrame } from './tokens.js';

// The painted fog on the map canvas (TBL-04, specs/04-live-sync.md §13, specs/08-ux-journeys.md §11, Q-101).
// On the TV the fog is opaque, the player background's near-black, with a soft edge, drawn over the map and
// the grid and under the tokens (players are sent no token under it anyway). In the DM view it is a blue
// tint, dark enough to read on a light map, under a diagonal hatch, so the map stays readable beneath it. While the brush paints, the fog drawn
// is the stroke's preview, and a circle under the pointer shows the brush's reach.

export const FOG_COLOURS = {
  fog: THEME.playerBg,
  tint: 'rgba(16, 22, 34, 0.5)',
  hatch: 'rgba(143, 179, 217, 0.75)',
  paint: THEME.accent,
  erase: THEME.hidden,
} as const;
// The TV's soft edge, the blur that rounds off the cells' steps, and the hatch's spacing, in screen pixels.
const SOFT_EDGE_PX = 18;
const SMOOTH_PX = 4;
const HATCH_PX = 10;

/**
 * Blurs the TV's fog layer a little, as the browser draws it, so the steps of quarter-square cells read as
 * the round brush that painted them. The layer holds the fog alone, so nothing else is blurred, and what
 * its canvas holds is unchanged.
 */
const smooth = (layer: Konva.Layer | null) => {
  const canvas = layer?.getNativeCanvasElement();
  if (canvas) canvas.style.filter = `blur(${SMOOTH_PX}px)`;
};

/** A rectangle of fogged cells, [x0, x1) by [y0, y1). */
export interface FogRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The mask as rectangles of cells: each run, carried down the rows below while they hold the same runs, so a
 * filled map is a single rectangle and a brushed one a handful per row at most.
 */
export function fogRects(mask: FogMask): FogRect[] {
  const rects: FogRect[] = [];
  let open: FogRect[] = [];
  let previous: { y: number; runs: readonly number[] } | undefined;
  for (const row of mask) {
    const repeats =
      previous !== undefined &&
      previous.y === row.y - 1 &&
      previous.runs.length === row.runs.length &&
      previous.runs.every((x, i) => x === row.runs[i]);
    if (repeats) {
      for (const rect of open) rect.y1 = row.y + 1;
    } else {
      rects.push(...open);
      open = [];
      for (let i = 0; i < row.runs.length; i += 2) {
        open.push({ x0: row.runs[i]!, x1: row.runs[i + 1]!, y0: row.y, y1: row.y + 1 });
      }
    }
    previous = row;
  }
  rects.push(...open);
  return rects;
}

/** A rectangle of cells in world pixels. */
function worldRect(frame: GridFrame, rect: FogRect) {
  const cell = frame.square / FOG_CELLS_PER_SQUARE;
  return {
    x: frame.origin.x + rect.x0 * cell,
    y: frame.origin.y + rect.y0 * cell,
    width: (rect.x1 - rect.x0) * cell,
    height: (rect.y1 - rect.y0) * cell,
  };
}

/** Traces the fog as one path, so that cells side by side fill without a seam between them. */
function trace(context: Konva.Context, frame: GridFrame, rects: readonly FogRect[]) {
  context.beginPath();
  for (const rect of rects) {
    const { x, y, width, height } = worldRect(frame, rect);
    context.rect(x, y, width, height);
  }
}

export function FogLayer({
  fog,
  frame,
  scale,
  mode,
  brush,
  cursorRef,
}: {
  fog: FogMask;
  frame: GridFrame;
  scale: number;
  mode: 'dm' | 'player';
  /** DM view only, while the brush is on: its radius in squares and whether it paints or erases. */
  brush?: { radius: number; erase: boolean } | undefined;
  /** The brush's circle, which the canvas moves with the pointer without drawing the rest again. */
  cursorRef?: Ref<Konva.Circle> | undefined;
}) {
  const inverse = 1 / scale;
  const rects = fogRects(fog);
  if (mode === 'player') {
    if (rects.length === 0) return null;
    return (
      <Layer ref={smooth} name="fog-layer" listening={false}>
        <Shape
          name="fog"
          cells={rects}
          sceneFunc={(context: Konva.Context, shape: Konva.Shape) => {
            trace(context, frame, rects);
            context.fillStrokeShape(shape);
          }}
          fill={FOG_COLOURS.fog}
          shadowColor={FOG_COLOURS.fog}
          shadowBlur={SOFT_EDGE_PX}
          shadowOpacity={1}
          shadowForStrokeEnabled={false}
        />
      </Layer>
    );
  }
  if (rects.length === 0 && !brush) return null;
  return (
    <Layer name="fog-layer" listening={false}>
      {rects.length > 0 ? (
        <Shape
          name="fog-hatch"
          cells={rects}
          sceneFunc={(context: Konva.Context) => {
            const boxes = rects.map((rect) => worldRect(frame, rect));
            const left = Math.min(...boxes.map((box) => box.x));
            const right = Math.max(...boxes.map((box) => box.x + box.width));
            const top = Math.min(...boxes.map((box) => box.y));
            const bottom = Math.max(...boxes.map((box) => box.y + box.height));
            context.save();
            trace(context, frame, rects);
            context.fillStyle = FOG_COLOURS.tint;
            context.fill();
            context.clip();
            context.beginPath();
            const step = HATCH_PX * inverse;
            for (let offset = left - (bottom - top); offset < right; offset += step) {
              context.moveTo(offset, bottom);
              context.lineTo(offset + (bottom - top), top);
            }
            context.strokeStyle = FOG_COLOURS.hatch;
            context.lineWidth = inverse;
            context.stroke();
            context.restore();
          }}
        />
      ) : null}
      {brush ? (
        <Circle
          ref={cursorRef}
          name="fog-brush"
          visible={false}
          radius={brush.radius * frame.square}
          stroke={brush.erase ? FOG_COLOURS.erase : FOG_COLOURS.paint}
          strokeWidth={2}
          dash={brush.erase ? [2, 4] : [6, 4]}
          strokeScaleEnabled={false}
        />
      ) : null}
    </Layer>
  );
}
