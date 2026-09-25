import type { Grid } from '@emberglass/shared';
import {
  drawableSize,
  formatDecimal,
  fromDimensions,
  fromFine,
  fromRectangle,
  initialCalibration,
  parseCount,
  parseDecimal,
  roundDecimal,
  type Calibration,
  type Method,
  type Rect,
} from '../../canvas/calibration.js';
import type { Size } from '../../canvas/geometry.js';
import type { MessageKey } from '../../ui/messages.js';

// What the calibration panel is editing (PRP-03, specs/06-grid-and-measurement.md §1, D-094):
// the chosen method, every field as typed, the rectangle drawn on the map, and the calibration
// they give, which the overlay draws before anything is saved. The calibration is the last one
// every field of the method produced; a field that is not a number keeps it and says why. Each
// method's result is written back into the other methods' fields, so switching to fine tuning
// starts from what known dimensions or the rectangle gave.

export type Field = 'columns' | 'rows' | 'squares' | 'size' | 'offset_x' | 'offset_y';
export const METHOD_FIELDS: Readonly<Record<Method, readonly Field[]>> = {
  dimensions: ['columns', 'rows'],
  rectangle: ['squares'],
  fine: ['size', 'offset_x', 'offset_y'],
};
export const DEFAULT_SQUARES = 3;

export interface Draft {
  method: Method;
  fields: Record<Field, string>;
  /** In original pixels, as the canvas reports it. */
  rect: Rect | undefined;
  calibration: Calibration;
}

function synced(fields: Record<Field, string>, calibration: Calibration, keep: readonly Field[]) {
  const next: Record<Field, string> = {
    ...fields,
    columns: String(calibration.columns),
    rows: String(calibration.rows),
    size: formatDecimal(calibration.size),
    offset_x: formatDecimal(calibration.offset_x),
    offset_y: formatDecimal(calibration.offset_y),
  };
  for (const field of keep) next[field] = fields[field];
  return next;
}

export function startDraft(grid: Grid, original: Size): Draft {
  const calibration = initialCalibration(grid, original);
  const fields = synced(
    { columns: '', rows: '', squares: String(DEFAULT_SQUARES), size: '', offset_x: '', offset_y: '' },
    calibration,
    [],
  );
  return { method: 'dimensions', fields, rect: undefined, calibration };
}

export function withMethod(draft: Draft, method: Method): Draft {
  return { ...draft, method };
}

/** The calibration the method's fields give, or undefined while one of them is refused. */
function computed(draft: Draft, original: Size): Calibration | undefined {
  const { fields } = draft;
  switch (draft.method) {
    case 'dimensions': {
      const columns = parseCount(fields.columns);
      const rows = parseCount(fields.rows);
      if (columns === undefined || rows === undefined) return undefined;
      const result = fromDimensions(original, columns, rows);
      return drawableSize(result.size, original) ? result : undefined;
    }
    case 'rectangle': {
      const squares = parseCount(fields.squares);
      if (squares === undefined || draft.rect === undefined) return undefined;
      const result = fromRectangle(draft.rect, squares, original);
      return drawableSize(result.size, original) ? result : undefined;
    }
    case 'fine': {
      const size = parseDecimal(fields.size);
      const x = parseDecimal(fields.offset_x);
      const y = parseDecimal(fields.offset_y);
      if (!drawableSize(size, original) || x === undefined || y === undefined) return undefined;
      return fromFine(original, size, x, y);
    }
  }
}

function recomputed(draft: Draft, original: Size): Draft {
  const calibration = computed(draft, original);
  if (!calibration) return draft;
  return { ...draft, calibration, fields: synced(draft.fields, calibration, METHOD_FIELDS[draft.method]) };
}

export function withField(draft: Draft, field: Field, text: string, original: Size): Draft {
  return recomputed({ ...draft, fields: { ...draft.fields, [field]: text } }, original);
}

export function withRect(draft: Draft, rect: Rect, original: Size): Draft {
  return recomputed({ ...draft, method: 'rectangle', rect }, original);
}

/** A fine-tuning field moved by an arrow key; a field that is not a number starts from the draft. */
export function stepped(draft: Draft, field: 'size' | 'offset_x' | 'offset_y', delta: number, original: Size): Draft {
  const current = parseDecimal(draft.fields[field]) ?? draft.calibration[field];
  const next = roundDecimal(current + delta);
  if (field === 'size' && !drawableSize(next, original)) return draft;
  return withField({ ...draft, method: 'fine' }, field, formatDecimal(next), original);
}

/** Why each field of the current method is refused, if it is. */
export function fieldErrors(draft: Draft, original: Size): Partial<Record<Field, MessageKey>> {
  const errors: Partial<Record<Field, MessageKey>> = {};
  const { fields } = draft;
  for (const field of METHOD_FIELDS[draft.method]) {
    if (field === 'size') {
      const size = parseDecimal(fields.size);
      if (size === undefined) errors.size = 'calibration.error.decimal';
      else if (!drawableSize(size, original)) errors.size = 'calibration.error.size';
    } else if (field === 'offset_x' || field === 'offset_y') {
      if (parseDecimal(fields[field]) === undefined) errors[field] = 'calibration.error.decimal';
    } else if (parseCount(fields[field]) === undefined) {
      errors[field] = 'calibration.error.count';
    }
  }
  if (draft.method === 'dimensions' && !errors.columns && !errors.rows && computed(draft, original) === undefined) {
    errors.columns = 'calibration.error.size';
  }
  if (draft.method === 'rectangle' && !errors.squares && draft.rect && computed(draft, original) === undefined) {
    errors.squares = 'calibration.error.size';
  }
  return errors;
}
