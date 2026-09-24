import { useState, type FormEvent } from 'react';
import { API_PATHS, PIN_PATTERN } from '@emberglass/shared';
import { Button } from '../ui/Button.js';
import { Notice } from '../ui/Notice.js';
import { TextField } from '../ui/TextField.js';
import { errorMessage } from '../ui/errorMessage.js';
import { t } from '../ui/messages.js';
import { ApiError, errorCode, request } from './api.js';

// First-run setup and PIN entry (specs/07-security-and-access.md §1, §2, §6,
// D-076, D-085). The PIN lives only in the form's state until it is sent; it is
// never stored, and the session it buys is the HttpOnly cookie the server sets.

const PIN = new RegExp(PIN_PATTERN);

// Browsers may fill the field from a password manager; numeric keypad on laptops with one.
const pinInput = { type: 'password', inputMode: 'numeric', required: true } as const;

/** Set the first PIN: only reachable from a browser on the server PC. */
export function SetupScreen({ onDone, onPinAlreadySet }: { onDone: () => void; onPinAlreadySet: () => void }) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldError, setFieldError] = useState<{ pin?: string; confirm?: string }>({});
  const [failure, setFailure] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!PIN.test(pin)) return setFieldError({ pin: t('setup.pinInvalid') });
    if (confirm !== pin) return setFieldError({ confirm: t('setup.mismatch') });
    setFieldError({});
    setFailure(undefined);
    setPending(true);
    try {
      await request('POST', API_PATHS.setup, { pin });
      onDone();
    } catch (error) {
      setPending(false);
      if (errorCode(error) === 'pin_already_set') return onPinAlreadySet();
      setFailure(errorMessage(errorCode(error)));
    }
  }

  return (
    <form className="eg-signin" onSubmit={(event) => void submit(event)} noValidate>
      <h1 className="eg-dm__heading">{t('setup.heading')}</h1>
      <p className="eg-dm__status">{t('setup.intro')}</p>
      {failure ? <Notice>{failure}</Notice> : null}
      <TextField
        {...pinInput}
        label={t('setup.pin')}
        autoComplete="new-password"
        value={pin}
        onChange={(event) => setPin(event.target.value)}
        error={fieldError.pin}
      />
      <TextField
        {...pinInput}
        label={t('setup.confirm')}
        autoComplete="new-password"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        error={fieldError.confirm}
      />
      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {t('setup.submit')}
        </Button>
      </div>
    </form>
  );
}

/** A DM view opened from the LAN before a PIN exists: where to go, and nothing else. */
export function SetupElsewhere() {
  return (
    <div className="eg-signin">
      <h1 className="eg-dm__heading">{t('setupElsewhere.heading')}</h1>
      <p className="eg-dm__status">{t('setupElsewhere.body')}</p>
    </div>
  );
}

export function PinEntry({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!PIN.test(pin)) return setFieldError(t('setup.pinInvalid'));
    setFieldError(undefined);
    setFailure(undefined);
    setPending(true);
    try {
      await request('POST', API_PATHS.auth, { pin });
      onDone();
    } catch (error) {
      setPending(false);
      setPin('');
      const code = errorCode(error);
      if (code === 'pin_incorrect') return setFieldError(errorMessage(code));
      const wait = error instanceof ApiError ? error.retryAfter : undefined;
      setFailure(
        code === 'locked_out' && wait !== undefined ? t('signIn.lockedOut', { seconds: wait }) : errorMessage(code),
      );
    }
  }

  return (
    <form className="eg-signin" onSubmit={(event) => void submit(event)} noValidate>
      <h1 className="eg-dm__heading">{t('signIn.heading')}</h1>
      {failure ? <Notice>{failure}</Notice> : null}
      <TextField
        {...pinInput}
        label={t('signIn.pin')}
        autoComplete="current-password"
        value={pin}
        onChange={(event) => setPin(event.target.value)}
        error={fieldError}
      />
      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {t('signIn.submit')}
        </Button>
      </div>
    </form>
  );
}
