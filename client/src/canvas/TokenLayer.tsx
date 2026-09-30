import { useEffect, useRef, useState } from 'react';
import Konva from 'konva';
import { Circle, Group, Image as KonvaImage, Label, Layer, Path, Rect, Tag, Text } from 'react-konva';
import { imageFileUrl, type AssetCategory, type TokenMarker } from '@emberglass/shared';
import { CANVAS_FONT, THEME } from '../ui/theme.js';
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
// §4, specs/08-ux-journeys.md §3, §9, §11, Q-032, Q-054, D-100, UIX-01). Each is a circle within its size's
// squares, its asset's display version clipped to it, the only version the canvas requests
// (specs/07-security-and-access.md §5), or the label's initials while the image is on its way; a ring
// coloured by category (player character gold, monster red, anything else a neutral) and the label below
// it on a dark pill, as the TV shows it too (Q-032). In the DM mode a hidden token can never be taken for a
// visible one: a dashed blue ring, the circle at 60% opacity over a dark disc, a crossed-eye badge and an
// italic blue label. A token is selected by a click and moved by dragging it, snapping as it is dropped
// unless Alt is held. The player mode draws only visible tokens, never a hidden one, and listens to
// nothing; what reaches a player view is filtered on the server (LIV-02). Labels and badges keep their
// size on screen at every zoom, scaled up by `labelScale` on the TV to be read across a room.
//
// Condition markers (TBL-02, specs/08-ux-journeys.md §11, the 2026-09-30 brief), on both views, each a shape
// or a badge and never a colour alone: Bloodied a red ring outside the token, pulsing on the TV, and a
// blood-drop badge; Concentrating a dotted purple ring further out; Unconscious the token desaturated and a
// "z" badge; Dead the token desaturated and darkened, an ✕ badge and the label struck through. The badges
// sit down the token's left side, the hidden badge alone on its right.

export const TOKEN_COLOURS = {
  hidden: THEME.hidden,
  hiddenText: THEME.hiddenText,
  halo: THEME.canvas,
  text: THEME.text,
  accent: THEME.accent,
  labelBackground: 'rgba(12, 9, 7, 0.85)',
  // Shown while a token's image is on its way or cannot be loaded, under its initials.
  placeholder: '#5a4f45',
} as const;

/** The ring and fill of each category (the redesign's token colours). */
export const CATEGORY_COLOURS: Record<AssetCategory, { ring: string; fill: string }> = {
  pc: { ring: THEME.tokenPc, fill: THEME.tokenPcFill },
  monster: { ring: THEME.tokenMonster, fill: THEME.tokenMonsterFill },
  npc: { ring: THEME.tokenOther, fill: THEME.tokenOtherFill },
  object: { ring: THEME.tokenOther, fill: THEME.tokenOtherFill },
};

export const HIDDEN_OPACITY = 0.6;
export const HIDDEN_UNDERLAY_OPACITY = 0.6;
// The circle's radius as a share of half the footprint's side: a gap to the grid lines, as in the design.
const CIRCLE_SHARE = 0.89;
const LABEL_FONT_PX = 11;
const LABEL_PADDING = 3;
// Ring and badge sizes, in screen pixels.
const RING_PX = 2;
const BADGE_PX = 7.5;
// The markers' badges, in the order they sit down the token's left side, and their paths on a 24-unit grid.
const BADGE_MARKERS: readonly TokenMarker[] = ['bloodied', 'unconscious', 'dead'];
const BADGE_ANGLES = [(-3 * Math.PI) / 4, Math.PI, (3 * Math.PI) / 4];
const BLOOD_DROP = 'M12 3c3.5 5 6 8.2 6 11.2a6 6 0 0 1-12 0C6 11.2 8.5 8 12 3z';
const CROSS = 'M7 7l10 10M17 7L7 17';
// The bloodied ring's pulse on the TV: its opacity from 1 down and back over a cycle, a few times from when
// the marker is drawn, then still (D-146): an endless animation would redraw the tokens every frame.
export const BLOODIED_PULSE_MS = 1_600;
export const BLOODIED_PULSES = 3;
const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// The crossed eye of the hidden badge, on a 24-unit grid.
const EYE_OFF =
  'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6';

/**
 * Up to two letters naming a token on its circle: a numbered label's first letter and number ("Bandit 1"
 * is B1), else the first letters of two words, else a one-word label's first two letters.
 */
export function initialsOf(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const [first = '', ...rest] = words;
  const last = rest.at(-1);
  const firstLetter = [...first][0] ?? '';
  if (last !== undefined && /^\d{1,2}$/.test(last)) return `${firstLetter}${last}`.toLocaleUpperCase();
  if (rest.length > 0) return `${firstLetter}${[...rest[0]!][0] ?? ''}`.toLocaleUpperCase();
  return [...first].slice(0, 2).join('').toLocaleUpperCase();
}

const labelStyle = (hidden: boolean) => (hidden ? 'italic bold' : 'bold');

/** A label's width on its pill, padding included, measured as Konva will draw it; capped so a long label stays near its token. */
function labelWidth(label: string, hidden: boolean): number {
  const measured = new Konva.Text({
    text: label,
    fontFamily: CANVAS_FONT,
    fontStyle: labelStyle(hidden),
    fontSize: LABEL_FONT_PX,
    padding: LABEL_PADDING,
  }).width();
  return Math.min(measured, 240);
}

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

/**
 * Draws again once the bundled fonts have loaded: the canvas writes with whatever font is ready when it
 * draws, and would otherwise keep the fallback.
 */
function useFontsLoaded(): number {
  const [loads, setLoads] = useState(0);
  useEffect(() => {
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    if (!fonts) return;
    let active = true;
    const again = () => {
      if (active) setLoads((count) => count + 1);
    };
    void fonts.ready.then(again);
    fonts.addEventListener?.('loadingdone', again);
    return () => {
      active = false;
      fonts.removeEventListener?.('loadingdone', again);
    };
  }, []);
  return loads;
}

export interface TokenControls {
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  /** A token dropped at a new position, in grid units, snapped unless Alt was held. */
  onMove: (id: string, at: Point) => void;
}

/** The bloodied ring: still in the DM view, pulsing on the TV unless reduced motion is asked for. */
function BloodiedRing({ radius, width, pulse }: { radius: number; width: number; pulse: boolean }) {
  const ring = useRef<Konva.Circle>(null);
  useEffect(() => {
    const node = ring.current;
    const layer = node?.getLayer();
    if (!pulse || !node || !layer || reducedMotion()) return;
    const animation = new Konva.Animation((frame) => {
      const time = frame?.time ?? 0;
      if (time >= BLOODIED_PULSES * BLOODIED_PULSE_MS) {
        node.opacity(1);
        animation.stop();
        return;
      }
      const phase = (time % BLOODIED_PULSE_MS) / BLOODIED_PULSE_MS;
      node.opacity(0.35 + 0.65 * (0.5 + 0.5 * Math.cos(phase * 2 * Math.PI)));
    }, layer);
    animation.start();
    return () => {
      animation.stop();
    };
  }, [pulse]);
  return (
    <Circle
      ref={ring}
      name="token-marker-bloodied-ring"
      radius={radius}
      stroke={THEME.bloodied}
      strokeWidth={width}
      strokeScaleEnabled={false}
      listening={false}
    />
  );
}

/** A marker's badge: a dark disc with its sign, the same size on screen at every zoom. */
function MarkerBadge({ marker }: { marker: TokenMarker }) {
  const colour = marker === 'bloodied' ? THEME.bloodied : TOKEN_COLOURS.text;
  return (
    <>
      <Circle radius={BADGE_PX} fill={TOKEN_COLOURS.halo} stroke={colour} strokeWidth={1.5} />
      {marker === 'unconscious' ? (
        <Text
          text="z"
          width={BADGE_PX * 2}
          height={BADGE_PX * 2}
          x={-BADGE_PX}
          y={-BADGE_PX - 0.5}
          align="center"
          verticalAlign="middle"
          fill={colour}
          fontFamily={CANVAS_FONT}
          fontStyle="bold"
          fontSize={11}
        />
      ) : (
        <Path
          data={marker === 'bloodied' ? BLOOD_DROP : CROSS}
          x={-5}
          y={-5}
          scaleX={10 / 24}
          scaleY={10 / 24}
          {...(marker === 'bloodied' ? { fill: colour } : { stroke: colour, strokeWidth: 3.5, lineCap: 'round' })}
        />
      )}
    </>
  );
}

export function TokenLayer({
  tokens,
  frame,
  scale,
  mode,
  controls,
  labelScale = 1,
}: {
  tokens: readonly CanvasToken[];
  frame: GridFrame;
  /** The camera's scale, so labels and markers keep their screen size at every zoom. */
  scale: number;
  mode: 'dm' | 'player';
  /** DM mode only, and only while tokens may be selected and dragged. */
  controls: TokenControls | undefined;
  /** How much larger than the DM's the labels and badges are drawn (the TV, UIX-01). */
  labelScale?: number;
}) {
  const shown = stacked(mode === 'player' ? tokens.filter((token) => !token.hidden) : tokens);
  const images = useTokenImages(shown.map((token) => token.image_id));
  const fontsLoaded = useFontsLoaded();
  const inverse = 1 / scale;
  const onScreen = inverse * labelScale;

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
        const centre = side / 2;
        const radius = centre * CIRCLE_SHARE;
        const at = toWorld(frame, token);
        const image = images.get(token.image_id);
        const hidden = mode === 'dm' && token.hidden;
        const selected = controls?.selectedId === token.id;
        const colours = CATEGORY_COLOURS[token.category];
        const clip = (context: Konva.Context) => {
          context.arc(centre, centre, radius, 0, Math.PI * 2, false);
        };
        const initialsPx = Math.max(radius * 0.8, 1);
        const markers = token.markers ?? [];
        const has = (marker: TokenMarker) => markers.includes(marker);
        const dead = has('dead');
        // Rings outside the token and badges keep their size on screen, larger on the TV.
        const ringScale = mode === 'player' ? labelScale * 0.6 : 1;
        const badges = BADGE_MARKERS.filter(has);
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
            {selected ? (
              // The selection: a dark ring then an ember one around the token (UIX-01).
              <>
                <Circle
                  name="token-selected-halo"
                  x={centre}
                  y={centre}
                  radius={radius + 3 * inverse}
                  stroke={TOKEN_COLOURS.halo}
                  strokeWidth={4}
                  strokeScaleEnabled={false}
                  listening={false}
                />
                <Circle
                  name="token-selected"
                  x={centre}
                  y={centre}
                  radius={radius + 5 * inverse}
                  stroke={TOKEN_COLOURS.accent}
                  strokeWidth={2}
                  strokeScaleEnabled={false}
                  listening={false}
                />
              </>
            ) : null}
            {hidden ? (
              // A dark disc under the lighter circle keeps a hidden token readable on a busy map (review).
              <Circle
                name="token-hidden-underlay"
                x={centre}
                y={centre}
                radius={radius}
                fill={TOKEN_COLOURS.halo}
                opacity={HIDDEN_UNDERLAY_OPACITY}
                listening={false}
              />
            ) : null}
            <Group name={hidden ? 'token-body token-body-hidden' : 'token-body'} opacity={hidden ? HIDDEN_OPACITY : 1}>
              <Group clipFunc={clip}>
                {image ? (
                  <KonvaImage name="token-image" image={image} width={side} height={side} />
                ) : (
                  <>
                    <Rect name="token-placeholder" width={side} height={side} fill={colours.fill} />
                    <Text
                      name="token-initials"
                      key={fontsLoaded}
                      text={initialsOf(token.label)}
                      width={side}
                      height={side}
                      align="center"
                      verticalAlign="middle"
                      fill={TOKEN_COLOURS.text}
                      fontFamily={CANVAS_FONT}
                      fontStyle="bold"
                      fontSize={initialsPx}
                      listening={false}
                    />
                  </>
                )}
                {has('unconscious') || dead ? (
                  // Desaturated: a grey of no saturation, blended in by saturation, takes the colour out.
                  <Rect
                    name="token-marker-desaturated"
                    width={side}
                    height={side}
                    fill="#808080"
                    globalCompositeOperation="saturation"
                    listening={false}
                  />
                ) : null}
                {dead ? (
                  <Rect
                    name="token-marker-dead-shade"
                    width={side}
                    height={side}
                    fill={TOKEN_COLOURS.halo}
                    opacity={0.45}
                  />
                ) : null}
              </Group>
            </Group>
            {has('bloodied') ? (
              <Group x={centre} y={centre} listening={false}>
                <BloodiedRing
                  radius={radius + 3 * inverse * ringScale}
                  width={2.5 * ringScale}
                  pulse={mode === 'player'}
                />
              </Group>
            ) : null}
            {has('concentrating') ? (
              <Circle
                name="token-marker-concentrating"
                x={centre}
                y={centre}
                radius={radius + 7 * inverse * ringScale}
                stroke={THEME.concentrating}
                strokeWidth={2 * ringScale}
                dash={[0.5, 4 * ringScale]}
                lineCap="round"
                strokeScaleEnabled={false}
                listening={false}
              />
            ) : null}
            <Circle
              name={hidden ? 'token-ring token-hidden-outline' : 'token-ring'}
              x={centre}
              y={centre}
              radius={radius}
              stroke={hidden ? TOKEN_COLOURS.hidden : colours.ring}
              strokeWidth={RING_PX * (mode === 'player' ? labelScale * 0.6 : 1)}
              {...(hidden ? { dash: [4, 3] } : {})}
              strokeScaleEnabled={false}
              listening={false}
            />
            {hidden ? (
              // The crossed-eye badge on the token's top-right, the same size on screen at every zoom (Q-054).
              <Group
                name="token-hidden-marker"
                x={centre + radius * 0.72}
                y={centre - radius * 0.72}
                scaleX={inverse}
                scaleY={inverse}
                listening={false}
              >
                <Circle radius={BADGE_PX} fill={TOKEN_COLOURS.hidden} />
                <Path
                  data={EYE_OFF}
                  x={-4.5}
                  y={-4.5}
                  scaleX={9 / 24}
                  scaleY={9 / 24}
                  stroke={TOKEN_COLOURS.halo}
                  strokeWidth={3}
                  lineCap="round"
                  lineJoin="round"
                />
              </Group>
            ) : null}
            {badges.map((marker, index) => (
              <Group
                key={marker}
                name={`token-marker token-marker-${marker}`}
                x={centre + Math.cos(BADGE_ANGLES[index]!) * radius}
                y={centre + Math.sin(BADGE_ANGLES[index]!) * radius}
                scaleX={onScreen}
                scaleY={onScreen}
                listening={false}
              >
                <MarkerBadge marker={marker} />
              </Group>
            ))}
            <Label
              name="token-label"
              x={centre}
              y={side}
              offsetX={labelWidth(token.label, hidden) / 2}
              scaleX={onScreen}
              scaleY={onScreen}
              listening={false}
            >
              <Tag fill={TOKEN_COLOURS.labelBackground} cornerRadius={4} />
              <Text
                key={fontsLoaded}
                text={token.label}
                fill={hidden ? TOKEN_COLOURS.hiddenText : TOKEN_COLOURS.text}
                fontFamily={CANVAS_FONT}
                fontStyle={labelStyle(hidden)}
                fontSize={LABEL_FONT_PX}
                padding={LABEL_PADDING}
                {...(dead ? { textDecoration: 'line-through' } : {})}
              />
            </Label>
          </Group>
        );
      })}
    </Layer>
  );
}
