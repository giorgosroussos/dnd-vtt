import { useEffect, useState } from 'react';

/**
 * True once `on` has stayed true for `ms`, and false again as soon as it is not: so a state that
 * lasts less than `ms` (a reconnection on waking, review U-L1) is never shown.
 */
export function useHeldFor(on: boolean, ms: number): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!on) return;
    const timer = setTimeout(() => setHeld(true), ms);
    return () => {
      clearTimeout(timer);
      setHeld(false);
    };
  }, [on, ms]);
  return on && held;
}
