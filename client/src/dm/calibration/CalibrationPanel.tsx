import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { FINE_STEP, FINE_STEP_SHIFT, formatDecimal, METHODS, type Method } from '../../canvas/calibration.js';
import type { Size } from '../../canvas/geometry.js';
import type { CanvasMap } from '../../canvas/MapCanvas.js';
import { Button } from '../../ui/Button.js';
import { TextField } from '../../ui/TextField.js';
import { t, type MessageKey } from '../../ui/messages.js';
import { fieldErrors, METHOD_FIELDS, stepped, withField, withMethod, type Draft, type Field } from './draft.js';

// Grid calibration above the canvas (PRP-03, specs/06-grid-and-measurement.md §1, D-094): the
// three methods, each changing the draft the overlay and the magnifier draw at once, and Save
// or Cancel. The magnifier floats over the canvas's far corner (ScenePanel). Known dimensions and fine tuning are operated by keyboard alone; the rectangle is
// dragged on the map with the pointer, and its result can then be fine-tuned by keyboard.
// While a save runs, the controls refuse but keep focus (D-093).

const METHOD_LABEL: Record<Method, MessageKey> = {
  dimensions: 'calibration.method.dimensions',
  rectangle: 'calibration.method.rectangle',
  fine: 'calibration.method.fine',
};

const FIELD_LABEL: Record<Field, MessageKey> = {
  columns: 'calibration.columns',
  rows: 'calibration.rows',
  squares: 'calibration.squares',
  size: 'calibration.size',
  offset_x: 'calibration.offsetX',
  offset_y: 'calibration.offsetY',
};

const FINE_FIELDS = new Set<Field>(['size', 'offset_x', 'offset_y']);

export function CalibrationPanel({
  map,
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  map: CanvasMap;
  draft: Draft;
  onChange: (change: (draft: Draft) => Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const headingId = useId();
  const hintId = useId();
  const panel = useRef<HTMLElement>(null);
  const original: Size = { width: map.width, height: map.height };
  const errors = fieldErrors(draft, original);
  const { calibration } = draft;

  // Opening the panel takes the keyboard to the method, so the DM starts where the choice is.
  useEffect(() => {
    panel.current?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus();
  }, []);

  const refuse = (event: { preventDefault: () => void }) => {
    if (saving) event.preventDefault();
  };

  function onFieldKey(field: Field, event: KeyboardEvent<HTMLInputElement>) {
    if (!FINE_FIELDS.has(field) || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    if (saving) return;
    const step = (event.shiftKey ? FINE_STEP_SHIFT : FINE_STEP) * (event.key === 'ArrowUp' ? 1 : -1);
    onChange((current) => stepped(current, field as 'size' | 'offset_x' | 'offset_y', step, original));
  }

  function save() {
    if (saving) return;
    const invalid = METHOD_FIELDS[draft.method].find((field) => errors[field]);
    if (invalid) {
      panel.current?.querySelector<HTMLInputElement>(`input[name="${invalid}"]`)?.focus();
      return;
    }
    onSave();
  }

  return (
    // Escape cancels, as the Cancel button does (D-096).
    <section
      ref={panel}
      className="eg-calibration"
      aria-labelledby={headingId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || saving) return;
        event.preventDefault();
        onCancel();
      }}
    >
      <div className="eg-calibration__top">
        {/* Named for assistive technology; on screen the strip is plainly what Calibrate grid opened. */}
        <h2 id={headingId} className="eg-visually-hidden">
          {t('calibration.heading')}
        </h2>
        <fieldset className="eg-calibration__methods">
          <legend className="eg-visually-hidden">{t('calibration.method')}</legend>
          {METHODS.map((method) => (
            <label key={method} className="eg-check">
              <input
                type="radio"
                name="calibration-method"
                value={method}
                checked={draft.method === method}
                aria-disabled={saving || undefined}
                onClick={refuse}
                onChange={() => onChange((current) => withMethod(current, method))}
              />
              {t(METHOD_LABEL[method])}
            </label>
          ))}
        </fieldset>
      </div>
      <div className="eg-calibration__row">
        <div className="eg-calibration__fields">
          {METHOD_FIELDS[draft.method].map((field) => (
            <TextField
              key={field}
              name={field}
              label={t(FIELD_LABEL[field])}
              inputMode={FINE_FIELDS.has(field) ? 'decimal' : 'numeric'}
              autoComplete="off"
              value={draft.fields[field]}
              error={errors[field] ? t(errors[field]) : undefined}
              aria-describedby={hintId}
              aria-disabled={saving || undefined}
              readOnly={saving}
              onKeyDown={(event) => onFieldKey(field, event)}
              onChange={(event) => {
                const text = event.target.value;
                onChange((current) => withField(current, field, text, original));
              }}
            />
          ))}
        </div>
        <div className="eg-calibration__actions">
          <Button variant="primary" aria-disabled={saving || undefined} onClick={save}>
            {t('calibration.save')}
          </Button>
          <Button aria-disabled={saving || undefined} onClick={() => !saving && onCancel()}>
            {t('calibration.cancel')}
          </Button>
        </div>
      </div>
      <div className="eg-calibration__notes">
        <p id={hintId} className="eg-calibration__hint">
          {draft.method === 'dimensions'
            ? t('calibration.hint.dimensions')
            : draft.method === 'rectangle'
              ? t('calibration.hint.rectangle', { squares: draft.fields.squares })
              : t('calibration.hint.fine')}
        </p>
        {draft.method === 'rectangle' ? (
          <p className="eg-calibration__hint">
            {draft.rect
              ? t('calibration.measured', {
                  width: formatDecimal(draft.rect.width),
                  height: formatDecimal(draft.rect.height),
                })
              : t('calibration.notMeasured')}
          </p>
        ) : null}
        <p className="eg-calibration__result">
          {t('calibration.result', {
            size: formatDecimal(calibration.size),
            x: formatDecimal(calibration.offset_x),
            y: formatDecimal(calibration.offset_y),
            columns: calibration.columns,
            rows: calibration.rows,
          })}
        </p>
      </div>
    </section>
  );
}
