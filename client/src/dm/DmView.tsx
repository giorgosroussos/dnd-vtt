import { SkipLink } from '../ui/SkipLink.js';
import { t } from '../ui/messages.js';

const MAIN_ID = 'main';

// DM view shell at /dm (FND-04). The workspace itself, sidebar, canvas, library
// and live bar, arrives with PRP-01 (specs/08-ux-journeys.md §1).
export function DmView() {
  const appName = t('app.name');
  return (
    <div className="eg-dm">
      <SkipLink targetId={MAIN_ID} label={t('dm.skipToMain')} />
      <header className="eg-dm__banner">
        <span className="eg-dm__product">{appName}</span>
        <span className="eg-dm__role">{t('dm.role')}</span>
      </header>
      <main id={MAIN_ID} tabIndex={-1} className="eg-dm__main" data-view="dm">
        <h1 className="eg-dm__heading">{t('dm.heading', { appName })}</h1>
        <p className="eg-dm__status">{t('dm.status')}</p>
      </main>
    </div>
  );
}
