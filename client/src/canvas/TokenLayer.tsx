import { useEffect, useRef, useState } from 'react';
import Konva from 'konva';
import { Circle, Group, Image as KonvaImage, Label, Layer, Path, Rect, Tag, Text } from 'react-konva';
import {
  badgesOf,
  conditionOf,
  hasMarker,
  imageFileUrl,
  markerLevel,
  type AssetCategory,
  type TokenMarker,
} from '@emberglass/shared';
import { t } from '../ui/messages.js';
import { useHoverIntent } from './useHoverIntent.js';
import { CANVAS_FONT, THEME } from '../ui/theme.js';
import {
  dropPosition,
  DRAG_THRESHOLD_PX,
  footprint,
  movedPast,
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
// italic blue label. A token is selected when pressed and moved by dragging it, snapping as it is dropped
// unless Alt is held. A press released within DRAG_THRESHOLD_PX of where it went down is a click and opens
// the token's popover, or closes it when it is already open (UXR-06); past it the press is a drag, which closes
// the popover (D-156). The mouse resting on a token reports it for its read-only preview (hoverIntent.ts). The player mode draws only visible tokens, never a hidden one, and listens to
// nothing; what reaches a player view is filtered on the server (LIV-02). Labels and badges keep their
// size on screen at every zoom, scaled up by `labelScale` on the TV to be read across a room.
//
// Condition markers (TBL-02, TBL-05, specs/08-ux-journeys.md §11, D-157, D-158), on both views, each a badge
// with its condition's own icon and never a colour alone: at most three badges in a row along the token's top
// edge, by priority Dead, Unconscious, Bloodied, then the rest in the order applied, and a "+N" badge after
// them for the others; Exhaustion's badge carries its level. Besides its badge, Bloodied draws a red ring outside
// the token, pulsing on the TV; Concentrating a dotted purple ring further out; Unconscious and Dead
// desaturate the token, Dead also darkens it and strikes its label through; Invisible draws it semi-
// transparent, players included, and is not the hide toggle. The hidden badge sits alone on its right edge.
//
// DM notes (DMT-04, specs/08-ux-journeys.md §13): on the DM's map only, a token with notes of its own or from its
// asset carries a page badge on its left edge, whose hover text is their first lines, set on the canvas element as a
// plain-text title. The player mode never draws it, and no player token carries notes.

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
/** The turn's ring (TBL-06, DMT-02): the glow around the token whose entry has the turn. */
export const TURN_GLOW_OPACITY = 0.35;
export const HIDDEN_UNDERLAY_OPACITY = 0.6;
// The circle's radius as a share of half the footprint's side: a gap to the grid lines, as in the design.
const CIRCLE_SHARE = 0.89;
const LABEL_FONT_PX = 11;
const LABEL_PADDING = 3;
// Ring and badge sizes, in screen pixels.
const RING_PX = 2;
// A badge is 14 px across on the DM's screen, larger on the TV by `labelScale`.
const BADGE_PX = 7;
// The badges sit in a row along the token's top edge, centred on it, the "+N" badge last, a fixed distance
// apart on screen: they never overlap one another or the label below however small the token is drawn.
const BADGE_GAP_PX = 1;
// The icons are drawn on a 512-unit square, filling most of the badge.
const ICON_PX = 10;
// An Invisible token is drawn at this opacity on both views (D-157).
export const INVISIBLE_OPACITY = 0.45;
// The bloodied ring's pulse on the TV: its opacity from 1 down and back over a cycle, a few times from when
// the marker is drawn, then still (D-146): an endless animation would redraw the tokens every frame.
export const BLOODIED_PULSE_MS = 1_600;
export const BLOODIED_PULSES = 3;
const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// The page of the notes badge (DMT-04), on a 24-unit grid, as the DM view's note icon.
const NOTE_PAGE = 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h6M9 16h6';
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
  /** A token clicked without dragging: its popover opens. */
  onOpenPopover: (id: string) => void;
  /** A token dragged, or another token pressed: the popover closes and stays closed after the drop. */
  onClosePopover: () => void;
  /**
   * Several tokens selected (UXR-02, specs/08-ux-journeys.md §14): every one of them, the primary
   * (`selectedId`) last. A drag of any of them moves them all.
   */
  selectedIds?: readonly string[] | undefined;
  /** Ctrl (Cmd on macOS) and a press: the token joins the selection, or leaves it. */
  onToggle?: ((id: string) => void) | undefined;
  /** A group dropped together: each token's new position, in grid units. */
  onMoveMany?: ((moves: { id: string; at: Point }[]) => void) | undefined;
  /**
   * The mouse resting on a token (UXR-06, specs/08-ux-journeys.md §14): its id once it has rested there for
   * PREVIEW_DELAY_MS, undefined as soon as it leaves, presses or the map moves under it.
   */
  onPreview?: ((id: string | undefined) => void) | undefined;
}

const layerOf = (node: Konva.Node) => node.getLayer();

/** Whether a press adds to the selection rather than replacing it: Ctrl, or Cmd on macOS. */
export const togglesSelection = (event: { ctrlKey: boolean; metaKey: boolean }): boolean =>
  event.ctrlKey || event.metaKey;

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

/** A marker's badge: a dark disc with its condition's icon, the same size on screen at every zoom. */
function MarkerBadge({ marker }: { marker: TokenMarker }) {
  const colour =
    marker.id === 'bloodied'
      ? THEME.bloodied
      : marker.id === 'concentrating'
        ? THEME.concentrating
        : TOKEN_COLOURS.text;
  const path = conditionOf(marker.id)?.icon.path;
  const level = markerLevel(marker);
  return (
    <>
      <Circle radius={BADGE_PX} fill={TOKEN_COLOURS.halo} stroke={colour} strokeWidth={1.25} />
      {path ? (
        <Path
          name="token-marker-icon"
          data={path}
          x={-ICON_PX / 2}
          y={-ICON_PX / 2}
          scaleX={ICON_PX / 512}
          scaleY={ICON_PX / 512}
          fill={colour}
        />
      ) : null}
      {level !== undefined ? (
        // Exhaustion's level, on a small disc at the badge's lower right.
        <Group name="token-marker-level" x={BADGE_PX * 0.8} y={BADGE_PX * 0.8}>
          <Circle radius={4.5} fill={TOKEN_COLOURS.text} />
          <Text
            text={String(level)}
            width={9}
            height={9}
            x={-4.5}
            y={-4.5}
            align="center"
            verticalAlign="middle"
            fill={TOKEN_COLOURS.halo}
            fontFamily={CANVAS_FONT}
            fontStyle="bold"
            fontSize={8}
          />
        </Group>
      ) : null}
    </>
  );
}

/** The "+N" badge: how many markers the three badges leave out. */
function MoreBadge({ count }: { count: number }) {
  return (
    <>
      <Circle radius={BADGE_PX} fill={TOKEN_COLOURS.halo} stroke={TOKEN_COLOURS.text} strokeWidth={1.25} />
      <Text
        text={t('tokens.moreBadges', { count })}
        width={BADGE_PX * 2}
        height={BADGE_PX * 2}
        x={-BADGE_PX}
        y={-BADGE_PX}
        align="center"
        verticalAlign="middle"
        fill={TOKEN_COLOURS.text}
        fontFamily={CANVAS_FONT}
        fontStyle="bold"
        fontSize={count > 9 ? 7 : 8}
      />
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
  // Where the press on a token went down, in screen pixels, to tell a click from a drag on release.
  const pressed = useRef<{ id: string; at: Point }>(undefined);
  // The mouse resting on a token, for its preview (UXR-06).
  const hover = useHoverIntent(controls?.onPreview);
  // The group being dragged (UXR-02): where each of the others started, in world pixels.
  const group = useRef<{ id: string; start: Point; others: { node: Konva.Node; start: Point }[] }>(undefined);
  const grouped = (id: string) => {
    const ids = controls?.selectedIds;
    return ids !== undefined && ids.length > 1 && ids.includes(id) && controls?.onMoveMany !== undefined;
  };

  function startGroup(token: CanvasToken, node: Konva.Node) {
    const layer = node.getLayer();
    const others = (controls?.selectedIds ?? [])
      .filter((id) => id !== token.id)
      .map((id) => layer?.findOne(`#token-${id}`))
      .filter((each): each is Konva.Node => each !== undefined)
      .map((each) => ({ node: each, start: each.position() }));
    group.current = { id: token.id, start: node.position(), others };
  }

  function draggedGroup(node: Konva.Node) {
    const moving = group.current;
    if (!moving) return;
    const at = node.position();
    const dx = at.x - moving.start.x;
    const dy = at.y - moving.start.y;
    for (const other of moving.others) other.node.position({ x: other.start.x + dx, y: other.start.y + dy });
  }

  function dropped(token: CanvasToken, event: Konva.KonvaEventObject<DragEvent>) {
    const node = event.target;
    const at = dropPosition(toGrid(frame, node.position()), token.size, event.evt.altKey);
    // Placed where it snapped at once, even when the stored position does not change.
    node.position(toWorld(frame, at));
    const moving = group.current;
    group.current = undefined;
    if (moving?.id !== token.id || !controls?.onMoveMany) {
      controls?.onMove(token.id, at);
      return;
    }
    // The others keep their offsets from it: moved by the same whole squares, or the same free amount with Alt.
    const dx = at.x - token.x;
    const dy = at.y - token.y;
    const moves = [{ id: token.id, at }];
    for (const id of controls.selectedIds ?? []) {
      const other = tokens.find((each) => each.id === id);
      if (!other || id === token.id) continue;
      const next = { x: other.x + dx, y: other.y + dy };
      layerOf(node)?.findOne(`#token-${id}`)?.position(toWorld(frame, next));
      moves.push({ id, at: next });
    }
    controls.onMoveMany(moves);
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
        const selected = controls?.selectedIds?.includes(token.id) ?? controls?.selectedId === token.id;
        const colours = CATEGORY_COLOURS[token.category];
        const clip = (context: Konva.Context) => {
          context.arc(centre, centre, radius, 0, Math.PI * 2, false);
        };
        const initialsPx = Math.max(radius * 0.8, 1);
        const markers = token.markers ?? [];
        const has = (id: string) => hasMarker(markers, id);
        const dead = has('dead');
        const invisible = has('invisible');
        // Rings outside the token and badges keep their size on screen, larger on the TV.
        const ringScale = mode === 'player' ? labelScale * 0.6 : 1;
        const badges = badgesOf(markers);
        const row = badges.shown.length + (badges.more > 0 ? 1 : 0);
        return (
          <Group
            key={token.id}
            name="token"
            id={`token-${token.id}`}
            x={at.x}
            y={at.y}
            draggable={controls !== undefined}
            dragDistance={DRAG_THRESHOLD_PX}
            {...hover.handlers(token.id)}
            onPointerDown={(event) => {
              event.cancelBubble = true;
              hover.cancel();
              // Ctrl or Cmd and a press: the token joins the selection or leaves it, and nothing is dragged (UXR-02).
              if (controls?.onToggle && togglesSelection(event.evt)) {
                pressed.current = undefined;
                controls.onClosePopover();
                controls.onToggle(token.id);
                return;
              }
              pressed.current = { id: token.id, at: { x: event.evt.clientX, y: event.evt.clientY } };
              // Pressing another token never carries the open popover over to it: only a click opens one.
              if (controls && controls.selectedId !== token.id) controls.onClosePopover();
              // A press on one of a group keeps the group, which a drag then moves; a click selects it alone.
              if (!grouped(token.id)) controls?.onSelect(token.id);
            }}
            onPointerUp={(event) => {
              const press = pressed.current;
              pressed.current = undefined;
              if (!controls || press?.id !== token.id) return;
              if (!movedPast(press.at, { x: event.evt.clientX, y: event.evt.clientY })) {
                if (grouped(token.id)) controls.onSelect(token.id);
                controls.onOpenPopover(token.id);
              }
            }}
            onDragStart={(event) => {
              if (controls?.onToggle && togglesSelection(event.evt)) {
                event.target.stopDrag();
                return;
              }
              pressed.current = undefined;
              controls?.onClosePopover();
              if (grouped(token.id)) startGroup(token, event.target);
              else controls?.onSelect(token.id);
            }}
            onDragMove={(event) => draggedGroup(event.target)}
            onDragEnd={(event) => dropped(token, event)}
          >
            {token.turn === 'current' ? (
              // The token whose turn it is (TBL-06, DMT-02): a wide ember ring with a soft glow, outside every other.
              <>
                <Circle
                  name="token-turn-glow"
                  x={centre}
                  y={centre}
                  radius={radius + 10 * inverse}
                  stroke={TOKEN_COLOURS.accent}
                  strokeWidth={8}
                  opacity={TURN_GLOW_OPACITY}
                  strokeScaleEnabled={false}
                  listening={false}
                />
                <Circle
                  name="token-turn"
                  x={centre}
                  y={centre}
                  radius={radius + 10 * inverse}
                  stroke={TOKEN_COLOURS.accent}
                  strokeWidth={3}
                  strokeScaleEnabled={false}
                  listening={false}
                />
              </>
            ) : null}
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
            <Group
              name={['token-body', hidden ? 'token-body-hidden' : '', invisible ? 'token-body-invisible' : '']
                .filter(Boolean)
                .join(' ')}
              opacity={Math.min(hidden ? HIDDEN_OPACITY : 1, invisible ? INVISIBLE_OPACITY : 1)}
            >
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
                name="token-marker-concentrating-ring"
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
              // The crossed-eye badge on the token's right edge, clear of the condition badges along its top, the
              // same size on screen at every zoom (Q-054).
              <Group
                name="token-hidden-marker"
                x={centre + radius}
                y={centre}
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
            {mode === 'dm' && token.note ? (
              <Group
                name="token-note-marker"
                x={centre - radius}
                y={centre}
                scaleX={inverse}
                scaleY={inverse}
                onMouseEnter={(event) => {
                  const container = event.target.getStage()?.container();
                  if (container) container.title = token.note ?? '';
                }}
                onMouseLeave={(event) => {
                  const container = event.target.getStage()?.container();
                  if (container) container.removeAttribute('title');
                }}
              >
                <Circle
                  radius={BADGE_PX}
                  fill={TOKEN_COLOURS.labelBackground}
                  stroke={TOKEN_COLOURS.text}
                  strokeWidth={1}
                />
                <Path
                  data={NOTE_PAGE}
                  x={-4.5}
                  y={-4.5}
                  scaleX={9 / 24}
                  scaleY={9 / 24}
                  stroke={TOKEN_COLOURS.text}
                  strokeWidth={2.5}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
              </Group>
            ) : null}
            {badges.shown.map((marker, index) => (
              <Group
                key={marker.id}
                name={`token-marker token-marker-${marker.id}`}
                x={centre + (index - (row - 1) / 2) * (BADGE_PX * 2 + BADGE_GAP_PX) * onScreen}
                y={centre - radius}
                scaleX={onScreen}
                scaleY={onScreen}
                listening={false}
              >
                <MarkerBadge marker={marker} />
              </Group>
            ))}
            {badges.more > 0 ? (
              <Group
                name="token-marker-more"
                x={centre + (badges.shown.length - (row - 1) / 2) * (BADGE_PX * 2 + BADGE_GAP_PX) * onScreen}
                y={centre - radius}
                scaleX={onScreen}
                scaleY={onScreen}
                listening={false}
              >
                <MoreBadge count={badges.more} />
              </Group>
            ) : null}
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
