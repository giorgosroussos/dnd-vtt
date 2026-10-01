import { useState, type FormEvent } from 'react';
import { API_PATHS, PIN_PATTERN } from '@emberglass/shared';
import { Button } from '../ui/Button.js';
import { Notice } from '../ui/Notice.js';
import { TextField } from '../ui/TextField.js';
import { errorMessage } from '../ui/errorMessage.js';
import { t } from '../ui/messages.js';
import { ApiError, errorCode, request, type ClientErrorCode } from './api.js';

// First-run setup and PIN entry (specs/07-security-and-access.md §1, §2, §6,
// D-076, D-085). The PIN lives only in the form's state until it is sent; it is
// never stored, and the session it buys is the HttpOnly cookie the server sets.

const PIN = new RegExp(PIN_PATTERN);

const MINUTES_FROM_S = 120;
const HOURS_FROM_S = 2 * 60 * 60;

/**
 * A wait as a phrase: seconds below two minutes, minutes up to two hours (REL-01 review U-L6), and whole
 * hours past two hours, where a doubled wait would read as hundreds of minutes (G-042); each rounded up,
 * so that the screen never says to try again before the server allows it.
 */
export function waitText(seconds: number): string {
  if (seconds > HOURS_FROM_S) return t('wait.hours', { count: Math.ceil(seconds / 3600) });
  if (seconds >= MINUTES_FROM_S) return t('wait.minutes', { count: Math.ceil(seconds / 60) });
  return seconds === 1 ? t('wait.second') : t('wait.seconds', { count: seconds });
}

/** How long PIN entry is refused from this address. */
export function lockedOutText(seconds: number): string {
  return t('signIn.lockedOut', { wait: waitText(seconds) });
}

/**
 * The DM view on the server PC, where PIN entry is never paused: by `localhost`, since the pause spares
 * the loopback address and not the PC's LAN address (specs/07-security-and-access.md §6, README).
 */
export function serverPcAddress(location: Pick<Location, 'port'> = window.location): string {
  return `http://localhost${location.port ? `:${location.port}` : ''}/dm`;
}

/**
 * What a refused PIN entry or PIN change says: a lockout with its wait, or the server-wide pause with the
 * wait and the server PC's address, last so that it is copied without punctuation, which other devices'
 * guesses may have caused (G-042); otherwise the code's own message. The PIN change says it shorter, since
 * the Settings dialog must fit a laptop's window with it (review U-M1).
 */
export function pinRefusalText(
  code: ClientErrorCode,
  wait: number | undefined,
  where: 'signIn' | 'pinChange' = 'signIn',
): string {
  if (wait !== undefined && code === 'locked_out') return lockedOutText(wait);
  if (wait !== undefined && code === 'pin_paused') {
    const params = { address: serverPcAddress(), wait: waitText(wait) };
    return t(where === 'signIn' ? 'signIn.paused' : 'settings.pinPaused', params);
  }
  return errorMessage(code);
}

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

export function PinEntry({ onDone, notice }: { onDone: () => void; notice?: string | undefined }) {
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
      setFailure(pinRefusalText(code, wait));
    }
  }

  return (
    <form className="eg-signin" onSubmit={(event) => void submit(event)} noValidate>
      <h1 className="eg-dm__heading">{t('signIn.heading')}</h1>
      {notice && !failure ? <Notice>{notice}</Notice> : null}
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
