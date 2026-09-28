import { useEffect, useId, useState, type FormEvent } from 'react';
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
import { Button } from '../ui/Button.js';
import { Dialog } from '../ui/Dialog.js';
import { Notice } from '../ui/Notice.js';
import { TextField } from '../ui/TextField.js';
import { errorMessage } from '../ui/errorMessage.js';
import { t, type MessageKey } from '../ui/messages.js';
import { ApiError, errorCode, request } from './api.js';

// Settings (REL-01, specs/09-operations.md §7, Q-051): the upload limit, the display-version size and
// the ruler's diagonal rule, changed without restarting, and the PIN change of
// specs/07-security-and-access.md §1. The server checks and bounds every value (PATCH /api/settings);
// the form refuses what it would refuse before sending, beside the field. A new display size is applied
// in the background, which the saved message says.

const MB = 1024 * 1024;
const LIMIT_MB = { min: UPLOAD_LIMIT_BOUNDS.min / MB, max: UPLOAD_LIMIT_BOUNDS.max / MB };
const PIN = new RegExp(PIN_PATTERN);
const pinInput = { type: 'password', inputMode: 'numeric', autoComplete: 'off' } as const;

/** A whole number within the bounds, or undefined. */
function wholeWithin(text: string, { min, max }: { min: number; max: number }): number | undefined {
  if (!/^\d+$/.test(text.trim())) return undefined;
  const value = Number(text);
  return value >= min && value <= max ? value : undefined;
}

const megabytes = (bytes: number): string => String(Math.round((bytes / MB) * 10) / 10);

type FieldErrors = { limit?: string | undefined; display?: string | undefined };

export function SettingsDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (settings: Settings) => void }) {
  const ruleName = useId();
  const [loaded, setLoaded] = useState<Settings>();
  const [loadFailure, setLoadFailure] = useState<string>();
  const [limit, setLimit] = useState('');
  const [display, setDisplay] = useState('');
  const [rule, setRule] = useState<RulerRule>('phb');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string>();
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    request<Settings>('GET', API_PATHS.settings).then(
      (settings) => {
        setLoaded(settings);
        setLimit(megabytes(settings.upload_limit_bytes));
        setDisplay(String(settings.display_variant_size));
        setRule(settings.ruler_rule);
      },
      (error: unknown) => setLoadFailure(t('settings.loadFailed', { reason: errorMessage(errorCode(error)) })),
    );
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || !loaded) return;
    const limitMb = wholeWithin(limit, LIMIT_MB);
    const size = wholeWithin(display, DISPLAY_SIZE_BOUNDS);
    const found: FieldErrors = {
      limit: limitMb === undefined ? t('settings.uploadLimitInvalid', LIMIT_MB) : undefined,
      display: size === undefined ? t('settings.displaySizeInvalid', DISPLAY_SIZE_BOUNDS) : undefined,
    };
    setErrors(found);
    setStatus(undefined);
    setFailure(undefined);
    if (limitMb === undefined || size === undefined) return;
    const update: SettingsUpdate = { upload_limit_bytes: limitMb * MB, display_variant_size: size, ruler_rule: rule };
    setSaving(true);
    try {
      const saved = await request<Settings>('PATCH', API_PATHS.settings, update);
      const regenerating = saved.display_variant_size !== loaded.display_variant_size;
      setLoaded(saved);
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
      {loadFailure ? <Notice>{loadFailure}</Notice> : null}
      {!loaded && !loadFailure ? (
        <p className="eg-dm__status" role="status">
          {t('settings.loading')}
        </p>
      ) : null}
      {loaded ? (
        <form className="eg-form" onSubmit={(event) => void save(event)} noValidate aria-busy={saving || undefined}>
          {failure ? <Notice>{failure}</Notice> : null}
          <TextField
            label={t('settings.uploadLimit')}
            inputMode="numeric"
            value={limit}
            error={errors.limit}
            aria-describedby={`${ruleName}-limit`}
            onChange={(event) => setLimit(event.target.value)}
          />
          <p id={`${ruleName}-limit`} className="eg-dm__status">
            {t('settings.uploadLimitHint', LIMIT_MB)}
          </p>
          <TextField
            label={t('settings.displaySize')}
            inputMode="numeric"
            value={display}
            error={errors.display}
            aria-describedby={`${ruleName}-display`}
            onChange={(event) => setDisplay(event.target.value)}
          />
          <p id={`${ruleName}-display`} className="eg-dm__status">
            {t('settings.displaySizeHint', DISPLAY_SIZE_BOUNDS)}
          </p>
          <fieldset className="eg-form">
            <legend>{t('settings.rulerRule')}</legend>
            {RULER_RULES.map((each) => (
              <div className="eg-check" key={each}>
                <input
                  id={`${ruleName}-${each}`}
                  type="radio"
                  name={ruleName}
                  value={each}
                  checked={rule === each}
                  onChange={() => setRule(each)}
                />
                <label htmlFor={`${ruleName}-${each}`}>{t(`settings.rulerRule.${each}` as MessageKey)}</label>
              </div>
            ))}
          </fieldset>
          <p className="eg-dm__status" role="status">
            {saving ? t('settings.saving') : (status ?? '')}
          </p>
          <div className="eg-dialog__actions">
            <Button type="submit" variant="primary" disabled={saving}>
              {t('settings.save')}
            </Button>
          </div>
        </form>
      ) : null}
      <PinChange />
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
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<PinErrors>({});
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string>();
  const [failure, setFailure] = useState<string>();

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
    if (found.current || found.next || found.confirm) return;
    setPending(true);
    try {
      await request('PUT', API_PATHS.pin, { current_pin: current, new_pin: next });
      setStatus(t('settings.pinChanged'));
      setNext('');
      setConfirm('');
    } catch (error) {
      const code = errorCode(error);
      if (code === 'pin_incorrect') setErrors({ current: errorMessage(code) });
      else {
        const wait = error instanceof ApiError ? error.retryAfter : undefined;
        const reason =
          code === 'locked_out' && wait !== undefined ? t('signIn.lockedOut', { seconds: wait }) : errorMessage(code);
        setFailure(t('settings.pinFailed', { reason }));
      }
    } finally {
      // The PIN stays only as long as the form needs it.
      setCurrent('');
      setPending(false);
    }
  }

  return (
    <form
      className="eg-form eg-settings__pin"
      aria-labelledby={headingId}
      onSubmit={(event) => void change(event)}
      noValidate
    >
      <h3 id={headingId} className="eg-connect__subheading">
        {t('settings.pinHeading')}
      </h3>
      <p className="eg-dm__status">{t('settings.pinIntro')}</p>
      {failure ? <Notice>{failure}</Notice> : null}
      <TextField
        {...pinInput}
        label={t('settings.currentPin')}
        value={current}
        error={errors.current}
        onChange={(event) => setCurrent(event.target.value)}
      />
      <TextField
        {...pinInput}
        label={t('settings.newPin')}
        value={next}
        error={errors.next}
        onChange={(event) => setNext(event.target.value)}
      />
      <TextField
        {...pinInput}
        label={t('settings.confirmPin')}
        value={confirm}
        error={errors.confirm}
        onChange={(event) => setConfirm(event.target.value)}
      />
      <p className="eg-dm__status" role="status">
        {status ?? ''}
      </p>
      <div className="eg-dialog__actions">
        <Button type="submit" disabled={pending}>
          {t('settings.changePin')}
        </Button>
      </div>
    </form>
  );
}
