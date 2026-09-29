import { useCallback, useEffect, useRef, useState } from 'react';

// Focus moved once the next render has been committed (REL-01 review U-H1). An owner that closes a
// modal dialog cannot move focus in the same handler: until the dialog has left the document the page
// behind it is inert, and the browser ignores the call. An effect of the owner runs after the dialog's
// own removal, so focus asked for here lands.
export function useFocusLater(): (target: () => HTMLElement | null | undefined) => void {
  const pending = useRef<() => HTMLElement | null | undefined>(undefined);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    const target = pending.current;
    if (!target) return;
    pending.current = undefined;
    target()?.focus();
  }, [asked]);
  return useCallback((target) => {
    pending.current = target;
    setAsked((count) => count + 1);
  }, []);
}
