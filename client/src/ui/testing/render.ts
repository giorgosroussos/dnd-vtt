import { act, createElement, type ComponentType, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

// Renders into a jsdom document for the component tests (D-072). Callers select
// jsdom with `// @vitest-environment jsdom`.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Rendered {
  container: HTMLElement;
  rerender: (element: ReactElement) => void;
  unmount: () => void;
}

export function render(element: ReactElement | ComponentType): Rendered {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(typeof element === 'function' ? createElement(element) : element));
  return {
    container,
    rerender: (next) => root.render(next),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

// What sequential keyboard navigation can reach: the same selector the
// Playwright keyboard smoke test uses (e2e/tests/keyboard.spec.ts).
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
