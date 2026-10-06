import { Logo } from './Logo.js';
import { t } from './messages.js';

// The player view when no scene is live (specs/08-ux-journeys.md §4, §9, §11, Q-025, Q-100, UIX-01): dark,
// the Emberglass wordmark over a slow ember glow and the line "The table is set. Waiting for the Dungeon
// Master.", and no controls. It is also the player view's fallback when it fails, since nobody operates
// the TV.
export function IdleScreen() {
  return (
    <div className="eg-idle">
      <div className="eg-idle__glow" aria-hidden="true" />
      <span className="eg-idle__logo" aria-hidden="true">
        <Logo size={120} />
      </span>
      <div className="eg-idle__text">
        <p className="eg-idle__name">{t('app.name')}</p>
        <p className="eg-idle__line">{t('idle.line')}</p>
      </div>
    </div>
  );
}
