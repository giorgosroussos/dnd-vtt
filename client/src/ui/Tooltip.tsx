import { useState, type FocusEvent } from 'react';
import { createPortal } from 'react-dom';

// A tooltip (UXR-04, specs/08-ux-journeys.md §14): the text a compact control shows on hover and on
// keyboard focus, beside the control. It is drawn in the body at a fixed position, so a list that
// scrolls (the session switcher) never clips it. It repeats the control's accessible name, which the
// control carries itself, so it is hidden from assistive technology and only what a sighted user reads.
export function useTooltip(text: string) {
  const [at, setAt] = useState<{ x: number; y: number }>();
  const show = (target: Element) => {
    const box = target.getBoundingClientRect();
    setAt({ x: box.left + box.width / 2, y: box.bottom + 6 });
  };
  const hide = () => setAt(undefined);
  const triggerProps = {
    onPointerEnter: (event: { currentTarget: Element }) => show(event.currentTarget),
    onPointerLeave: hide,
    onFocus: (event: FocusEvent<Element>) => {
      // A ring only: a click focuses the control too, and its tooltip would linger after it.
      if (event.currentTarget.matches(':focus-visible')) show(event.currentTarget);
    },
    onBlur: hide,
    onKeyDown: (event: { key: string }) => {
      if (event.key === 'Escape') hide();
    },
  };
  const tooltip =
    at === undefined
      ? null
      : createPortal(
          <span className="eg-tooltip" aria-hidden="true" style={{ left: at.x, top: at.y }}>
            {text}
          </span>,
          document.body,
        );
  return { triggerProps, tooltip };
}
