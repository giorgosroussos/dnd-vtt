import type { SceneToken } from '@emberglass/shared';
import type { TokenAnchor } from '../../canvas/MapCanvas.js';
import { ConditionIcon, markerName } from '../../ui/conditions.js';
import { Icon } from '../../ui/icons.js';
import { t } from '../../ui/messages.js';
import { PreviewCard } from '../PreviewCard.js';
import { hpFraction } from './TokenStats.js';

// The preview of a token the DM's mouse rests on (UXR-06, specs/08-ux-journeys.md §14): read-only, beside the token
// as its popover would be, with what the DM looks up mid-scene: whether players can see it, its hit points and
// armour class, its conditions and the whole of its notes, or of its asset's when it has none, in a PreviewCard;
// a click on the token opens the popover, where all of this is edited. The DM's view only: nothing here reaches a player view.
export function TokenPreview({ token, anchor }: { token: SceneToken; anchor: TokenAnchor }) {
  const fraction = hpFraction(token);
  const hasHp = token.hp_current !== null || token.hp_max !== null;
  const notes = token.notes.trim()
    ? { text: token.notes, from: undefined }
    : token.asset.notes.trim()
      ? { text: token.asset.notes, from: token.asset.name }
      : undefined;
  return (
    <PreviewCard anchor={anchor} content={token} label={t('preview.of', { label: token.label })} id={token.id}>
      <div className="eg-popover__head">
        <p className="eg-preview__name">{token.label}</p>
        <p className={token.hidden ? 'eg-popover__seen eg-popover__seen--hidden' : 'eg-popover__seen'}>
          <span className="eg-popover__dot" aria-hidden="true" />
          {t(token.hidden ? 'tokens.playersCannotSee' : 'tokens.playersCanSee')}
        </p>
      </div>
      <div className="eg-preview__stats">
        <span className="eg-preview__hp">
          <span className="eg-popover__label">{t('hp.label')}</span>
          <span className="eg-hp__numbers" data-hp>
            {hasHp
              ? t('hp.value', { current: token.hp_current ?? t('hp.unset'), max: token.hp_max ?? t('hp.unset') })
              : t('hp.unset')}
          </span>
          {token.hp_temp ? <span className="eg-hp__temp">{t('hp.temp', { temp: token.hp_temp })}</span> : null}
        </span>
        <span className="eg-preview__ac" title={token.ac === null ? undefined : t('hp.acOf', { ac: token.ac })}>
          <Icon name="shield" size={14} />
          <span className="eg-visually-hidden">{t('hp.acField')}</span>
          <span data-ac>{token.ac ?? t('hp.unset')}</span>
        </span>
      </div>
      {fraction === undefined ? null : (
        <span className="eg-hp__bar" aria-hidden="true">
          <span
            className="eg-hp__fill"
            data-low={fraction <= 0.5 || undefined}
            style={{ width: `${Math.round(fraction * 100)}%` }}
          />
        </span>
      )}
      {token.markers.length > 0 ? (
        <ul className="eg-preview__conditions" aria-label={t('preview.conditions')}>
          {token.markers.map((marker) => (
            <li key={marker.id} className="eg-preview__condition">
              <ConditionIcon id={marker.id} size={12} />
              {markerName(marker)}
            </li>
          ))}
        </ul>
      ) : null}
      {notes ? (
        <div className="eg-preview__notes">
          {notes.from === undefined ? null : (
            <span className="eg-popover__label">{t('notes.fromAsset', { name: notes.from })}</span>
          )}
          <p className="eg-preview__text">{notes.text}</p>
        </div>
      ) : null}
      <p className="eg-popover__note">{t('preview.clickToEdit')}</p>
    </PreviewCard>
  );
}
