import { describe, expect, it } from 'vitest';
import { PING_RING_DELAY_MS, PING_RING_MS, ringAt } from './PingLayer.js';

// The ping's rings (TBL-01, specs/08-ux-journeys.md §11): each grows and fades over a cycle, the second
// starting half a second after the first.

describe('ringAt', () => {
  it('grows each ring from small to full while it fades out, cycle after cycle', () => {
    const start = ringAt(0, 0);
    const middle = ringAt(PING_RING_MS / 2, 0);
    const late = ringAt(PING_RING_MS - 1, 0);
    expect(start.opacity).toBe(1);
    expect(middle.radius).toBeGreaterThan(start.radius);
    expect(late.radius).toBeGreaterThan(middle.radius);
    expect(late.opacity).toBeLessThan(middle.opacity);
    expect(ringAt(PING_RING_MS, 0)).toEqual(start);
  });

  it('shows the second ring only from its delay on, then as the first was', () => {
    expect(ringAt(PING_RING_DELAY_MS - 1, 1)).toEqual({ radius: 0, opacity: 0 });
    expect(ringAt(PING_RING_DELAY_MS, 1)).toEqual(ringAt(0, 0));
    expect(ringAt(PING_RING_DELAY_MS + 300, 1)).toEqual(ringAt(300, 0));
  });
});
