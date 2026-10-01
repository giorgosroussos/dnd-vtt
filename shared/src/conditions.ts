import { Type, type Static } from 'typebox';
import data from './conditions.json' with { type: 'json' };

// The condition markers a token may carry (TBL-05, Q-103, D-157, specs/03-domain-model.md §1). The list is a
// data file, conditions.json: each condition's id, its label, whether its chip is pinned in the popover, its
// icon (a game-icons.net path on a 512-unit square, CC BY 3.0, by the author named), whether its rule text is
// the SRD 5.1's (CC BY 4.0) and the conditions it implies, named in the hover text and never applied. Pinned
// conditions come first in the popover's order, then the rest alphabetically. Rule text is read, never applied:
// the MVP has no game rules in code (specs/01-product-scope.md §7).

export interface ConditionIcon {
  /** Where it comes from in game-icons.net, `<author folder>/<name>`. */
  source: string;
  author: string;
  /** One SVG path on a 512-unit square, filled. */
  path: string;
}

export interface Condition {
  id: string;
  label: string;
  pinned: boolean;
  icon: ConditionIcon;
  /** Whether `rule` is the SRD 5.1's text; Bloodied, Dead and Concentrating are table markers. */
  srd: boolean;
  /** Its rule text, a paragraph or a bullet per line. */
  rule: string[];
  /** The ids of the conditions it implies, mentioned and never applied. */
  implies: string[];
  /** Exhaustion only: how many levels it has. */
  levels?: number;
}

export const CONDITIONS: readonly Condition[] = data.conditions;
export const CONDITION_IDS: readonly string[] = CONDITIONS.map((condition) => condition.id);
export const EXHAUSTION = 'exhaustion';
export const EXHAUSTION_LEVELS = { min: 1, max: 6 } as const;
export const MAX_MARKERS = CONDITIONS.length;

const byId = new Map(CONDITIONS.map((condition) => [condition.id, condition]));
/** The condition of an id, if it is one. */
export const conditionOf = (id: string): Condition | undefined => byId.get(id);

const strict = { additionalProperties: false } as const;

// A marker names its condition; Exhaustion also carries its level, and no other condition carries one. A later
// DM-defined marker would be `custom:<uuid>`, which only this schema would have to admit (D-157).
export const MarkerSchema = Type.Union([
  Type.Object({ id: Type.Enum(CONDITION_IDS.filter((id) => id !== EXHAUSTION)) }, strict),
  Type.Object(
    {
      id: Type.Literal(EXHAUSTION),
      level: Type.Integer({ minimum: EXHAUSTION_LEVELS.min, maximum: EXHAUSTION_LEVELS.max }),
    },
    strict,
  ),
]);
// Each condition at most once, in the order the DM applied them (the badges' order after the first three).
export const MarkersSchema = Type.Array(MarkerSchema, { uniqueItems: true, maxItems: MAX_MARKERS });

export type TokenMarker = Static<typeof MarkerSchema>;

const isMarker = (value: unknown): value is TokenMarker => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { id, level, ...rest } = value as { id?: unknown; level?: unknown };
  if (Object.keys(rest).length > 0 || typeof id !== 'string' || !byId.has(id)) return false;
  if (id !== EXHAUSTION) return level === undefined;
  return (
    typeof level === 'number' &&
    Number.isInteger(level) &&
    level >= EXHAUSTION_LEVELS.min &&
    level <= EXHAUSTION_LEVELS.max
  );
};

/**
 * The markers given, each condition once (its first), in the order given, as fresh objects; anything that is
 * not a marker is dropped.
 */
export function normaliseMarkers(markers: readonly unknown[]): TokenMarker[] {
  const seen = new Set<string>();
  const out: TokenMarker[] = [];
  for (const marker of markers) {
    if (!isMarker(marker) || seen.has(marker.id)) continue;
    seen.add(marker.id);
    const level = markerLevel(marker);
    out.push(level === undefined ? { id: marker.id } : { id: EXHAUSTION, level });
  }
  return out;
}

/**
 * Whether a set names a condition twice. The schema's `uniqueItems` compares whole objects, so two Exhaustion
 * markers at different levels pass it; the server refuses them with this, as it does an exact duplicate
 * (TBL-05 review).
 */
export const repeatsCondition = (markers: readonly TokenMarker[]): boolean =>
  new Set(markers.map((marker) => marker.id)).size !== markers.length;

/** Whether two sets of markers are the same, order and levels included. */
export const sameMarkers = (a: readonly TokenMarker[], b: readonly TokenMarker[]): boolean =>
  a.length === b.length &&
  a.every((marker, index) => marker.id === b[index]!.id && markerLevel(marker) === markerLevel(b[index]!));

/** Exhaustion's level, or undefined for any other marker. */
export const markerLevel = (marker: TokenMarker): number | undefined => ('level' in marker ? marker.level : undefined);

/** Whether a token's markers include a condition. */
export const hasMarker = (markers: readonly TokenMarker[], id: string): boolean =>
  markers.some((marker) => marker.id === id);

/** The markers in badge order: Dead, Unconscious, Bloodied, then the rest in the order applied (D-157). */
const FIRST = ['dead', 'unconscious', 'bloodied'];
export function badgeOrder(markers: readonly TokenMarker[]): TokenMarker[] {
  const first = FIRST.flatMap((id) => markers.filter((marker) => marker.id === id));
  return [...first, ...markers.filter((marker) => !FIRST.includes(marker.id))];
}

/** The badges a token shows: at most three markers, then how many more there are (the "+N" badge). */
export const MAX_BADGES = 3;
export function badgesOf(markers: readonly TokenMarker[]): { shown: TokenMarker[]; more: number } {
  const ordered = badgeOrder(markers);
  return ordered.length <= MAX_BADGES
    ? { shown: ordered, more: 0 }
    : { shown: ordered.slice(0, MAX_BADGES), more: ordered.length - MAX_BADGES };
}
