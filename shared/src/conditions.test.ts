import { describe, expect, it } from 'vitest';
import {
  CONDITIONS,
  CONDITION_IDS,
  badgeOrder,
  badgesOf,
  normaliseMarkers,
  repeatsCondition,
  sameMarkers,
  type TokenMarker,
} from './conditions.js';

// The condition list and the marker helpers (TBL-05, Q-103, D-157, specs/03-domain-model.md §1).

const PINNED = ['bloodied', 'unconscious', 'dead', 'concentrating', 'prone', 'poisoned'];
const MORE = [
  'blinded',
  'charmed',
  'deafened',
  'exhaustion',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'restrained',
  'stunned',
];

describe('the condition list (conditions.json)', () => {
  it('has the six pinned conditions in order, then the twelve others alphabetically', () => {
    expect(CONDITIONS.filter((each) => each.pinned).map((each) => each.id)).toEqual(PINNED);
    expect(CONDITIONS.filter((each) => !each.pinned).map((each) => each.id)).toEqual(MORE);
    expect(CONDITION_IDS).toEqual([...PINNED, ...MORE]);
  });

  it('gives every condition a label, rule text and an icon of its own', () => {
    for (const condition of CONDITIONS) {
      expect(condition.label, condition.id).not.toBe('');
      expect(condition.rule.length, condition.id).toBeGreaterThan(0);
      expect(
        condition.rule.every((line) => line.trim() !== ''),
        condition.id,
      ).toBe(true);
      expect(condition.icon.path, condition.id).toMatch(/^M/);
      expect(condition.icon.author, condition.id).not.toBe('');
    }
    expect(new Set(CONDITIONS.map((each) => each.icon.path)).size).toBe(CONDITIONS.length);
    expect(new Set(CONDITIONS.map((each) => each.icon.source)).size).toBe(CONDITIONS.length);
  });

  it('marks the SRD conditions as such, and the three table markers as not', () => {
    expect(CONDITIONS.filter((each) => !each.srd).map((each) => each.id)).toEqual([
      'bloodied',
      'dead',
      'concentrating',
    ]);
  });

  it('names only known conditions as implied, and gives exhaustion six levels', () => {
    for (const condition of CONDITIONS) {
      for (const id of condition.implies) expect(CONDITION_IDS, condition.id).toContain(id);
    }
    expect(CONDITIONS.find((each) => each.id === 'unconscious')!.implies).toEqual(['incapacitated', 'prone']);
    expect(CONDITIONS.find((each) => each.id === 'exhaustion')!.levels).toBe(6);
  });
});

describe('marker helpers', () => {
  it('keeps each condition once, in the order given, and drops what is not a marker', () => {
    expect(
      normaliseMarkers([
        { id: 'prone' },
        'dead',
        { id: 'hasted' },
        { id: 'exhaustion', level: 3 },
        { id: 'prone' },
        { id: 'exhaustion', level: 5 },
        { id: 'blinded', level: 1 },
        { id: 'exhaustion', level: 9 },
        null,
      ]),
    ).toEqual([{ id: 'prone' }, { id: 'exhaustion', level: 3 }]);
  });

  it('finds a condition named twice, Exhaustion at two levels too', () => {
    expect(repeatsCondition([{ id: 'prone' }, { id: 'dead' }])).toBe(false);
    expect(
      repeatsCondition([
        { id: 'exhaustion', level: 1 },
        { id: 'exhaustion', level: 2 },
      ]),
    ).toBe(true);
  });

  it('compares markers by order and level', () => {
    const a: TokenMarker[] = [{ id: 'prone' }, { id: 'exhaustion', level: 2 }];
    expect(sameMarkers(a, [{ id: 'prone' }, { id: 'exhaustion', level: 2 }])).toBe(true);
    expect(sameMarkers(a, [{ id: 'prone' }, { id: 'exhaustion', level: 3 }])).toBe(false);
    expect(sameMarkers(a, [{ id: 'exhaustion', level: 2 }, { id: 'prone' }])).toBe(false);
    expect(sameMarkers(a, [{ id: 'prone' }])).toBe(false);
  });

  it('orders badges Dead, Unconscious, Bloodied, then the rest as applied, three at most and +N', () => {
    const markers: TokenMarker[] = [
      { id: 'poisoned' },
      { id: 'bloodied' },
      { id: 'prone' },
      { id: 'dead' },
      { id: 'blinded' },
    ];
    expect(badgeOrder(markers).map((each) => each.id)).toEqual(['dead', 'bloodied', 'poisoned', 'prone', 'blinded']);
    expect(badgesOf(markers)).toEqual({ shown: [{ id: 'dead' }, { id: 'bloodied' }, { id: 'poisoned' }], more: 2 });
    expect(badgesOf(markers.slice(0, 3))).toEqual({
      shown: [{ id: 'bloodied' }, { id: 'poisoned' }, { id: 'prone' }],
      more: 0,
    });
    expect(badgesOf([])).toEqual({ shown: [], more: 0 });
  });
});
