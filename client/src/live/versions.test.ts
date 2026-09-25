import { describe, expect, it } from 'vitest';
import { createVersionTracker } from './versions.js';

// Gap detection (specs/04-live-sync.md §5, D-104, D-108).
describe('version tracker', () => {
  it('waits for a first snapshot and applies each next version after it', () => {
    const tracker = createVersionTracker();
    expect(tracker.event(1)).toBe('wait');
    tracker.snapshot(3);
    expect([tracker.event(4), tracker.event(5), tracker.event(6)]).toEqual(['apply', 'apply', 'apply']);
    expect(tracker.version).toBe(6);
  });

  it('finds a gap in a skipped version, then drops events until a snapshot', () => {
    const tracker = createVersionTracker();
    tracker.snapshot(1);
    expect(tracker.event(3)).toBe('gap');
    expect(tracker.awaiting).toBe(true);
    expect([tracker.event(4), tracker.event(5)]).toEqual(['wait', 'wait']);
    tracker.snapshot(5);
    expect(tracker.event(6)).toBe('apply');
  });

  it('finds a gap in a version lower than the last or repeated (a server restart)', () => {
    const lower = createVersionTracker();
    lower.snapshot(40);
    expect(lower.event(2)).toBe('gap');
    const repeated = createVersionTracker();
    repeated.snapshot(7);
    expect(repeated.event(7)).toBe('gap');
  });

  it('holds nothing after the connection is lost, until the next snapshot', () => {
    const tracker = createVersionTracker();
    tracker.snapshot(9);
    tracker.reset();
    expect(tracker.version).toBeUndefined();
    expect(tracker.event(10)).toBe('wait');
    tracker.snapshot(1);
    expect(tracker.event(2)).toBe('apply');
  });
});
