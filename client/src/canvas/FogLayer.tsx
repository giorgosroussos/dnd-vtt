import type Konva from 'konva';
import { Circle, Group, Label, Layer, Line, Shape, Tag, Text } from 'react-konva';
import type { RegionShape } from '@emberglass/shared';
import { t } from '../ui/messages.js';
import { CANVAS_FONT, THEME } from '../ui/theme.js';
import { toWorld, type GridFrame, type Point } from './tokens.js';

// Fog regions on the map canvas (TBL-03, specs/04-live-sync.md §13, specs/08-ux-journeys.md §11, Q-099).
// On the TV a fogged region is opaque, the player background's near-black, with a soft edge, drawn over the
// map and the grid and under the tokens (players are sent no token under it anyway). In the DM view a
// fogged region is a dashed blue outline over a diagonal hatch, a revealed one a faint dotted outline, each
// with its name and state on a tag at its top-left corner, which a click toggles. While the fog tool draws,
// the shape so far is drawn in the accent, its corners marked.

export const FOG_COLOURS = {
  fog: THEME.playerBg,
  outline: THEME.hidden,
  tag: THEME.hidden,
  tagText: THEME.canvas,
  revealedTag: 'rgba(12, 9, 7, 0.85)',
  revealedText: THEME.hiddenText,
  draft: THEME.accent,
} as const;
// The TV's soft edge, and the hatch's spacing, in screen pixels.
const SOFT_EDGE_PX = 18;
const HATCH_PX = 10;

/** A region as the canvas draws it: players' fogged shapes carry no id, name or state. */
export interface FogRegion {
  id?: string | undefined;
  name?: string | undefined;
  shape: RegionShape;
  hidden: boolean;
}

/** The shape being drawn: a polygon's corners so far, or a rectangle between two corners. */
export type FogDraft = { kind: 'polygon'; points: Point[] } | { kind: 'rect'; from: Point; to: Point };

/** The corners of a shape in grid units, in drawing order. */
export function cornersOf(shape: RegionShape): Point[] {
  if (shape.kind === 'polygon') return shape.points;
  const { x, y, width, height } = shape;
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

/** The rectangle between two grid corners, or undefined when it is not a square wide and high. */
export function rectBetween(from: Point, to: Point): RegionShape | undefined {
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  if (width < 1 || height < 1) return undefined;
  return { kind: 'rect', x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width, height };
}

const flat = (frame: GridFrame, points: readonly Point[]) =>
  points.flatMap((point) => {
    const at = toWorld(frame, point);
    return [at.x, at.y];
  });

/** The region's top-left corner in the world: where its tag sits. */
function anchorOf(frame: GridFrame, shape: RegionShape): Point {
  const corners = cornersOf(shape);
  const top = Math.min(...corners.map((point) => point.y));
  const left = Math.min(...corners.filter((point) => point.y === top).map((point) => point.x));
  return toWorld(frame, { x: left, y: top });
}

export function FogLayer({
  regions,
  frame,
  scale,
  mode,
  draft,
  onToggle,
}: {
  regions: readonly FogRegion[];
  frame: GridFrame;
  scale: number;
  mode: 'dm' | 'player';
  draft?: FogDraft | undefined;
  /** DM view only, while the map's tags may be clicked: fogs or reveals a region. */
  onToggle?: ((id: string) => void) | undefined;
}) {
  const inverse = 1 / scale;
  if (mode === 'player') {
    const fogged = regions.filter((region) => region.hidden);
    if (fogged.length === 0) return null;
    return (
      <Layer name="fog-layer" listening={false}>
        {fogged.map((region, index) => (
          <Line
            key={index}
            name="fog"
            points={flat(frame, cornersOf(region.shape))}
            closed
            fill={FOG_COLOURS.fog}
            shadowColor={FOG_COLOURS.fog}
            shadowBlur={SOFT_EDGE_PX}
            shadowOpacity={1}
            shadowForStrokeEnabled={false}
          />
        ))}
      </Layer>
    );
  }
  if (regions.length === 0 && !draft) return null;
  return (
    <Layer name="fog-layer" listening={onToggle !== undefined}>
      {regions.map((region) => {
        const points = flat(frame, cornersOf(region.shape));
        const at = anchorOf(frame, region.shape);
        const text = t(region.hidden ? 'fog.tagFogged' : 'fog.tagRevealed', { name: region.name ?? '' });
        return (
          <Group
            key={region.id}
            name={region.hidden ? 'fog-region fog-region-fogged' : 'fog-region fog-region-revealed'}
          >
            {region.hidden ? (
              <Shape
                name="fog-hatch"
                listening={false}
                sceneFunc={(context: Konva.Context) => {
                  const xs = points.filter((_, index) => index % 2 === 0);
                  const ys = points.filter((_, index) => index % 2 === 1);
                  const [left, right, top, bottom] = [
                    Math.min(...xs),
                    Math.max(...xs),
                    Math.min(...ys),
                    Math.max(...ys),
                  ];
                  context.save();
                  context.beginPath();
                  for (let index = 0; index < points.length; index += 2) {
                    if (index === 0) context.moveTo(points[0]!, points[1]!);
                    else context.lineTo(points[index]!, points[index + 1]!);
                  }
                  context.closePath();
                  context.fillStyle = 'rgba(143, 179, 217, 0.1)';
                  context.fill();
                  context.clip();
                  context.beginPath();
                  const step = HATCH_PX * inverse;
                  for (let offset = left - (bottom - top); offset < right; offset += step) {
                    context.moveTo(offset, bottom);
                    context.lineTo(offset + (bottom - top), top);
                  }
                  context.strokeStyle = 'rgba(143, 179, 217, 0.35)';
                  context.lineWidth = inverse;
                  context.stroke();
                  context.restore();
                }}
              />
            ) : null}
            <Line
              name="fog-outline"
              points={points}
              closed
              stroke={FOG_COLOURS.outline}
              strokeWidth={region.hidden ? 2 : 1.5}
              dash={region.hidden ? [6, 4] : [2, 4]}
              opacity={region.hidden ? 1 : 0.6}
              strokeScaleEnabled={false}
              listening={false}
            />
            <Label
              name="fog-tag"
              x={at.x}
              y={at.y}
              scaleX={inverse}
              scaleY={inverse}
              offsetY={-4}
              offsetX={-4}
              onClick={() => region.id && onToggle?.(region.id)}
              onTap={() => region.id && onToggle?.(region.id)}
              onMouseEnter={(event) => {
                const stage = event.target.getStage();
                if (stage && onToggle) stage.container().style.cursor = 'pointer';
              }}
              onMouseLeave={(event) => {
                const stage = event.target.getStage();
                if (stage) stage.container().style.cursor = '';
              }}
            >
              <Tag fill={region.hidden ? FOG_COLOURS.tag : FOG_COLOURS.revealedTag} cornerRadius={4} />
              <Text
                text={text}
                fill={region.hidden ? FOG_COLOURS.tagText : FOG_COLOURS.revealedText}
                fontFamily={CANVAS_FONT}
                fontStyle="bold"
                fontSize={11}
                padding={4}
              />
            </Label>
          </Group>
        );
      })}
      {draft ? <Draft draft={draft} frame={frame} inverse={inverse} /> : null}
    </Layer>
  );
}

function Draft({ draft, frame, inverse }: { draft: FogDraft; frame: GridFrame; inverse: number }) {
  const corners =
    draft.kind === 'polygon'
      ? draft.points
      : cornersOf(rectBetween(draft.from, draft.to) ?? { kind: 'polygon', points: [draft.from] });
  return (
    <Group name="fog-draft" listening={false}>
      <Line
        points={flat(frame, corners)}
        closed={draft.kind === 'rect'}
        stroke={FOG_COLOURS.draft}
        strokeWidth={2}
        dash={[6, 4]}
        strokeScaleEnabled={false}
      />
      {corners.map((corner, index) => {
        const at = toWorld(frame, corner);
        return (
          <Circle
            key={index}
            name="fog-draft-corner"
            x={at.x}
            y={at.y}
            radius={index === 0 ? 5 * inverse : 3.5 * inverse}
            fill={FOG_COLOURS.draft}
            stroke={THEME.canvas}
            strokeWidth={1}
            strokeScaleEnabled={false}
          />
        );
      })}
    </Group>
  );
}
