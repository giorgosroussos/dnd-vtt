import { describe, expect, it } from 'vitest';
import { isMeasurement, rulerFeet, rulerSquares } from './ruler.js';

// Ruler distances (LIV-07; specs/06-grid-and-measurement.md §5, specs/10-testing-acceptance.md §2, Q-048,
// Q-087, D-045): between the centres of two squares, by the PHB 2014 rule and the optional DMG rule, and
// scaled by the scene's feet per square.

const at = (column: number, row: number) => ({ column, row });

describe('ruler distances (specs/06-grid-and-measurement.md §5)', () => {
  it('counts nothing from a square to itself', () => {
    for (const rule of ['phb', 'dmg'] as const) {
      expect(rulerSquares(at(3, 4), at(3, 4), rule)).toBe(0);
      expect(rulerFeet(at(3, 4), at(3, 4), rule, 5)).toBe(0);
    }
  });

  it('counts a straight path one square per square under both rules, either way along either axis', () => {
    for (const rule of ['phb', 'dmg'] as const) {
      expect(rulerFeet(at(0, 0), at(6, 0), rule, 5)).toBe(30);
      expect(rulerFeet(at(6, 0), at(0, 0), rule, 5)).toBe(30);
      expect(rulerFeet(at(2, 9), at(2, 1), rule, 5)).toBe(40);
      expect(rulerFeet(at(-3, 0), at(2, 0), rule, 5)).toBe(25);
    }
  });

  it('counts every diagonal as 5 ft under the PHB 2014 rule', () => {
    expect(rulerFeet(at(0, 0), at(1, 1), 'phb', 5)).toBe(5);
    expect(rulerFeet(at(0, 0), at(2, 2), 'phb', 5)).toBe(10);
    expect(rulerFeet(at(0, 0), at(5, 5), 'phb', 5)).toBe(25);
    expect(rulerFeet(at(5, 0), at(0, 5), 'phb', 5)).toBe(25);
  });

  it('alternates diagonals 5 ft and 10 ft under the DMG rule', () => {
    expect(rulerFeet(at(0, 0), at(1, 1), 'dmg', 5)).toBe(5);
    expect(rulerFeet(at(0, 0), at(2, 2), 'dmg', 5)).toBe(15);
    expect(rulerFeet(at(0, 0), at(3, 3), 'dmg', 5)).toBe(20);
    expect(rulerFeet(at(0, 0), at(4, 4), 'dmg', 5)).toBe(30);
    expect(rulerFeet(at(0, 0), at(5, 5), 'dmg', 5)).toBe(35);
    expect(rulerFeet(at(4, 4), at(0, 0), 'dmg', 5)).toBe(30);
  });

  it('adds the straight part to the diagonal part of a mixed path', () => {
    // Six across and two down: two diagonals and four straight squares.
    expect(rulerSquares(at(0, 0), at(6, 2), 'phb')).toBe(6);
    expect(rulerSquares(at(0, 0), at(6, 2), 'dmg')).toBe(7);
    expect(rulerFeet(at(0, 0), at(6, 2), 'phb', 5)).toBe(30);
    expect(rulerFeet(at(0, 0), at(6, 2), 'dmg', 5)).toBe(35);
    // Two across and seven up: two diagonals and five straight squares, the same either way round.
    expect(rulerFeet(at(1, 8), at(3, 1), 'phb', 5)).toBe(35);
    expect(rulerFeet(at(1, 8), at(3, 1), 'dmg', 5)).toBe(40);
    expect(rulerFeet(at(3, 1), at(1, 8), 'dmg', 5)).toBe(40);
    // Five diagonals and three straight: 5 + 2 extra under the DMG rule.
    expect(rulerFeet(at(0, 0), at(8, 5), 'phb', 5)).toBe(40);
    expect(rulerFeet(at(0, 0), at(8, 5), 'dmg', 5)).toBe(50);
  });

  it('scales every distance by the feet per square, at 10 ft and at a decimal scale', () => {
    expect(rulerFeet(at(0, 0), at(6, 0), 'phb', 10)).toBe(60);
    expect(rulerFeet(at(0, 0), at(3, 3), 'phb', 10)).toBe(30);
    expect(rulerFeet(at(0, 0), at(3, 3), 'dmg', 10)).toBe(40);
    expect(rulerFeet(at(0, 0), at(6, 2), 'dmg', 10)).toBe(70);
    expect(rulerFeet(at(0, 0), at(3, 0), 'phb', 2.5)).toBe(7.5);
    // No float noise: 0.1 × 3 is 0.30000000000000004 in binary.
    expect(rulerFeet(at(0, 0), at(3, 0), 'phb', 0.1)).toBe(0.3);
    expect(rulerFeet(at(0, 0), at(2, 0), 'phb', 5280)).toBe(10_560);
  });
});

describe('what a measurement event must carry (LIV-07 review C-L3)', () => {
  it('takes two whole squares and a finite distance of zero or more', () => {
    expect(isMeasurement({ from: at(0, 0), to: at(2, -1), feet: 10 })).toBe(true);
    expect(isMeasurement({ from: at(0, 0), to: at(0, 0), feet: 0 })).toBe(true);
    for (const wrong of [
      null,
      'x',
      { from: at(0, 0), to: at(1, 1) },
      { from: at(0, 0), to: at(1, 1), feet: Number.NaN },
      { from: at(0, 0), to: at(1, 1), feet: -1 },
      { from: at(0.5, 0), to: at(1, 1), feet: 5 },
      { from: { column: 1 }, to: at(1, 1), feet: 5 },
    ]) {
      expect(isMeasurement(wrong), JSON.stringify(wrong)).toBe(false);
    }
  });
});
