// @vitest-environment jsdom
import { act, createElement, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '../../ui/testing/render.js';
import { dragOrder, moved, reconciled, useSlidingRows } from './reorder.js';

// The initiative order while a row is dragged (specs/08-ux-journeys.md §12): the rows make room as it goes.

const order = ['a', 'b', 'c', 'd'];
const row = (index: number) => ({ top: index * 40, height: 40 });

describe('moved', () => {
  it('puts the row where the target is, up or down', () => {
    expect(moved(order, 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(moved(order, 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
  });
});

describe('dragOrder', () => {
  it('takes the place of a row below once the pointer is past its middle, and not before', () => {
    expect(dragOrder(order, 'a', 'b', row(1), 55)).toBe(order);
    expect(dragOrder(order, 'a', 'b', row(1), 60)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('takes the place of a row above once the pointer is past its middle, and not before', () => {
    expect(dragOrder(order, 'd', 'c', row(2), 105)).toBe(order);
    expect(dragOrder(order, 'd', 'c', row(2), 100)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('jumps several rows at once when the pointer does', () => {
    expect(dragOrder(order, 'a', 'd', row(3), 150)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('does not swap back with a row that slid away under the pointer', () => {
    // b took a's place above it; the pointer, still on the lower half of where b slides from, leaves it there.
    const after = ['b', 'a', 'c', 'd'];
    expect(dragOrder(after, 'a', 'b', { top: 10, height: 40 }, 45)).toBe(after);
  });

  it('keeps the order over the dragged row itself, and moves at once without a layout', () => {
    expect(dragOrder(order, 'b', 'b', row(1), 60)).toBe(order);
    expect(dragOrder(order, 'c', 'a', { top: 0, height: 0 }, undefined)).toEqual(['c', 'a', 'b', 'd']);
  });
});

describe('reconciled', () => {
  it('drops an entry gone and puts a new one at the end, the same order when nothing changed', () => {
    const held = ['d', 'a', 'b', 'c'];
    expect(reconciled(held, order)).toBe(held);
    expect(reconciled(held, ['a', 'b', 'c', 'd', 'e'])).toEqual(['d', 'a', 'b', 'c', 'e']);
    expect(reconciled(held, ['a', 'c', 'd'])).toEqual(['d', 'a', 'c']);
  });
});

describe('useSlidingRows', () => {
  let rendered: Rendered | undefined;
  afterEach(() => {
    rendered?.unmount();
    rendered = undefined;
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
  });

  // jsdom lays nothing out: each element's offset is its `data-top`, from the same unpositioned ancestor.
  const laidOut = () => {
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      return Number(this.dataset.top ?? 0);
    });
    const animate = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true });
    return animate;
  };
  function List({ top, ids }: { top: number; ids: readonly string[] }) {
    const list = useRef<HTMLOListElement>(null);
    useSlidingRows(list);
    return createElement(
      'ol',
      { ref: list, 'data-top': top },
      ids.map((id, index) => createElement('li', { key: id, 'data-entry': id, 'data-top': top + index * 40 })),
    );
  }

  it('slides the rows that change place in the list, and none when content above moves the list', () => {
    const animate = laidOut();
    rendered = render(createElement(List, { top: 100, ids: ['a', 'b', 'c'] }));
    const shown = (top: number, ids: readonly string[]) =>
      act(() => rendered!.rerender(createElement(List, { top, ids })));
    shown(160, ['a', 'b', 'c']);
    expect(animate).not.toHaveBeenCalled();
    shown(160, ['b', 'a', 'c']);
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate.mock.calls.map(([frames]) => (frames as Keyframe[])[0]!.transform)).toEqual([
      'translateY(40px)',
      'translateY(-40px)',
    ]);
  });
});
