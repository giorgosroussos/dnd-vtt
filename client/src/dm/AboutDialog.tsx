import { CONDITIONS } from '@emberglass/shared';
import { Dialog } from '../ui/Dialog.js';
import { t } from '../ui/messages.js';
import { VERSION } from '../version.js';

// About & credits (TBL-05, Q-103, D-157), from the header's info button: the licence of Emberglass, and the
// attribution the bundled condition icons (game-icons.net, CC BY 3.0) and the conditions' rule text
// (SRD 5.1, CC BY 4.0) require. The icons' authors are read from the condition list, so a new icon credits
// its author without a change here. Nothing here links outside the LAN (specs/02-architecture.md §6). The
// version is this build's (PKG-01, D-167).
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const authors = [...new Set(CONDITIONS.map((condition) => condition.icon.author))].sort().join(', ');
  return (
    <Dialog heading={t('about.title')} onClose={onClose} className="eg-about">
      <p className="eg-about__version">{t('about.version', { version: VERSION })}</p>
      <p>{t('about.licence')}</p>
      <h3 className="eg-about__heading">{t('about.iconsTitle')}</h3>
      <p>{t('about.icons', { authors })}</p>
      <h3 className="eg-about__heading">{t('about.srdTitle')}</h3>
      <p>{t('about.srd')}</p>
      <div className="eg-dialog__actions">
        <button type="button" className="eg-button" onClick={onClose}>
          {t('about.close')}
        </button>
      </div>
    </Dialog>
  );
}
