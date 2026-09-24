import { t } from './messages.js';

// The player view when no scene is live: dark, the product name only, no
// controls (specs/08-ux-journeys.md §4, §9). It is also the player view's
// fallback when it fails, since nobody operates the TV.
export function IdleScreen() {
  return (
    <div className="eg-idle">
      <p className="eg-idle__name">{t('app.name')}</p>
    </div>
  );
}
