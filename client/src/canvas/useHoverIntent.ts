import { useEffect, useRef } from 'react';
import type Konva from 'konva';
import { createHoverIntent, type HoverIntent } from './hoverIntent.js';

// The hover intent of a canvas layer (UXR-06, UXR-08): the pointer handlers of each item that can be previewed, and
// `cancel` for a press or a drag. The preview is asked for through the latest `onPreview`, and given up whenever it
// goes (a tool taking over), the camera moves (a zoom or a pan from the keyboard included), the item goes or the layer
// unmounts. Only a mouse with no button held rests: never a touch, a pen or a drag passing over.

type PointerEvent = Konva.KonvaEventObject<globalThis.PointerEvent>;

export interface HoverHandlers {
  onPointerEnter: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerLeave: () => void;
  onWheel: () => void;
}

const rests = (event: globalThis.PointerEvent) => event.pointerType === 'mouse' && event.buttons === 0;

export function useHoverIntent(
  onPreview: ((id: string | undefined) => void) | undefined,
  /** The ids of the items there are, and the camera as a key that changes whenever the map moves under them. */
  { ids, view }: { ids: readonly string[]; view: string | undefined },
): {
  handlers: (id: string) => HoverHandlers;
  cancel: () => void;
} {
  const latest = useRef(onPreview);
  useEffect(() => {
    latest.current = onPreview;
  });
  const hover = useRef<HoverIntent>(undefined);
  useEffect(() => {
    const intent = createHoverIntent((id) => latest.current?.(id));
    hover.current = intent;
    return () => {
      intent.cancel();
      intent.dispose();
    };
  }, []);
  const previewing = onPreview !== undefined;
  useEffect(() => {
    if (!previewing) hover.current?.cancel();
  }, [previewing]);
  const present = ids.join('\n');
  useEffect(() => {
    hover.current?.keep(new Set(present.split('\n')));
  }, [present]);
  useEffect(() => {
    hover.current?.cancel();
  }, [view]);
  const over = (id: string, event: PointerEvent) =>
    hover.current?.over(id, { x: event.evt.clientX, y: event.evt.clientY });
  return {
    handlers: (id) => ({
      onPointerEnter: (event) => {
        if (previewing && rests(event.evt)) over(id, event);
      },
      onPointerMove: (event) => {
        if (!previewing) return;
        if (rests(event.evt)) over(id, event);
        else hover.current?.cancel();
      },
      onPointerLeave: () => hover.current?.cancel(),
      onWheel: () => hover.current?.cancel(),
    }),
    cancel: () => hover.current?.cancel(),
  };
}
