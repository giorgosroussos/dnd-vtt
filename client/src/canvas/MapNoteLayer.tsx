import { useRef } from 'react';
import type Konva from 'konva';
import { Circle, Group, Layer, Path } from 'react-konva';
import { THEME } from '../ui/theme.js';
import { DRAG_THRESHOLD_PX, movedPast, toGrid, toWorld, type GridFrame, type Point } from './tokens.js';
import { useHoverIntent } from './useHoverIntent.js';

// Map notes on the DM's map (UXR-08, specs/08-ux-journeys.md §14, Q-128): each note an icon and nothing else, a
// page on a dark disc in the ember colour, so it is never taken for a token or its notes badge, the same size on
// screen at every zoom and small enough not to crowd the map. A click opens its popover and a second click closes it;
// a press that moves past DRAG_THRESHOLD_PX is a drag, which moves it, snapped to the centre of a square unless Alt is
// held; the mouse resting on it asks for its preview. The player mode never draws this layer: map notes never reach a
// player view.

/** The icon's radius, in screen pixels: 16 px across, a little more than a token's badges. */
export const MAP_NOTE_RADIUS_PX = 8;
const PAGE = 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h6M9 16h6';

/** A map note as the canvas draws it: where, in grid units. */
export interface CanvasMapNote {
  id: string;
  x: number;
  y: number;
}

export interface MapNoteControls {
  /** The note whose popover is open, ringed. */
  openId: string | undefined;
  /** A click: opens the note's popover, or closes it when it is the open one. */
  onToggle: (id: string) => void;
  /** A note dropped at a new point, in grid units. */
  onMove: (id: string, at: Point) => void;
  /** A press that became a drag: the popover closes. */
  onClosePopover: () => void;
  /** The mouse resting on a note: its id, or undefined when it leaves (UXR-06's hover intent). */
  onPreview?: ((id: string | undefined) => void) | undefined;
}

/** Where a note dropped at `at` goes: the centre of the square under it, or exactly there with Alt. */
export function noteDropPoint(at: Point, alt: boolean): Point {
  if (alt) return { x: Math.round(at.x * 1000) / 1000, y: Math.round(at.y * 1000) / 1000 };
  return { x: Math.floor(at.x) + 0.5, y: Math.floor(at.y) + 0.5 };
}

export function MapNoteLayer({
  notes,
  frame,
  scale,
  controls,
  view,
}: {
  notes: readonly CanvasMapNote[];
  frame: GridFrame;
  scale: number;
  /** Only while map notes may be clicked and dragged; without them the layer listens to nothing. */
  controls: MapNoteControls | undefined;
  /** The camera as a key: a change, a zoom or a pan, hides the note's preview. */
  view?: string | undefined;
}) {
  const inverse = 1 / scale;
  const pressed = useRef<{ id: string; at: Point }>(undefined);
  const hover = useHoverIntent(controls?.onPreview, { ids: notes.map((note) => note.id), view });
  return (
    <Layer name="map-notes" listening={controls !== undefined}>
      {notes.map((note) => {
        const at = toWorld(frame, note);
        const open = controls?.openId === note.id;
        return (
          <Group
            key={note.id}
            name="map-note"
            id={`map-note-${note.id}`}
            x={at.x}
            y={at.y}
            scaleX={inverse}
            scaleY={inverse}
            draggable={controls !== undefined}
            dragDistance={DRAG_THRESHOLD_PX}
            {...hover.handlers(note.id)}
            onPointerDown={(event) => {
              // Neither a click on the empty map (which would place or deselect) nor a pan.
              event.cancelBubble = true;
              hover.cancel();
              pressed.current = { id: note.id, at: { x: event.evt.clientX, y: event.evt.clientY } };
            }}
            onPointerUp={(event) => {
              const press = pressed.current;
              pressed.current = undefined;
              if (!controls || press?.id !== note.id) return;
              if (!movedPast(press.at, { x: event.evt.clientX, y: event.evt.clientY })) controls.onToggle(note.id);
            }}
            onDragStart={(event) => {
              event.cancelBubble = true;
              pressed.current = undefined;
              hover.cancel();
              controls?.onClosePopover();
            }}
            onDragEnd={(event: Konva.KonvaEventObject<DragEvent>) => {
              event.cancelBubble = true;
              const node = event.target;
              const to = noteDropPoint(toGrid(frame, { x: node.x(), y: node.y() }), event.evt.altKey);
              // Drawn where it lands at once; the scene's notes then follow the stored point.
              const world = toWorld(frame, to);
              node.position(world);
              controls?.onMove(note.id, to);
            }}
          >
            <Circle
              radius={MAP_NOTE_RADIUS_PX}
              fill="rgba(12, 9, 7, 0.88)"
              stroke={open ? THEME.text : THEME.accent}
              strokeWidth={open ? 2 : 1.5}
              // A slightly larger target than the icon, so a small icon is still easy to hit.
              hitStrokeWidth={8}
            />
            <Path
              data={PAGE}
              x={-5}
              y={-5}
              scaleX={10 / 24}
              scaleY={10 / 24}
              stroke={THEME.accent}
              strokeWidth={2.4}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          </Group>
        );
      })}
    </Layer>
  );
}
