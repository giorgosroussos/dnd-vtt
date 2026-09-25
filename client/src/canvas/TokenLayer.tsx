import { useEffect, useState } from 'react';
import type Konva from 'konva';
import { Circle, Group, Image as KonvaImage, Label, Layer, Line, Rect, Text } from 'react-konva';
import { imageFileUrl } from '@emberglass/shared';
import {
  dropPosition,
  footprint,
  stacked,
  toGrid,
  toWorld,
  type CanvasToken,
  type GridFrame,
  type Point,
} from './tokens.js';

// The tokens of the map canvas (PRP-04, specs/05-assets-and-images.md §2, specs/06-grid-and-measurement.md
// §4, specs/08-ux-journeys.md §3, §9, Q-032, Q-054, D-100). Each covers its size's squares, drawn from
// its asset's display version, the only version the canvas requests (specs/07-security-and-access.md
// §5), with its label below it, as the TV shows it too (Q-032). In the DM mode a hidden token is drawn
// semi-transparent with a dashed outline and a struck-through marker; a token is selected by a click and moved by dragging it,
// snapping as it is dropped unless Alt is held. The player mode draws only visible tokens, never a
// hidden one, and listens to nothing; what reaches a player view is filtered on the server (LIV-02).

export const TOKEN_COLOURS = {
  // The accent of tokens.css: a hidden token's outline and marker.
  accent: '#f0a04b',
  halo: '#14110f',
  text: '#f2ece6',
  // Shown while a token's image is on its way or cannot be loaded.
  placeholder: '#5a4f45',
} as const;
export const HIDDEN_OPACITY = 0.5;
export const HIDDEN_UNDERLAY_OPACITY = 0.6;
const LABEL_WIDTH = 240;
const LABEL_FONT_PX = 13;
// The hidden marker's radius, in screen pixels.
const MARKER_PX = 7;

/** The display versions of the tokens' images, each loaded once. */
function useTokenImages(ids: readonly string[]): ReadonlyMap<string, HTMLImageElement> {
  const [loaded, setLoaded] = useState<ReadonlyMap<string, HTMLImageElement>>(new Map());
  const key = [...new Set(ids)].sort().join(',');
  useEffect(() => {
    const wanted = key === '' ? [] : key.split(',');
    const elements = wanted.map((id) => {
      const element = new window.Image();
      element.onload = () => setLoaded((current) => new Map(current).set(id, element));
      element.src = imageFileUrl(id, 'display');
      return element;
    });
    return () => {
      for (const element of elements) element.onload = null;
    };
  }, [key]);
  return loaded;
}

export interface TokenControls {
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  /** A token dropped at a new position, in grid units, snapped unless Alt was held. */
  onMove: (id: string, at: Point) => void;
}

export function TokenLayer({
  tokens,
  frame,
  scale,
  mode,
  controls,
}: {
  tokens: readonly CanvasToken[];
  frame: GridFrame;
  /** The camera's scale, so labels and markers keep their screen size at every zoom. */
  scale: number;
  mode: 'dm' | 'player';
  /** DM mode only, and only while tokens may be selected and dragged. */
  controls: TokenControls | undefined;
}) {
  const shown = stacked(mode === 'player' ? tokens.filter((token) => !token.hidden) : tokens);
  const images = useTokenImages(shown.map((token) => token.image_id));
  const inverse = 1 / scale;

  function dropped(token: CanvasToken, event: Konva.KonvaEventObject<DragEvent>) {
    const node = event.target;
    const at = dropPosition(toGrid(frame, node.position()), token.size, event.evt.altKey);
    // Placed where it snapped at once, even when the stored position does not change.
    node.position(toWorld(frame, at));
    controls?.onMove(token.id, at);
  }

  return (
    <Layer name="tokens" listening={mode === 'dm' && controls !== undefined}>
      {shown.map((token) => {
        const side = footprint(token.size) * frame.square;
        const at = toWorld(frame, token);
        const image = images.get(token.image_id);
        const hidden = mode === 'dm' && token.hidden;
        const selected = controls?.selectedId === token.id;
        return (
          <Group
            key={token.id}
            name="token"
            id={`token-${token.id}`}
            x={at.x}
            y={at.y}
            draggable={controls !== undefined}
            onPointerDown={(event) => {
              event.cancelBubble = true;
              controls?.onSelect(token.id);
            }}
            onDragStart={() => controls?.onSelect(token.id)}
            onDragEnd={(event) => dropped(token, event)}
          >
            {hidden ? (
              // A dark underlay keeps a semi-transparent token readable on a busy map (review).
              <Rect
                name="token-hidden-underlay"
                width={side}
                height={side}
                fill={TOKEN_COLOURS.halo}
                opacity={HIDDEN_UNDERLAY_OPACITY}
                listening={false}
              />
            ) : null}
            <Group name={hidden ? 'token-body token-body-hidden' : 'token-body'} opacity={hidden ? HIDDEN_OPACITY : 1}>
              {image ? (
                <KonvaImage name="token-image" image={image} width={side} height={side} />
              ) : (
                <Rect name="token-placeholder" width={side} height={side} fill={TOKEN_COLOURS.placeholder} />
              )}
            </Group>
            {hidden ? (
              <Rect
                name="token-hidden-outline"
                width={side}
                height={side}
                stroke={TOKEN_COLOURS.accent}
                strokeWidth={2}
                dash={[4, 4]}
                strokeScaleEnabled={false}
                listening={false}
              />
            ) : null}
            {selected ? (
              // Light over a dark halo, apart from the accent of a hidden token's outline (review).
              <Rect
                name="token-selected-halo"
                x={-3 * inverse}
                y={-3 * inverse}
                width={side + 6 * inverse}
                height={side + 6 * inverse}
                stroke={TOKEN_COLOURS.halo}
                strokeWidth={5}
                strokeScaleEnabled={false}
                listening={false}
              />
            ) : null}
            {selected ? (
              <Rect
                name="token-selected"
                x={-3 * inverse}
                y={-3 * inverse}
                width={side + 6 * inverse}
                height={side + 6 * inverse}
                stroke={TOKEN_COLOURS.text}
                strokeWidth={2}
                strokeScaleEnabled={false}
                listening={false}
              />
            ) : null}
            {hidden ? (
              // A crossed-out eye's place: a struck-through disc on the token's top-right corner, the
              // same size on screen at every zoom, so it stays readable where labels crowd (Q-054).
              <Group name="token-hidden-marker" x={side} y={0} scaleX={inverse} scaleY={inverse} listening={false}>
                <Circle radius={MARKER_PX} fill={TOKEN_COLOURS.halo} stroke={TOKEN_COLOURS.accent} strokeWidth={2} />
                <Line
                  points={[-MARKER_PX * 0.6, MARKER_PX * 0.6, MARKER_PX * 0.6, -MARKER_PX * 0.6]}
                  stroke={TOKEN_COLOURS.accent}
                  strokeWidth={2}
                  lineCap="round"
                />
              </Group>
            ) : null}
            <Label
              name="token-label"
              x={side / 2}
              y={side}
              offsetX={LABEL_WIDTH / 2}
              scaleX={inverse}
              scaleY={inverse}
              listening={false}
            >
              <Text
                text={token.label}
                width={LABEL_WIDTH}
                align="center"
                fill={TOKEN_COLOURS.text}
                stroke={TOKEN_COLOURS.halo}
                strokeWidth={3}
                fillAfterStrokeEnabled
                fontSize={LABEL_FONT_PX}
                padding={2}
              />
            </Label>
          </Group>
        );
      })}
    </Layer>
  );
}
