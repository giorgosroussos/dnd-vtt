import { useEffect, useState } from 'react';

// The TV hides the mouse pointer once it has been still for `idleMs` (specs/08-ux-journeys.md §9,
// Q-054): a pointer left over the map would sit on the table's screen all evening. Any movement
// shows it again and starts the wait afresh; it starts hidden-after-the-wait on opening too.
export function useIdleCursor(idleMs: number): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let timer = setTimeout(() => setHidden(true), idleMs);
    const moved = () => {
      clearTimeout(timer);
      setHidden(false);
      timer = setTimeout(() => setHidden(true), idleMs);
    };
    window.addEventListener('pointermove', moved);
    window.addEventListener('mousemove', moved);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', moved);
      window.removeEventListener('mousemove', moved);
    };
  }, [idleMs]);
  return hidden;
}
