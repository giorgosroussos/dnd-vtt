import { describe, expect, it } from 'vitest';
import {
  applyHp,
  compactHp,
  isBloodied,
  markersForHp,
  parseHpEntry,
  statsFromAsset,
  withStats,
  type TokenMarker,
  type TokenStats,
} from './index.js';

// The hit-point rules (DMT-01, specs/04-live-sync.md §15, Q-112, Q-116, D-181, D-182), pure: the server and the DM
// view's test server apply these.

const stats = (fields: Partial<TokenStats> = {}): TokenStats => ({
  hp_current: 20,
  hp_max: 20,
  hp_temp: null,
  ac: null,
  ...fields,
});
const ids = (markers: readonly TokenMarker[]) => markers.map((marker) => marker.id);

describe('applyHp (specs/04-live-sync.md §15)', () => {
  it('takes damage from the temporary hit points first, then the current ones', () => {
    expect(applyHp(stats({ hp_temp: 5 }), -3)).toMatchObject({ hp_temp: 2, hp_current: 20 });
    expect(applyHp(stats({ hp_temp: 5 }), -5)).toMatchObject({ hp_temp: null, hp_current: 20 });
    expect(applyHp(stats({ hp_temp: 5 }), -8)).toMatchObject({ hp_temp: null, hp_current: 17 });
  });

  it('stops the current hit points at 0', () => {
    expect(applyHp(stats({ hp_current: 4 }), -30)).toMatchObject({ hp_current: 0 });
    expect(applyHp(stats({ hp_current: 4, hp_temp: 3 }), -30)).toMatchObject({ hp_current: 0, hp_temp: null });
  });

  it('heals up to the maximum, never adding temporary hit points', () => {
    expect(applyHp(stats({ hp_current: 12 }), 5)).toMatchObject({ hp_current: 17 });
    expect(applyHp(stats({ hp_current: 12 }), 50)).toMatchObject({ hp_current: 20, hp_temp: null });
    expect(applyHp(stats({ hp_current: 12, hp_temp: 4 }), 3)).toMatchObject({ hp_current: 15, hp_temp: 4 });
    // Without a maximum, nothing caps it.
    expect(applyHp(stats({ hp_current: 12, hp_max: null }), 50)).toMatchObject({ hp_current: 62 });
  });

  it('has nothing to change on a token without current hit points', () => {
    expect(applyHp(stats({ hp_current: null }), -3)).toBeUndefined();
  });
});

describe('withStats', () => {
  it('sets and clears fields, keeps the current hit points within the maximum, and counts 0 temporary as none', () => {
    expect(withStats(stats(), { ac: 15 })).toEqual(stats({ ac: 15 }));
    expect(withStats(stats({ ac: 15 }), { ac: null })).toEqual(stats());
    expect(withStats(stats({ hp_current: 20 }), { hp_max: 12 })).toMatchObject({ hp_current: 12, hp_max: 12 });
    expect(withStats(stats(), { hp_current: 30 })).toMatchObject({ hp_current: 20 });
    expect(withStats(stats({ hp_temp: 4 }), { hp_temp: 0 })).toMatchObject({ hp_temp: null });
  });

  it('copies an asset’s defaults to a new token at full hit points (D-181)', () => {
    expect(statsFromAsset({ hp_max: 27, ac: 13 })).toEqual({ hp_current: 27, hp_max: 27, hp_temp: null, ac: 13 });
    expect(statsFromAsset({ hp_max: null, ac: null })).toEqual({
      hp_current: null,
      hp_max: null,
      hp_temp: null,
      ac: null,
    });
  });
});

describe('markersForHp (specs/04-live-sync.md §15, Q-112, Q-116)', () => {
  it('sets Bloodied at or below half the maximum, rounded down, for odd and even maxima', () => {
    // Even: 20 → 10 is half.
    expect(isBloodied({ hp_current: 10, hp_max: 20 })).toBe(true);
    expect(isBloodied({ hp_current: 11, hp_max: 20 })).toBe(false);
    // Odd: 27 → 13 is half rounded down.
    expect(isBloodied({ hp_current: 13, hp_max: 27 })).toBe(true);
    expect(isBloodied({ hp_current: 14, hp_max: 27 })).toBe(false);
    expect(isBloodied({ hp_current: 0, hp_max: 1 })).toBe(true);
    expect(isBloodied({ hp_current: 1, hp_max: 1 })).toBe(false);
    expect(ids(markersForHp('monster', stats({ hp_current: 13, hp_max: 27 }), []))).toEqual(['bloodied']);
    expect(ids(markersForHp('monster', stats({ hp_current: 14, hp_max: 27 }), [{ id: 'bloodied' }]))).toEqual([]);
  });

  it('makes a monster or npc Dead and a player character Unconscious at 0, an object neither; Bloodied stays', () => {
    expect(ids(markersForHp('monster', stats({ hp_current: 0 }), []))).toEqual(['bloodied', 'dead']);
    expect(ids(markersForHp('npc', stats({ hp_current: 0 }), []))).toEqual(['bloodied', 'dead']);
    expect(ids(markersForHp('pc', stats({ hp_current: 0 }), []))).toEqual(['bloodied', 'unconscious']);
    expect(ids(markersForHp('object', stats({ hp_current: 0 }), []))).toEqual(['bloodied']);
  });

  it('never removes Dead or Unconscious when the hit points rise again (Q-116)', () => {
    const down: TokenMarker[] = [{ id: 'bloodied' }, { id: 'unconscious' }];
    expect(ids(markersForHp('pc', stats({ hp_current: 5 }), down))).toEqual(['bloodied', 'unconscious']);
    expect(ids(markersForHp('pc', stats({ hp_current: 15 }), down))).toEqual(['unconscious']);
    expect(ids(markersForHp('monster', stats({ hp_current: 15 }), [{ id: 'dead' }]))).toEqual(['dead']);
  });

  it('keeps the other markers in their order, and adds the new ones last', () => {
    const markers: TokenMarker[] = [{ id: 'prone' }, { id: 'exhaustion', level: 2 }];
    expect(markersForHp('monster', stats({ hp_current: 3 }), markers)).toEqual([...markers, { id: 'bloodied' }]);
  });

  it('changes nothing without a maximum or without current hit points', () => {
    const markers: TokenMarker[] = [{ id: 'bloodied' }];
    expect(markersForHp('monster', stats({ hp_current: 0, hp_max: null }), [])).toEqual([]);
    expect(markersForHp('monster', stats({ hp_current: 20, hp_max: null }), markers)).toEqual(markers);
    expect(markersForHp('monster', stats({ hp_current: null }), markers)).toEqual(markers);
  });
});

describe('parseHpEntry and compactHp (specs/08-ux-journeys.md §13)', () => {
  it('reads -7 as damage, +5 as healing and a bare number as the current hit points', () => {
    expect(parseHpEntry('-7')).toEqual({ kind: 'delta', delta: -7 });
    expect(parseHpEntry(' −7 ')).toEqual({ kind: 'delta', delta: -7 });
    expect(parseHpEntry('+5')).toEqual({ kind: 'delta', delta: 5 });
    expect(parseHpEntry('12')).toEqual({ kind: 'set', hp_current: 12 });
    expect(parseHpEntry('0')).toEqual({ kind: 'set', hp_current: 0 });
    for (const bad of ['', '-', '+0', '-0', '1.5', 'ten', '--3', '12345', '5 5']) {
      expect(parseHpEntry(bad), bad).toBeUndefined();
    }
  });

  it('writes 12/27, with temporary hit points and without a maximum, and nothing without hit points', () => {
    expect(compactHp(stats({ hp_current: 12, hp_max: 27 }))).toBe('12/27');
    expect(compactHp(stats({ hp_current: 12, hp_max: 27, hp_temp: 5 }))).toBe('12+5/27');
    expect(compactHp(stats({ hp_current: 12, hp_max: null }))).toBe('12');
    expect(compactHp(stats({ hp_current: null }))).toBeUndefined();
  });
});
