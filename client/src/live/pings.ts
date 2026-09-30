import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventEnvelope, PingShownPayload } from '@emberglass/shared';

// The pings a view is drawing (TBL-01, specs/04-live-sync.md §12): each `ping` event is drawn for
// `PING_MS` and then let go. Nothing keeps a ping, so no snapshot brings one back, and a snapshot, which
// means another scene, a gap or a reconnection, lets every ping go at once. A burst draws the latest
// `MAX_PINGS` only.

/** How long a ping is drawn. */
export const PING_MS = 2_000;
/** How many pings are drawn at once. */
export const MAX_PINGS = 8;

/** A ping being drawn: its point in grid units, and a key of its own for this view. */
export interface Ping {
  key: number;
  x: number;
  y: number;
}

/** The point a `ping` event carries, or undefined for a malformed one, which is skipped. */
export function pingPoint(event: EventEnvelope): { x: number; y: number } | undefined {
  if (event.type !== 'ping') return undefined;
  const { x, y } = event.payload as unknown as Partial<PingShownPayload>;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
}

export interface Pings {
  pings: Ping[];
  /** Draws the ping an event carries; any other event is ignored. */
  onEvent: (event: EventEnvelope) => void;
  /** Lets every ping go: on a snapshot. */
  clear: () => void;
}

export function usePings(): Pings {
  const [pings, setPings] = useState<Ping[]>([]);
  const next = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);
  const onEvent = useCallback((event: EventEnvelope) => {
    const point = pingPoint(event);
    if (!point) return;
    const ping = { key: next.current++, ...point };
    setPings((current) => [...current, ping].slice(-MAX_PINGS));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setPings((current) => current.filter((each) => each.key !== ping.key));
    }, PING_MS);
    timers.current.add(timer);
  }, []);
  const clear = useCallback(() => setPings((current) => (current.length === 0 ? current : [])), []);
  return { pings, onEvent, clear };
}
