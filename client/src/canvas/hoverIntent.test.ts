import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHoverIntent, PREVIEW_DELAY_MS, REST_TOLERANCE_PX } from './hoverIntent.js';

// The token preview's hover intent (UXR-06, specs/08-ux-journeys.md §14): shown only once the mouse has rested.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createHoverIntent', () => {
  it('waits half a second of rest before asking for the preview, and not a moment sooner', () => {
    expect(PREVIEW_DELAY_MS).toBe(500);
    const onPreview = vi.fn();
    const hover = createHoverIntent(onPreview);
    hover.over('g1', { x: 100, y: 100 });
    vi.advanceTimersByTime(PREVIEW_DELAY_MS - 1);
    expect(onPreview).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onPreview).toHaveBeenCalledExactlyOnceWith('g1');
  });

  it('keeps waiting through a small drift, and starts again on a larger move', () => {
    const onPreview = vi.fn();
    const hover = createHoverIntent(onPreview);
    hover.over('g1', { x: 100, y: 100 });
    vi.advanceTimersByTime(300);
    hover.over('g1', { x: 100 + REST_TOLERANCE_PX, y: 100 });
    vi.advanceTimersByTime(200);
    expect(onPreview).toHaveBeenCalledWith('g1');
    hover.cancel();
    onPreview.mockClear();
    hover.over('g1', { x: 100, y: 100 });
    vi.advanceTimersByTime(300);
    hover.over('g1', { x: 120, y: 100 });
    vi.advanceTimersByTime(300);
    expect(onPreview).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onPreview).toHaveBeenCalledWith('g1');
  });

  it('never shows for a pointer sweeping across tokens', () => {
    const onPreview = vi.fn();
    const hover = createHoverIntent(onPreview);
    for (let step = 0; step < 20; step++) {
      hover.over(step % 2 === 0 ? 'g1' : 'g2', { x: step * 20, y: 0 });
      vi.advanceTimersByTime(200);
    }
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('keeps a shown preview while the mouse moves over its token, and hides it on leaving', () => {
    const onPreview = vi.fn();
    const hover = createHoverIntent(onPreview);
    hover.over('g1', { x: 100, y: 100 });
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    hover.over('g1', { x: 130, y: 110 });
    expect(onPreview).toHaveBeenCalledTimes(1);
    hover.cancel();
    expect(onPreview).toHaveBeenLastCalledWith(undefined);
    hover.cancel();
    expect(onPreview).toHaveBeenCalledTimes(2);
  });

  it('hides one token preview at once when the mouse moves onto another, then waits for that one', () => {
    const onPreview = vi.fn();
    const hover = createHoverIntent(onPreview);
    hover.over('g1', { x: 100, y: 100 });
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    hover.over('g2', { x: 160, y: 100 });
    expect(onPreview).toHaveBeenLastCalledWith(undefined);
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    expect(onPreview).toHaveBeenLastCalledWith('g2');
  });

  it('asks for nothing once cancelled or disposed', () => {
    const onPreview = vi.fn();
    const hover = createHoverIntent(onPreview);
    hover.over('g1', { x: 0, y: 0 });
    hover.cancel();
    hover.over('g2', { x: 0, y: 0 });
    hover.dispose();
    vi.advanceTimersByTime(5 * PREVIEW_DELAY_MS);
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('gives up the wait and the preview of a token that is gone, and nothing else (review)', () => {
    const onPreview = vi.fn();
    const hover = createHoverIntent(onPreview);
    hover.over('g1', { x: 0, y: 0 });
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    hover.keep(new Set(['g1', 'g2']));
    expect(onPreview).toHaveBeenCalledExactlyOnceWith('g1');
    hover.keep(new Set(['g2']));
    expect(onPreview).toHaveBeenLastCalledWith(undefined);
    // Back with the same id, under a pointer that has not moved: it rests anew before showing.
    hover.over('g1', { x: 0, y: 0 });
    vi.advanceTimersByTime(PREVIEW_DELAY_MS - 1);
    expect(onPreview).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(onPreview).toHaveBeenLastCalledWith('g1');
    onPreview.mockClear();
    hover.cancel();
    hover.over('g3', { x: 0, y: 0 });
    hover.keep(new Set(['g1']));
    vi.advanceTimersByTime(5 * PREVIEW_DELAY_MS);
    expect(onPreview).toHaveBeenCalledExactlyOnceWith(undefined);
  });
});
