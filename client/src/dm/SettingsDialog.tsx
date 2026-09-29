import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  API_PATHS,
  DISPLAY_SIZE_BOUNDS,
  PIN_PATTERN,
  RULER_RULES,
  UPLOAD_LIMIT_BOUNDS,
  type RulerRule,
  type Settings,
  type SettingsUpdate,
} from '@emberglass/shared';
import { formatNumber } from '../canvas/calibration.js';
import { Button } from '../ui/Button.js';
import { Dialog } from '../ui/Dialog.js';
import { Notice } from '../ui/Notice.js';
import { TextField } from '../ui/TextField.js';
import { errorMessage } from '../ui/errorMessage.js';
import { t, type MessageKey } from '../ui/messages.js';
import { ApiError, errorCode, request } from './api.js';
import { lockedOutText } from './SignIn.js';

// Settings (REL-01, specs/09-operations.md §7, Q-051): the upload limit, the display-version size and
// the ruler's diagonal rule, changed without restarting, and the PIN change of
// specs/07-security-and-access.md §1. The server checks and bounds every value (PATCH /api/settings);
// the form refuses what it would refuse before sending, beside the field, and focus goes to the first
// field refused. Only what the DM changed is sent, so a value another browser saved meanwhile is kept
// (review C-L2); saved with nothing changed, the display size is sent alone, which finishes a
// regeneration a restart cut short and changes nothing else (D-124). A new display size is applied in
// the background, which the saved message says. Save and Change PIN stay focusable while their request
// runs (aria-disabled), so the keyboard keeps its place (D-090).

const MB = 1024 * 1024;
const LIMIT_MB = { min: UPLOAD_LIMIT_BOUNDS.min / MB, max: UPLOAD_LIMIT_BOUNDS.max / MB };
const PIN = new RegExp(PIN_PATTERN);
const RULE_LABELS: Record<RulerRule, MessageKey> = { phb: 'settings.rulerRule.phb', dmg: 'settings.rulerRule.dmg' };
const shown = (bounds: { min: number; max: number }) => ({
  min: formatNumber(bounds.min),
  max: formatNumber(bounds.max),
});

/** A whole number within the bounds, or undefined. */
function wholeWithin(text: string, { min, max }: { min: number; max: number }): number | undefined {
  if (!/^\d+$/.test(text.trim())) return undefined;
  const value = Number(text);
  return value >= min && value <= max ? value : undefined;
}

const megabytes = (bytes: number): string => String(Math.round((bytes / MB) * 10) / 10);

type FieldErrors = { limit?: string | undefined; display?: string | undefined };

export function SettingsDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (settings: Settings) => void }) {
  const ids = useId();
  const headingId = `${ids}-heading`;
  const formRef = useRef<HTMLFormElement>(null);
  const [loaded, setLoaded] = useState<Settings>();
  const [loadFailure, setLoadFailure] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [limit, setLimit] = useState('');
  const [display, setDisplay] = useState('');
  const [rule, setRule] = useState<RulerRule>('phb');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string>();
  const [failure, setFailure] = useState<string>();
  // Where focus goes after the next render: the first field once the settings arrive, or the first refused.
  const focusNext = useRef<'first' | 'invalid'>(undefined);

  const fill = (settings: Settings) => {
    setLoaded(settings);
    setLimit(megabytes(settings.upload_limit_bytes));
    setDisplay(String(settings.display_variant_size));
    setRule(settings.ruler_rule);
  };

  useEffect(() => {
    let active = true;
    request<Settings>('GET', API_PATHS.settings).then(
      (settings) => {
        if (!active) return;
        focusNext.current = 'first';
        fill(settings);
      },
      (error: unknown) => {
        if (active) setLoadFailure(t('settings.loadFailed', { reason: errorMessage(errorCode(error)) }));
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  useEffect(() => {
    const wanted = focusNext.current;
    if (!wanted || !formRef.current) return;
    focusNext.current = undefined;
    const selector = wanted === 'first' ? 'input' : 'input[aria-invalid="true"]';
    formRef.current.querySelector<HTMLInputElement>(selector)?.focus();
  });

  const edit = (apply: () => void) => {
    apply();
    setStatus(undefined);
  };

  function retry() {
    setLoadFailure(undefined);
    setAttempt((count) => count + 1);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || !loaded) return;
    const limitChanged = limit.trim() !== megabytes(loaded.upload_limit_bytes);
    const displayChanged = display.trim() !== String(loaded.display_variant_size);
    const limitMb = limitChanged ? wholeWithin(limit, LIMIT_MB) : undefined;
    const size = displayChanged ? wholeWithin(display, DISPLAY_SIZE_BOUNDS) : undefined;
    const found: FieldErrors = {
      limit: limitChanged && limitMb === undefined ? t('settings.uploadLimitInvalid', shown(LIMIT_MB)) : undefined,
      display:
        displayChanged && size === undefined ? t('settings.displaySizeInvalid', shown(DISPLAY_SIZE_BOUNDS)) : undefined,
    };
    setErrors(found);
    setStatus(undefined);
    setFailure(undefined);
    if (found.limit || found.display) {
      focusNext.current = 'invalid';
      return;
    }
    const update: SettingsUpdate = {
      ...(limitMb !== undefined ? { upload_limit_bytes: limitMb * MB } : {}),
      ...(size !== undefined ? { display_variant_size: size } : {}),
      ...(rule !== loaded.ruler_rule ? { ruler_rule: rule } : {}),
    };
    if (Object.keys(update).length === 0) update.display_variant_size = loaded.display_variant_size;
    setSaving(true);
    try {
      const saved = await request<Settings>('PATCH', API_PATHS.settings, update);
      const regenerating = saved.display_variant_size !== loaded.display_variant_size;
      fill(saved);
      onSaved(saved);
      setStatus(t(regenerating ? 'settings.savedRegenerating' : 'settings.saved'));
    } catch (error) {
      setFailure(t('settings.saveFailed', { reason: errorMessage(errorCode(error)) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog heading={t('settings.heading')} onClose={onClose}>
      {loadFailure ? (
        <>
          <Notice>{loadFailure}</Notice>
          <div className="eg-dialog__actions">
            <Button variant="primary" onClick={retry}>
              {t('settings.retry')}
            </Button>
          </div>
        </>
      ) : null}
      {!loaded && !loadFailure ? (
        <p className="eg-dm__status" role="status">
          {t('settings.loading')}
        </p>
      ) : null}
      {loaded ? (
        <form
          ref={formRef}
          className="eg-form eg-settings__section"
          aria-labelledby={headingId}
          onSubmit={(event) => void save(event)}
          noValidate
          aria-busy={saving || undefined}
        >
          <h3 id={headingId} className="eg-settings__heading">
            {t('settings.tableHeading')}
          </h3>
          {failure ? <Notice>{failure}</Notice> : null}
          <TextField
            label={t('settings.uploadLimit')}
            inputMode="numeric"
            value={limit}
            error={errors.limit}
            aria-describedby={`${ids}-limit`}
            onChange={(event) => edit(() => setLimit(event.target.value))}
          />
          <p id={`${ids}-limit`} className="eg-dm__status">
            {t('settings.uploadLimitHint', shown(LIMIT_MB))}
          </p>
          <TextField
            label={t('settings.displaySize')}
            inputMode="numeric"
            value={display}
            error={errors.display}
            aria-describedby={`${ids}-display`}
            onChange={(event) => edit(() => setDisplay(event.target.value))}
          />
          <p id={`${ids}-display`} className="eg-dm__status">
            {t('settings.displaySizeHint', shown(DISPLAY_SIZE_BOUNDS))}
          </p>
          <fieldset className="eg-settings__rule">
            <legend>{t('settings.rulerRule')}</legend>
            {RULER_RULES.map((each) => (
              <div className="eg-check" key={each}>
                <input
                  id={`${ids}-${each}`}
                  type="radio"
                  name={`${ids}-rule`}
                  value={each}
                  checked={rule === each}
                  onChange={() => edit(() => setRule(each))}
                />
                <label htmlFor={`${ids}-${each}`}>{t(RULE_LABELS[each])}</label>
              </div>
            ))}
          </fieldset>
          <p className="eg-dm__status eg-settings__status" role="status">
            {saving ? t('settings.saving') : (status ?? '')}
          </p>
          <div className="eg-dialog__actions">
            <Button type="submit" variant="primary" aria-disabled={saving || undefined}>
              {t('settings.save')}
            </Button>
          </div>
        </form>
      ) : null}
      {loaded ? <PinChange /> : null}
      <div className="eg-dialog__actions">
        <Button onClick={onClose}>{t('settings.close')}</Button>
      </div>
    </Dialog>
  );
}

type PinErrors = { current?: string | undefined; next?: string | undefined; confirm?: string | undefined };

/** The PIN change (specs/07-security-and-access.md §1, §2): every other DM browser is signed out. */
function PinChange() {
  const headingId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<PinErrors>({});
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const focusInvalid = useRef(false);

  useEffect(() => {
    if (!focusInvalid.current) return;
    focusInvalid.current = false;
    formRef.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus();
  });

  async function change(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const found: PinErrors = {
      current: PIN.test(current) ? undefined : t('setup.pinInvalid'),
      next: PIN.test(next) ? undefined : t('setup.pinInvalid'),
      confirm: PIN.test(next) && confirm !== next ? t('setup.mismatch') : undefined,
    };
    setErrors(found);
    setStatus(undefined);
    setFailure(undefined);
    if (found.current || found.next || found.confirm) {
      focusInvalid.current = true;
      return;
    }
    setPending(true);
    try {
      await request('PUT', API_PATHS.pin, { current_pin: current, new_pin: next });
      setStatus(t('settings.pinChanged'));
    } catch (error) {
      const code = errorCode(error);
      if (code === 'pin_incorrect') {
        setErrors({ current: errorMessage(code) });
        focusInvalid.current = true;
      } else {
        const wait = error instanceof ApiError ? error.retryAfter : undefined;
        const reason = code === 'locked_out' && wait !== undefined ? lockedOutText(wait) : errorMessage(code);
        setFailure(t('settings.pinFailed', { reason }));
      }
    } finally {
      // No PIN stays in the form once it has been sent, whatever the answer (review S-L4).
      setCurrent('');
      setNext('');
      setConfirm('');
      setPending(false);
    }
  }

  return (
    <form
      ref={formRef}
      className="eg-form eg-settings__section eg-settings__pin"
      aria-labelledby={headingId}
      onSubmit={(event) => void change(event)}
      noValidate
    >
      <h3 id={headingId} className="eg-settings__heading">
        {t('settings.pinHeading')}
      </h3>
      <p className="eg-dm__status">{t('settings.pinIntro')}</p>
      {failure ? <Notice>{failure}</Notice> : null}
      <TextField
        type="password"
        inputMode="numeric"
        autoComplete="current-password"
        label={t('settings.currentPin')}
        value={current}
        error={errors.current}
        onChange={(event) => setCurrent(event.target.value)}
      />
      <TextField
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        label={t('settings.newPin')}
        value={next}
        error={errors.next}
        onChange={(event) => setNext(event.target.value)}
      />
      <TextField
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        label={t('settings.confirmPin')}
        value={confirm}
        error={errors.confirm}
        onChange={(event) => setConfirm(event.target.value)}
      />
      <p className="eg-dm__status eg-settings__status" role="status">
        {status ?? ''}
      </p>
      <div className="eg-dialog__actions">
        <Button type="submit" aria-disabled={pending || undefined}>
          {t('settings.changePin')}
        </Button>
      </div>
    </form>
  );
}
