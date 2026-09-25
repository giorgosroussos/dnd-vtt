import { describe, expect, it } from 'vitest';
import type { Grid } from '@emberglass/shared';
import {
  cornerView,
  drawableSize,
  extentFor,
  formatDecimal,
  fromDimensions,
  fromFine,
  fromRectangle,
  initialCalibration,
  MAGNIFIER_PX,
  parseCount,
  parseDecimal,
} from './calibration.js';
import { startDraft, stepped, withField, withMethod, withRect, fieldErrors } from '../dm/calibration/draft.js';

// The arithmetic of the three calibration methods (PRP-03, specs/06-grid-and-measurement.md §1,
// §2, D-094), in the original image's pixels.

const ORIGINAL = { width: 4000, height: 3000 };
const GRID: Grid = {
  type: 'square',
  size: null,
  offset_x: 0,
  offset_y: 0,
  visible: true,
  feet_per_square: 5,
  columns: 30,
  rows: 20,
};

describe('known dimensions', () => {
  it('gives size = original width ÷ columns, a decimal, with the first line on the edges', () => {
    expect(fromDimensions(ORIGINAL, 40, 30)).toEqual({ size: 100, offset_x: 0, offset_y: 0, columns: 40, rows: 30 });
    expect(fromDimensions({ width: 1000, height: 700 }, 3, 2).size).toBe(1000 / 3);
  });
});

describe('a rectangle over N × N squares', () => {
  it('gives size = its side ÷ N and the offset from its corner, within one square', () => {
    // 3 × 3 squares of 70.4 px whose corner is at (152.8, 293.6): 152.8 = 2 × 70.4 + 12, 293.6 = 4 × 70.4 + 12.
    const result = fromRectangle({ x: 152.8, y: 293.6, width: 211.2, height: 211.2 }, 3, ORIGINAL);
    expect(result.size).toBeCloseTo(70.4, 9);
    expect(result.offset_x).toBeCloseTo(12, 9);
    expect(result.offset_y).toBeCloseTo(12, 9);
    expect(result).toMatchObject({ columns: Math.round(4000 / 70.4), rows: Math.round(3000 / 70.4) });
  });

  it('reads a rectangle dragged from any corner the same way, averaging a side that is not quite square', () => {
    const forward = fromRectangle({ x: 100, y: 100, width: 300, height: 290 }, 5, ORIGINAL);
    const backward = fromRectangle({ x: 400, y: 390, width: -300, height: -290 }, 5, ORIGINAL);
    expect(backward).toEqual(forward);
    expect(forward.size).toBe(59);
  });
});

describe('fine tuning and the starting point', () => {
  it('keeps size and offsets as typed and derives the extent from the size', () => {
    expect(fromFine(ORIGINAL, 70.4, -3.25, 12.5)).toEqual({
      size: 70.4,
      offset_x: -3.25,
      offset_y: 12.5,
      ...extentFor(ORIGINAL, 70.4),
    });
    expect(extentFor({ width: 10, height: 10 }, 400)).toEqual({ columns: 1, rows: 1 });
  });

  it('starts from the scene grid, an uncalibrated size read as width ÷ columns (D-090)', () => {
    expect(initialCalibration(GRID, ORIGINAL).size).toBe(4000 / 30);
    expect(initialCalibration({ ...GRID, size: 70.4, offset_x: 3 }, ORIGINAL)).toMatchObject({
      size: 70.4,
      offset_x: 3,
    });
  });

  it('parses decimals and counts strictly, and refuses a size too fine to draw', () => {
    expect(['70.4', ' 70 ', '-3.5', '.5', '7.'].map(parseDecimal)).toEqual([70.4, 70, -3.5, 0.5, 7]);
    expect(['', 'x', '1e3', '70,4', '--1'].map(parseDecimal)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(['3', '0', '2.5', '-1', ''].map(parseCount)).toEqual([3, undefined, undefined, undefined, undefined]);
    expect(drawableSize(0.5, ORIGINAL)).toBe(false);
    expect(drawableSize(2, ORIGINAL)).toBe(true);
    expect(formatDecimal(70.4 + 0.1)).toBe('70.5');
  });
});

describe('the far-corner magnifier', () => {
  it('shows the bottom-right region three squares wide, magnified, with the lines that fall in it', () => {
    const view = cornerView({ size: 50, offset_x: 10, offset_y: 0 }, ORIGINAL);
    expect(view.crop).toEqual({ x: 3850, y: 2850, width: 150, height: 150 });
    expect(view.zoom).toBe(MAGNIFIER_PX / 150);
    // Lines at 10 + 50k: 3860, 3910, 3960 inside the region; rows at 2850, 2900, 2950, 3000.
    expect(view.xs).toEqual([10, 60, 110].map((at) => at * view.zoom));
    expect(view.ys).toEqual([0, 50, 100, 150].map((at) => at * view.zoom));
  });

  it('never magnifies less than 1 × nor reaches past a small map', () => {
    expect(cornerView({ size: 500, offset_x: 0, offset_y: 0 }, ORIGINAL).zoom).toBe(1);
    expect(cornerView({ size: 5, offset_x: 0, offset_y: 0 }, ORIGINAL).crop.width).toBe(48);
    expect(cornerView({ size: 50, offset_x: 0, offset_y: 0 }, { width: 100, height: 30 }).crop).toEqual({
      x: 70,
      y: 0,
      width: 30,
      height: 30,
    });
  });
});

describe('the draft the panel edits', () => {
  it('turns each method into a calibration and writes it back into the other methods’ fields', () => {
    let draft = startDraft(GRID, ORIGINAL);
    expect(draft.method).toBe('dimensions');
    expect(draft.fields).toMatchObject({ columns: '30', rows: '20', squares: '3' });
    draft = withField(draft, 'columns', '40', ORIGINAL);
    expect(draft.calibration).toEqual({ size: 100, offset_x: 0, offset_y: 0, columns: 40, rows: 20 });
    expect(draft.fields.size).toBe('100');
    draft = withRect(draft, { x: 10, y: 20, width: 150, height: 150 }, ORIGINAL);
    expect(draft.method).toBe('rectangle');
    expect(draft.calibration).toMatchObject({ size: 50, offset_x: 10, offset_y: 20, columns: 80, rows: 60 });
    draft = withField(draft, 'squares', '5', ORIGINAL);
    expect(draft.calibration.size).toBe(30);
    expect(draft.fields).toMatchObject({ size: '30', columns: '133', rows: '100' });
  });

  it('steps fine-tuning values by the arrow keys without float noise, and keeps the last good calibration for a bad field', () => {
    let draft = withMethod(startDraft({ ...GRID, size: 70.4 }, ORIGINAL), 'fine');
    draft = stepped(draft, 'size', 0.1, ORIGINAL);
    expect(draft.calibration.size).toBe(70.5);
    expect(draft.fields.size).toBe('70.5');
    draft = stepped(draft, 'offset_x', -1, ORIGINAL);
    expect(draft.calibration.offset_x).toBe(-1);
    const before = draft.calibration;
    draft = withField(draft, 'offset_y', 'abc', ORIGINAL);
    expect(draft.calibration).toEqual(before);
    expect(fieldErrors(draft, ORIGINAL)).toEqual({ offset_y: 'calibration.error.decimal' });
    expect(fieldErrors(withField(draft, 'size', '0.1', ORIGINAL), ORIGINAL).size).toBe('calibration.error.size');
  });
});
