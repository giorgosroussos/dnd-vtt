import { describe, expect, it } from 'vitest';
import { dragOrder, moved } from './reorder.js';

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
