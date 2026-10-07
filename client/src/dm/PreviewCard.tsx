import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { TokenAnchor } from '../canvas/MapCanvas.js';
import { placement } from './tokens/TokenPopover.js';

const WIDTH = 280;
// The room kept between the preview and the canvas's edges.
const MARGIN = 8;

// A read-only preview card beside something on the DM's map (UXR-06, UXR-08, specs/08-ux-journeys.md §14): placed as
// a popover would be, measured once drawn and moved up so it stays on the canvas, and faded at the bottom only when
// even the canvas's height cannot hold it. It takes no pointer events and no focus, so it never covers a click or a
// drag on the map. `content` is what it shows, measured again whenever it changes.
export function PreviewCard({
  anchor,
  content,
  label,
  id,
  children,
}: {
  anchor: TokenAnchor;
  content: unknown;
  label: string;
  /** What it previews, as `data-preview`. */
  id: string;
  children: ReactNode;
}) {
  const { left, top: below, side } = placement(anchor, WIDTH);
  const card = useRef<HTMLElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const drawn = card.current?.scrollHeight;
    if (drawn !== undefined && drawn !== height) setHeight(drawn);
  }, [content, height]);
  const room = anchor.viewport.height - 2 * MARGIN;
  const clipped = height !== undefined && height > room;
  const top =
    height === undefined ? below : Math.max(MARGIN, Math.min(below, anchor.viewport.height - MARGIN - height));
  return (
    <aside
      ref={card}
      className={`eg-preview eg-preview--${side}${clipped ? ' eg-preview--clipped' : ''}`}
      style={{ left, top, width: WIDTH, maxHeight: room }}
      role="tooltip"
      aria-label={label}
      data-preview={id}
    >
      {children}
    </aside>
  );
}
