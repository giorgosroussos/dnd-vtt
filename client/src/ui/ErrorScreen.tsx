import { Button } from './Button.js';
import { Notice } from './Notice.js';
import { t } from './messages.js';

// The DM view's fallback when it fails: what happened, and one way out.
export function DmErrorScreen({ reload = () => window.location.reload() }: { reload?: () => void }) {
  return (
    <main className="eg-dm__main" data-view="dm-error">
      <Notice>
        <h1 className="eg-dm__heading">{t('error.heading')}</h1>
        <p>{t('error.body')}</p>
      </Notice>
      <div>
        <Button variant="primary" onClick={reload}>
          {t('error.reload')}
        </Button>
      </div>
    </main>
  );
}
