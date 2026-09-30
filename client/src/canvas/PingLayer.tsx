import Konva from 'konva';
import { useEffect, useRef } from 'react';
import { Circle, Group, Layer } from 'react-konva';
import { THEME } from '../ui/theme.js';
import { toWorld, type GridFrame } from './tokens.js';

// A ping (TBL-01, specs/04-live-sync.md §12, specs/08-ux-journeys.md §11): at the point pinged, a glowing
// centre and two rings that grow and fade, one after the other, for as long as the view draws the ping.
// Drawn over the tokens, at a size in screen pixels that ignores the zoom, larger on the TV. With reduced
// motion asked for, the rings stand still.

/** One ring's cycle, and the second ring's delay behind the first, in milliseconds. */
export const PING_RING_MS = 1_600;
export const PING_RING_DELAY_MS = 500;
/** The rings' largest radius and the centre's, in screen pixels at a label scale of 1. */
const RING_PX = 34;
const CENTRE_PX = 6;

export interface PingPoint {
  key: number;
  x: number;
  y: number;
}

const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A ring's radius and opacity `elapsed` ms after the ping began, or none before its first cycle. */
export function ringAt(elapsed: number, index: number): { radius: number; opacity: number } {
  const since = elapsed - index * PING_RING_DELAY_MS;
  if (since < 0) return { radius: 0, opacity: 0 };
  const phase = (since % PING_RING_MS) / PING_RING_MS;
  return { radius: RING_PX * (0.25 + 0.75 * phase), opacity: 1 - phase };
}

function PingMarker({ x, y, size }: { x: number; y: number; size: number }) {
  const rings = useRef<(Konva.Circle | null)[]>([]);
  useEffect(() => {
    const layer = rings.current[0]?.getLayer();
    if (!layer || reducedMotion()) return;
    const animation = new Konva.Animation((frame) => {
      rings.current.forEach((ring, index) => {
        if (!ring) return;
        const { radius, opacity } = ringAt(frame?.time ?? 0, index);
        ring.radius(radius);
        ring.opacity(opacity);
      });
    }, layer);
    animation.start();
    return () => {
      animation.stop();
    };
  }, []);
  const still = reducedMotion();
  return (
    <Group name="ping" x={x} y={y} scaleX={size} scaleY={size}>
      {[0, 1].map((index) => (
        <Circle
          key={index}
          ref={(node) => {
            rings.current[index] = node;
          }}
          name="ping-ring"
          radius={still ? RING_PX * (0.6 + 0.4 * index) : 0}
          opacity={still ? 1 - 0.4 * index : 0}
          stroke={THEME.ping}
          strokeWidth={3}
          shadowColor={THEME.ping}
          shadowBlur={8}
        />
      ))}
      <Circle
        name="ping-centre"
        radius={CENTRE_PX}
        fill={THEME.ping}
        stroke={THEME.canvas}
        strokeWidth={1.5}
        shadowColor={THEME.ping}
        shadowBlur={14}
      />
    </Group>
  );
}

/** The pings being drawn, over everything else on the map; `scale` is the camera's zoom. */
export function PingLayer({
  pings,
  frame,
  scale,
  labelScale,
}: {
  pings: readonly PingPoint[];
  frame: GridFrame;
  scale: number;
  labelScale: number;
}) {
  if (pings.length === 0) return null;
  return (
    <Layer name="ping-layer" listening={false}>
      {pings.map((ping) => {
        const at = toWorld(frame, ping);
        return <PingMarker key={ping.key} x={at.x} y={at.y} size={labelScale / scale} />;
      })}
    </Layer>
  );
}
