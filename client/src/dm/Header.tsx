import { useEffect, useId, useState, type ReactNode, type Ref } from 'react';
import { API_SCREENS_PATH, type ScreenCount } from '@emberglass/shared';
import { Icon } from '../ui/icons.js';
import { t } from '../ui/messages.js';
import { request } from './api.js';

/** How often the header asks how many player views are connected (UIX-01). */
export const SCREENS_POLL_MS = 3_000;

/**
 * How many player views are connected, read from the server now and every SCREENS_POLL_MS (UIX-01,
 * specs/08-ux-journeys.md §11): undefined until the first answer, and kept while a read fails.
 */
export function useScreenCount(): number | undefined {
  const [count, setCount] = useState<number>();
  useEffect(() => {
    let active = true;
    const read = () =>
      request<ScreenCount>('GET', API_SCREENS_PATH).then(
        (answer) => {
          if (active) setCount(answer.count);
        },
        () => {},
      );
    void read();
    const timer = setInterval(() => void read(), SCREENS_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return count;
}

// The header of the DM workspace (UIX-01, specs/08-ux-journeys.md §1, §11, Q-100): the logo and wordmark,
// the campaign / session breadcrumb that opens the session switcher, the live indicator in the middle
// (LiveBar), the count of connected screens, which opens "Connect a screen", and the settings button.
export function Header({
  breadcrumb,
  switcherOpen,
  onToggleSwitcher,
  switcherRef,
  live,
  screens,
  onConnect,
  connectRef,
  onSettings,
  settingsRef,
}: {
  /** The campaign's name and the session's title, or undefined while no session is chosen. */
  breadcrumb: { campaign: string; session: string } | undefined;
  switcherOpen: boolean;
  onToggleSwitcher: () => void;
  switcherRef?: Ref<HTMLButtonElement>;
  /** The live indicator. */
  live: ReactNode;
  screens: number | undefined;
  onConnect: () => void;
  connectRef?: Ref<HTMLButtonElement>;
  onSettings: () => void;
  settingsRef?: Ref<HTMLButtonElement>;
}) {
  const countId = useId();
  const count = screens ?? 0;
  const screensText = t(count === 1 ? 'header.screens.one' : 'header.screens.other', { count });
  return (
    <header className="eg-header">
      <div className="eg-header__start">
        <span className="eg-header__brand">
          <span className="eg-header__logo">
            <Icon name="logo" size={22} />
          </span>
          <span className="eg-header__wordmark">{t('app.name')}</span>
        </span>
        <span className="eg-header__divider" aria-hidden="true" />
        <button
          ref={switcherRef}
          type="button"
          className="eg-header__crumbs"
          aria-expanded={switcherOpen}
          aria-label={
            breadcrumb
              ? t('header.switcherOf', { campaign: breadcrumb.campaign, session: breadcrumb.session })
              : t('header.switcher')
          }
          onClick={onToggleSwitcher}
        >
          {breadcrumb ? (
            <>
              <span className="eg-header__campaign">{breadcrumb.campaign}</span>
              <span className="eg-header__slash" aria-hidden="true" />
              <span className="eg-header__session">{breadcrumb.session}</span>
            </>
          ) : (
            <span className="eg-header__session">{t('header.chooseSession')}</span>
          )}
          <Icon name="chevron" size={14} strokeWidth={2} />
        </button>
      </div>
      <div className="eg-header__centre">{live}</div>
      <div className="eg-header__end">
        <button
          ref={connectRef}
          type="button"
          className={count === 0 ? 'eg-button eg-screens eg-screens--none' : 'eg-button eg-screens'}
          aria-label={t('connect.open')}
          aria-describedby={countId}
          onClick={onConnect}
        >
          <Icon name="screen" />
          <span id={countId}>{screensText}</span>
          <span className="eg-screens__dot" aria-hidden="true" />
        </button>
        <button
          ref={settingsRef}
          type="button"
          className="eg-icon-button"
          aria-label={t('settings.open')}
          onClick={onSettings}
        >
          <Icon name="settings" size={18} />
        </button>
      </div>
    </header>
  );
}
