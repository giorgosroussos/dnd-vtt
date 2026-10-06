import { compactHp, type TokenStats as Stats } from '@emberglass/shared';
import { Icon } from '../../ui/icons.js';
import { t } from '../../ui/messages.js';

// A token's hit points and armour class in a list row, compact (DMT-01, specs/08-ux-journeys.md §13): `12/27` and a
// shield with the armour class, each only when the token has it, nothing at all when it has neither. The DM's
// view only: no player view draws these.
export function TokenStatsBadge({ stats }: { stats: Stats }) {
  const hp = compactHp(stats);
  if (hp === undefined && stats.ac === null) return null;
  return (
    <span className="eg-stats">
      {hp === undefined ? null : (
        <span className="eg-stats__hp" title={t('hp.compact', { hp })}>
          <span className="eg-visually-hidden">{t('hp.compact', { hp })}</span>
          <span aria-hidden="true">{hp}</span>
        </span>
      )}
      {stats.ac === null ? null : (
        <span className="eg-stats__ac" title={t('hp.acOf', { ac: stats.ac })}>
          <Icon name="shield" size={12} />
          <span className="eg-visually-hidden">{t('hp.compactAc', { ac: stats.ac })}</span>
          <span aria-hidden="true">{stats.ac}</span>
        </span>
      )}
    </span>
  );
}

/** How full the hit points are, 0 to 1, or undefined without both current and maximum. */
export function hpFraction(stats: Stats): number | undefined {
  if (stats.hp_current === null || stats.hp_max === null) return undefined;
  return Math.max(0, Math.min(1, stats.hp_current / stats.hp_max));
}
