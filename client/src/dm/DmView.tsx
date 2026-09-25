import { useCallback, useEffect, useState } from 'react';
import { API_PATHS, type AuthState, type SetupState } from '@emberglass/shared';
import { Button } from '../ui/Button.js';
import { Notice } from '../ui/Notice.js';
import { SkipLink } from '../ui/SkipLink.js';
import { errorMessage } from '../ui/errorMessage.js';
import { t } from '../ui/messages.js';
import { errorCode, request, setUnauthorizedHandler, type ClientErrorCode } from './api.js';
import { PinEntry, SetupElsewhere, SetupScreen } from './SignIn.js';
import { Workspace } from './Workspace.js';
import './dm.css';

export const MAIN_ID = 'main';

type Screen =
  | { kind: 'loading' }
  | { kind: 'failed'; code: ClientErrorCode }
  | { kind: 'setup' }
  | { kind: 'setupElsewhere' }
  // `ended`: the server ended this browser's session while it was open (a restart, a PIN change
  // or a sign-out elsewhere), so the form says why it is back (LIV-01 review, D-106).
  | { kind: 'signIn'; ended?: boolean }
  | { kind: 'workspace' };

// The DM view at /dm (specs/08-ux-journeys.md §1, specs/07-security-and-access.md
// §1, §2, D-085). It asks the server whether a PIN exists, whether this browser is
// on the server PC and whether it holds a DM session, and shows the one screen
// that follows: setup, setup elsewhere, PIN entry or the workspace. The server
// decides every one of these; the view only reflects its answers.
async function screenFromServer(): Promise<Screen> {
  const [setup, auth] = await Promise.all([
    request<SetupState>('GET', API_PATHS.setup),
    request<AuthState>('GET', API_PATHS.auth),
  ]);
  if (auth.dm) return { kind: 'workspace' };
  if (setup.pin_set) return { kind: 'signIn' };
  return { kind: setup.local ? 'setup' : 'setupElsewhere' };
}

export function DmView() {
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [signOutFailure, setSignOutFailure] = useState<string>();

  const load = useCallback(() => {
    screenFromServer().then(setScreen, (error: unknown) => setScreen({ kind: 'failed', code: errorCode(error) }));
  }, []);

  useEffect(() => {
    load();
    // A session the server no longer knows sends the DM back to the PIN form.
    setUnauthorizedHandler(() => setScreen({ kind: 'signIn', ended: true }));
    return () => setUnauthorizedHandler(undefined);
  }, [load]);

  const retry = () => {
    setScreen({ kind: 'loading' });
    load();
  };

  const signedIn = () => setScreen({ kind: 'workspace' });
  const signedOutElsewhere = useCallback(() => setScreen({ kind: 'signIn', ended: true }), []);

  // The control that had focus went away with the workspace: put focus where the form starts,
  // so the keyboard and assistive technology are not left on the page body.
  const ended = screen.kind === 'signIn' && screen.ended === true;
  useEffect(() => {
    if (ended) document.getElementById(MAIN_ID)?.focus();
  }, [ended]);

  // Only once the server has ended the session: a sign-out that failed must not
  // look like one on a shared laptop, whose session would still be valid.
  async function signOut() {
    setSignOutFailure(undefined);
    try {
      await request('DELETE', API_PATHS.auth);
      setScreen({ kind: 'signIn' });
    } catch (error) {
      if (errorCode(error) === 'unauthorized') return;
      setSignOutFailure(t('dm.signOutFailed', { reason: errorMessage(errorCode(error)) }));
    }
  }

  return (
    <div className="eg-dm">
      <SkipLink targetId={MAIN_ID} label={t('dm.skipToMain')} />
      <header className="eg-dm__banner">
        <span className="eg-dm__product">{t('app.name')}</span>
        <span className="eg-dm__role">{t('dm.role')}</span>
        {screen.kind === 'workspace' ? (
          <span className="eg-dm__actions">
            <Button onClick={() => void signOut()}>{t('dm.signOut')}</Button>
          </span>
        ) : null}
      </header>
      {screen.kind === 'workspace' && signOutFailure ? <Notice>{signOutFailure}</Notice> : null}
      {screen.kind === 'workspace' ? (
        <Workspace mainId={MAIN_ID} onSignedOut={signedOutElsewhere} />
      ) : (
        <main id={MAIN_ID} tabIndex={-1} className="eg-dm__main" data-view="dm">
          {screen.kind === 'loading' ? <p className="eg-dm__status">{t('dm.loading')}</p> : null}
          {screen.kind === 'failed' ? (
            <>
              <Notice>
                <p>{t('dm.loadFailed')}</p>
                <p>{errorMessage(screen.code)}</p>
              </Notice>
              <div>
                <Button variant="primary" onClick={retry}>
                  {t('dm.retry')}
                </Button>
              </div>
            </>
          ) : null}
          {screen.kind === 'setup' ? <SetupScreen onDone={signedIn} onPinAlreadySet={retry} /> : null}
          {screen.kind === 'setupElsewhere' ? <SetupElsewhere /> : null}
          {screen.kind === 'signIn' ? (
            <PinEntry onDone={signedIn} notice={screen.ended ? t('signIn.sessionEnded') : undefined} />
          ) : null}
        </main>
      )}
    </div>
  );
}
