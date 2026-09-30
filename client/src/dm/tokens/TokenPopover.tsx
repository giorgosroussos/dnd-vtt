import type { SceneToken } from '@emberglass/shared';
import type { TokenAnchor } from '../../canvas/MapCanvas.js';
import { Icon } from '../../ui/icons.js';
import { Menu } from '../../ui/Menu.js';
import { t } from '../../ui/messages.js';

const WIDTH = 236;
const GAP = 14;

/** Beside the token, on its right when there is room and on its left otherwise, kept inside the canvas. */
function placement(anchor: TokenAnchor): { left: number; top: number; side: 'left' | 'right' } {
  const right = anchor.left + anchor.side + GAP;
  const fitsRight = right + WIDTH <= anchor.viewport.width - 8;
  const left = fitsRight ? right : Math.max(8, anchor.left - GAP - WIDTH);
  const top = Math.min(Math.max(8, anchor.top + anchor.side / 2 - 70), Math.max(8, anchor.viewport.height - 200));
  return { left, top, side: fitsRight ? 'right' : 'left' };
}

// The selected token's popover (UIX-01, specs/08-ux-journeys.md §11, specs/04-live-sync.md §2): its name,
// whether players can see it, Hide or Reveal (H), Rename, and a menu with Delete, Duplicate and the
// stacking order. On the live scene Rename and the stacking order stay in the list but refuse, saying why:
// they are edited only on scenes that are not live (Q-014), and the brief keeps them prep-only (D-139). It
// takes no focus when it appears, so the arrow keys keep moving the token on the map; Tab reaches it.
export function TokenPopover({
  token,
  anchor,
  live,
  onToggleHidden,
  onRename,
  onDuplicate,
  onStack,
  onDelete,
}: {
  token: SceneToken;
  anchor: TokenAnchor;
  live: boolean;
  onToggleHidden: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onStack: (stack: 'front' | 'back') => void;
  onDelete: () => void;
}) {
  const { left, top, side } = placement(anchor);
  const prepOnly = live ? t('tokens.prepOnly') : undefined;
  return (
    <section
      className={`eg-popover eg-popover--${side}`}
      style={{ left, top, width: WIDTH }}
      aria-label={t('tokens.popoverOf', { label: token.label })}
    >
      <div className="eg-popover__head">
        <h2 className="eg-popover__name">{token.label}</h2>
        <p className={token.hidden ? 'eg-popover__seen eg-popover__seen--hidden' : 'eg-popover__seen'}>
          <span className="eg-popover__dot" aria-hidden="true" />
          {t(token.hidden ? 'tokens.playersCannotSee' : 'tokens.playersCanSee')}
        </p>
      </div>
      <div className="eg-popover__actions">
        <button
          type="button"
          className="eg-button eg-popover__main"
          aria-label={t(token.hidden ? 'tokens.revealOf' : 'tokens.hideOf', { label: token.label })}
          aria-keyshortcuts="H"
          onClick={onToggleHidden}
        >
          <Icon name={token.hidden ? 'eye' : 'eyeOff'} size={15} />
          {t(token.hidden ? 'tokens.reveal' : 'tokens.hide')}
          <kbd>{t('shortcuts.keyH')}</kbd>
        </button>
        <button
          type="button"
          className="eg-button"
          aria-label={t('tokens.renameOf', { label: token.label })}
          aria-disabled={live || undefined}
          title={prepOnly}
          onClick={() => {
            if (!live) onRename();
          }}
        >
          {t('tokens.rename')}
        </button>
        <Menu
          label={t('tokens.moreOf', { label: token.label })}
          icon={<Icon name="more" />}
          className="eg-icon-button eg-icon-button--bordered"
          items={[
            { label: t('tokens.duplicate'), onSelect: onDuplicate },
            { label: t('tokens.front'), disabledReason: prepOnly, onSelect: () => onStack('front') },
            { label: t('tokens.back'), disabledReason: prepOnly, onSelect: () => onStack('back') },
            { label: t('tokens.delete'), danger: true, onSelect: onDelete },
          ]}
        />
      </div>
      {live ? <p className="eg-popover__note">{t('tokens.prepOnlyNote')}</p> : null}
    </section>
  );
}
