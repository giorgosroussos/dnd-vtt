import { Type, type Static } from 'typebox';
import { hasMarker, type TokenMarker } from './conditions.js';
import type { AssetCategory } from './entities.js';

// Hit points and armour class (DMT-01; specs/03-domain-model.md §9, specs/04-live-sync.md §15, Q-112, Q-116,
// D-180, D-181, D-182). Every token may carry `hp_current`, `hp_max`, `hp_temp` and `ac`, each a whole number
// or none; an asset may carry a default `hp_max` and `ac`, copied to its new tokens. Only the DM sees them:
// no players' token, snapshot or event carries them (specs/04-live-sync.md §4).
//
// The one game rule in code beside the size table and the ruler (specs/01-product-scope.md §1): while a token
// has both `hp_max` and `hp_current`, every change of its hit points sets Bloodied at or below half its maximum,
// rounded down, and takes it off above; at 0 a monster or npc gains Dead and a player character Unconscious, an
// object neither. Rising above 0 removes neither Dead nor Unconscious (Q-116). The functions below are pure:
// the server applies them inside the transaction that writes the token, and the DM view's test server applies
// the same ones.

/** More than any creature has; a bound so that nothing is unbounded. */
export const HP_BOUNDS = { max: 9999 } as const;
export const AC_BOUNDS = { min: 0, max: 99 } as const;

export const HpMaxSchema = Type.Union([Type.Integer({ minimum: 1, maximum: HP_BOUNDS.max }), Type.Null()]);
export const HpSchema = Type.Union([Type.Integer({ minimum: 0, maximum: HP_BOUNDS.max }), Type.Null()]);
export const AcSchema = Type.Union([Type.Integer({ minimum: AC_BOUNDS.min, maximum: AC_BOUNDS.max }), Type.Null()]);
// A signed amount: negative is damage, positive healing. 0 passes the schema and changes nothing.
export const HpDeltaSchema = Type.Integer({ minimum: -HP_BOUNDS.max, maximum: HP_BOUNDS.max });

/** A token's four fields, each a whole number or none. */
export interface TokenStats {
  hp_current: number | null;
  hp_max: number | null;
  hp_temp: number | null;
  ac: number | null;
}

export const STAT_FIELDS = ['hp_current', 'hp_max', 'hp_temp', 'ac'] as const satisfies readonly (keyof TokenStats)[];
const HP_FIELDS = ['hp_current', 'hp_max', 'hp_temp'] as const;

/** The four fields of anything that carries them, as a fresh object. */
export const statsOf = (token: TokenStats): TokenStats => ({
  hp_current: token.hp_current,
  hp_max: token.hp_max,
  hp_temp: token.hp_temp,
  ac: token.ac,
});

export const sameStats = (a: TokenStats, b: TokenStats): boolean => STAT_FIELDS.every((field) => a[field] === b[field]);

/** Whether the hit points differ: what runs the automation again (armour class alone does not). */
export const hpChanged = (a: TokenStats, b: TokenStats): boolean => HP_FIELDS.some((field) => a[field] !== b[field]);

/** The stats of a token newly placed from an asset: its maximum and armour class, at full hit points (D-181). */
export const statsFromAsset = (asset: { hp_max: number | null; ac: number | null }): TokenStats => ({
  hp_current: asset.hp_max,
  hp_max: asset.hp_max,
  hp_temp: null,
  ac: asset.ac,
});

/**
 * The fields given set over the token's, a field given as null cleared. `hp_current` never exceeds `hp_max`, so a
 * maximum lowered below the current hit points brings them down with it (D-182); temporary hit points of 0 are none.
 */
export function withStats(stats: TokenStats, patch: Partial<TokenStats>): TokenStats {
  const next = { ...statsOf(stats), ...patch };
  if (next.hp_max !== null && next.hp_current !== null && next.hp_current > next.hp_max) next.hp_current = next.hp_max;
  if (next.hp_temp === 0) next.hp_temp = null;
  return next;
}

/**
 * A signed amount applied to the hit points (specs/04-live-sync.md §15). Damage takes the temporary hit points
 * first and the rest from `hp_current`, which stops at 0; healing raises `hp_current`, never above `hp_max`, and
 * never adds temporary hit points (D-181). Undefined when the token has no current hit points to change.
 */
export function applyHp(stats: TokenStats, delta: number): TokenStats | undefined {
  if (stats.hp_current === null) return undefined;
  if (delta > 0) {
    const healed = stats.hp_current + delta;
    return { ...statsOf(stats), hp_current: stats.hp_max === null ? healed : Math.min(stats.hp_max, healed) };
  }
  const damage = -delta;
  const temp = stats.hp_temp ?? 0;
  const absorbed = Math.min(temp, damage);
  return {
    ...statsOf(stats),
    hp_temp: temp - absorbed > 0 ? temp - absorbed : null,
    hp_current: Math.max(0, stats.hp_current - (damage - absorbed)),
  };
}

/** Whether a token at these hit points is bloodied: at or below half its maximum, rounded down. */
export const isBloodied = (hp: { hp_current: number; hp_max: number }): boolean =>
  hp.hp_current <= Math.floor(hp.hp_max / 2);

/** The marker 0 hit points gives a token of this category, if any: Dead or Unconscious, an object nothing. */
export function downMarker(category: AssetCategory): 'dead' | 'unconscious' | undefined {
  if (category === 'pc') return 'unconscious';
  if (category === 'monster' || category === 'npc') return 'dead';
  return undefined;
}

/**
 * The markers after a change of hit points (specs/04-live-sync.md §15, Q-112, Q-116). With no maximum or no
 * current hit points, the markers as they are: the change only stores values. Otherwise Bloodied follows half the
 * maximum, added last or taken off, and 0 adds Dead or Unconscious, last; nothing here ever removes Dead or
 * Unconscious. A marker the DM set by hand is kept until a later change of hit points applies the rule again.
 */
export function markersForHp(
  category: AssetCategory,
  stats: TokenStats,
  markers: readonly TokenMarker[],
): TokenMarker[] {
  const out = [...markers];
  const { hp_current: current, hp_max: max } = stats;
  if (current === null || max === null) return out;
  const bloodied = isBloodied({ hp_current: current, hp_max: max });
  if (bloodied && !hasMarker(out, 'bloodied')) out.push({ id: 'bloodied' });
  if (!bloodied && hasMarker(out, 'bloodied'))
    out.splice(
      out.findIndex((marker) => marker.id === 'bloodied'),
      1,
    );
  const down = current === 0 ? downMarker(category) : undefined;
  if (down !== undefined && !hasMarker(out, down)) out.push({ id: down });
  return out;
}

/**
 * What the DM typed in the popover's hit-point field: `-7` damage, `+5` healing, `12` the current hit points.
 * Undefined for anything else, or an amount of 0.
 */
export type HpEntry = { kind: 'delta'; delta: number } | { kind: 'set'; hp_current: number };
export function parseHpEntry(text: string): HpEntry | undefined {
  const match = /^\s*([+-]|−)?\s*(\d{1,4})\s*$/u.exec(text);
  if (!match) return undefined;
  const amount = Number(match[2]);
  if (match[1] === undefined) return amount <= HP_BOUNDS.max ? { kind: 'set', hp_current: amount } : undefined;
  if (amount === 0) return undefined;
  return { kind: 'delta', delta: match[1] === '+' ? amount : -amount };
}

/** Compact hit points for a list row, `12/27`, or the current alone without a maximum; undefined with none. */
export function compactHp(stats: TokenStats): string | undefined {
  if (stats.hp_current === null) return undefined;
  const temp = stats.hp_temp ? `+${stats.hp_temp}` : '';
  return stats.hp_max === null ? `${stats.hp_current}${temp}` : `${stats.hp_current}${temp}/${stats.hp_max}`;
}

export type HpDelta = Static<typeof HpDeltaSchema>;
