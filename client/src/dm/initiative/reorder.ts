import { useLayoutEffect, useRef, type RefObject } from 'react';

// The initiative order while a row is dragged (specs/08-ux-journeys.md §12): the rows make room for it as it goes,
// so its slot always shows where it will land, and every row that changes place slides there rather than jumps.

/** `ids` with `id` moved to where `target` is. */
export function moved(ids: readonly string[], id: string, target: string): string[] {
  const next = ids.filter((each) => each !== id);
  next.splice(ids.indexOf(target), 0, id);
  return next;
}

/**
 * The order shown while `dragged` is over the row `target`: it takes that row's place once the pointer has crossed
 * the row's middle in the direction it travels, so a row sliding away under the pointer never sends it back.
 * `rect` is where the target row is drawn and `y` the pointer; without a size (no layout), the place is taken at once.
 */
export function dragOrder(
  order: readonly string[],
  dragged: string,
  target: string,
  rect: { top: number; height: number },
  y: number | undefined,
): readonly string[] {
  const from = order.indexOf(dragged);
  const to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return order;
  if (rect.height > 0 && y !== undefined) {
    const middle = rect.top + rect.height / 2;
    if (to > from ? y < middle : y > middle) return order;
  }
  return moved(order, dragged, target);
}

const SLIDE_MS = 160;

const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Slides each row of the list from where it was drawn last to where it is now (`[data-entry]` children, by their
 * layout position, which a running slide does not change). No slide under reduced motion or where the browser
 * cannot animate an element.
 */
export function useSlidingRows(list: RefObject<HTMLElement | null>): void {
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const rows = list.current?.querySelectorAll<HTMLElement>('[data-entry]') ?? [];
    const before = tops.current;
    const now = new Map<string, number>();
    const slide = !reducedMotion();
    for (const row of rows) {
      const id = row.dataset.entry!;
      const top = row.offsetTop;
      now.set(id, top);
      const was = before.get(id);
      if (slide && was !== undefined && was !== top && typeof row.animate === 'function') {
        row.animate([{ transform: `translateY(${was - top}px)` }, { transform: 'none' }], {
          duration: SLIDE_MS,
          easing: 'ease-out',
        });
      }
    }
    tops.current = now;
  });
}
