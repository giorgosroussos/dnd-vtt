import { describe, expect, it } from 'vitest';
import { measurementOf, RulerState, samePath } from './ruler.js';

// LIV-07: the measurement held in memory for the live scene (specs/04-live-sync.md §11, D-121).

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const path = { from: { column: 1, row: 2 }, to: { column: 4, row: 6 } };

describe('the measurement shown on the TV (D-121)', () => {
  it('is shown only for the live scene it was made on, and cleared entirely', () => {
    const ruler = new RulerState();
    expect(ruler.of(A)).toBeNull();
    ruler.set(A, path, 'dm-1');
    expect(ruler.of(A)).toEqual(path);
    // Another scene live (by any path), or nothing live: nothing shown.
    expect(ruler.of(B)).toBeNull();
    expect(ruler.of(null)).toBeNull();
    ruler.clear();
    expect(ruler.of(A)).toBeNull();
  });

  it('keeps a copy, so a caller changing its own path changes nothing shown', () => {
    const ruler = new RulerState();
    const mine = structuredClone(path);
    ruler.set(A, mine, undefined);
    mine.to.column = 99;
    expect(ruler.of(A)).toEqual(path);
  });

  it('remembers which socket drew the line, the last to measure owning it', () => {
    const ruler = new RulerState();
    ruler.set(A, path, 'dm-1');
    expect(ruler.drawnBy(A, 'dm-1')).toBe(true);
    expect(ruler.drawnBy(A, 'dm-2')).toBe(false);
    // Only while shown on the live scene.
    expect(ruler.drawnBy(B, 'dm-1')).toBe(false);
    ruler.set(A, path, 'dm-2');
    expect(ruler.drawnBy(A, 'dm-1')).toBe(false);
    expect(ruler.drawnBy(A, 'dm-2')).toBe(true);
    ruler.clear();
    expect(ruler.drawnBy(A, 'dm-2')).toBe(false);
  });

  it('compares paths by their squares', () => {
    expect(samePath(null, path)).toBe(false);
    expect(samePath(structuredClone(path), path)).toBe(true);
    expect(samePath({ ...path, to: { column: 4, row: 7 } }, path)).toBe(false);
    expect(samePath({ from: path.to, to: path.from }, path)).toBe(false);
  });

  it('counts the distance from the rule and the scene’s feet per square when read', () => {
    // Three across and four down: three diagonals and one straight square.
    expect(measurementOf(path, { feet_per_square: 5 }, 'phb')).toEqual({ ...path, feet: 20 });
    expect(measurementOf(path, { feet_per_square: 5 }, 'dmg')).toEqual({ ...path, feet: 25 });
    expect(measurementOf(path, { feet_per_square: 10 }, 'dmg')).toEqual({ ...path, feet: 50 });
  });
});
