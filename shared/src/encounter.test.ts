import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import {
  firstTurn,
  membersOf,
  missingTokens,
  nextIndex,
  playerEncounter,
  PlayerEncounterSchema,
  sortByInitiative,
  startTokens,
  stepTurn,
  turnView,
  type Encounter,
  type EncounterEntry,
  type EncounterToken,
} from './encounter.js';
import type { FogMask } from './fog.js';

// The initiative tracker's turn rules (TBL-06, specs/04-live-sync.md §14, Q-104, Q-106, D-160).

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function token(n: number, category: EncounterToken['asset']['category'], fields: Partial<EncounterToken> = {}) {
  return {
    id: uuid(n),
    x: n * 2,
    y: 0,
    hidden: false,
    z_order: n,
    markers: [],
    asset: { size: 'medium', category },
    ...fields,
  } as EncounterToken;
}
const pc = (n: number, initiative: number | null = null): EncounterEntry => ({
  id: uuid(100 + n),
  kind: 'pc',
  token_id: uuid(n),
  initiative,
});
const dm = (initiative: number | null = null): EncounterEntry => ({ id: uuid(199), kind: 'dm', initiative });

function encounter(entries: EncounterEntry[], fields: Partial<Encounter> = {}): Encounter {
  return {
    id: uuid(900),
    scene_id: uuid(901),
    active: true,
    round: 1,
    current_index: 0,
    enemies_seen: false,
    entries,
    ...fields,
  };
}

const NO_FOG: FogMask = [];
const ids = (entries: readonly EncounterEntry[]) => entries.map((entry) => entry.id);

describe('sortByInitiative', () => {
  it('puts numbered entries first, highest first, and keeps the unnumbered in their order below them', () => {
    const entries = [pc(1), pc(2, 12), dm(), pc(3, 18), pc(4)];
    expect(ids(sortByInitiative(entries))).toEqual(ids([pc(3, 18), pc(2, 12), pc(1), dm(), pc(4)]));
  });

  it('keeps a dragged tie order when another number is set', () => {
    // Two entries tied on 15: the DM dragged pc 2 above pc 1; setting pc 3's number keeps that order.
    const dragged = [pc(2, 15), pc(1, 15), pc(3, 9)];
    const resorted = sortByInitiative(
      dragged.map((entry) => (entry.id === pc(3).id ? { ...entry, initiative: 20 } : entry)),
    );
    expect(ids(resorted)).toEqual(ids([pc(3), pc(2), pc(1)]));
  });

  it('undoes a drag that broke the numbered order once a number is edited again', () => {
    // Dragged: the 5 above the 17. Editing any number sorts again, highest first.
    const dragged = [pc(1, 5), pc(2, 17), dm()];
    expect(ids(sortByInitiative(dragged))).toEqual(ids([pc(2), pc(1), dm()]));
  });
});

describe('stepTurn', () => {
  const tokens = [token(1, 'pc'), token(2, 'pc'), token(3, 'monster')];
  const view = turnView(tokens, NO_FOG);

  it('passes the turn in order and counts a round past the last entry', () => {
    const state = encounter([pc(1), pc(2), dm()], { current_index: 2 });
    expect(stepTurn({ ...state, current_index: 0 }, view, 1)).toEqual({ current_index: 1, round: 1 });
    expect(stepTurn(state, view, 1)).toEqual({ current_index: 0, round: 2 });
  });

  it('goes back a round before the first entry, and does nothing on round 1’s first turn', () => {
    const state = encounter([pc(1), pc(2), dm()], { round: 3 });
    expect(stepTurn(state, view, -1)).toEqual({ current_index: 2, round: 2 });
    expect(stepTurn({ ...state, round: 1 }, view, -1)).toBeUndefined();
  });

  it('passes over an Enemies entry without members while the encounter never had one', () => {
    const noEnemies = turnView([token(1, 'pc'), token(2, 'pc')], NO_FOG);
    const state = encounter([pc(1), dm(), pc(2)], { current_index: 0 });
    expect(stepTurn(state, noEnemies, 1)).toEqual({ current_index: 2, round: 1 });
    expect(nextIndex(state, noEnemies)).toBe(2);
  });

  it('stops on an Enemies entry without members once the encounter had one, so the DM is asked (Q-106)', () => {
    const noEnemies = turnView([token(1, 'pc'), token(2, 'pc')], NO_FOG);
    const state = encounter([pc(1), dm(), pc(2)], { current_index: 0, enemies_seen: true });
    expect(stepTurn(state, noEnemies, 1)).toEqual({ current_index: 1, round: 1 });
  });

  it('does not pass over an Unconscious or a Dead player character', () => {
    const down = [
      token(1, 'pc'),
      token(2, 'pc', { markers: [{ id: 'unconscious' }] }),
      token(4, 'pc', { markers: [{ id: 'dead' }] }),
    ];
    const state = encounter([pc(1), pc(2), pc(4)]);
    const downView = turnView(down, NO_FOG);
    expect(stepTurn(state, downView, 1)).toEqual({ current_index: 1, round: 1 });
    expect(stepTurn({ ...state, current_index: 1 }, downView, 1)).toEqual({ current_index: 2, round: 1 });
  });

  it('passes over a player character players cannot see, hidden or in the fog', () => {
    // Token 4 stands at x 8: its centre (8.5, 0.5) is cell (34, 2) of a quarter square.
    const fog: FogMask = [{ y: 2, runs: [30, 40] }];
    const tokens = [token(1, 'pc'), token(2, 'pc', { hidden: true }), token(4, 'pc')];
    const state = encounter([pc(1), pc(2), pc(4)]);
    expect(stepTurn(state, turnView(tokens, NO_FOG), 1)).toEqual({ current_index: 2, round: 1 });
    expect(stepTurn(state, turnView(tokens, fog), 1)).toEqual({ current_index: 0, round: 2 });
  });

  it('does nothing when no entry takes its turn', () => {
    const state = encounter([dm()]);
    expect(stepTurn(state, turnView([], NO_FOG), 1)).toBeUndefined();
    expect(firstTurn(state, turnView([], NO_FOG))).toBe(0);
  });
});

describe('members, start and missing tokens', () => {
  it('counts visible living monsters and npcs, never objects, hidden tokens or the Dead', () => {
    const tokens = [
      token(1, 'pc'),
      token(2, 'monster'),
      token(3, 'npc'),
      token(4, 'object'),
      token(5, 'monster', { hidden: true }),
      token(6, 'monster', { markers: [{ id: 'dead' }] }),
      token(7, 'monster', { markers: [{ id: 'unconscious' }] }),
    ];
    expect(membersOf(tokens, NO_FOG).map((member) => member.id)).toEqual([uuid(2), uuid(3), uuid(7)]);
  });

  it('starts from the player characters players see, in the DM list’s order', () => {
    const tokens = [token(3, 'pc'), token(1, 'pc'), token(2, 'pc', { hidden: true }), token(4, 'monster')];
    expect(startTokens(tokens, NO_FOG).map((t) => t.id)).toEqual([uuid(1), uuid(3)]);
  });

  it('offers the visible player characters without an entry', () => {
    const tokens = [token(1, 'pc'), token(2, 'pc'), token(3, 'pc', { hidden: true })];
    expect(missingTokens(encounter([pc(1), dm()]), tokens, NO_FOG).map((t) => t.id)).toEqual([uuid(2)]);
  });
});

describe('playerEncounter', () => {
  it('is null unless combat runs', () => {
    expect(playerEncounter(null, [], NO_FOG)).toBeNull();
    expect(playerEncounter(encounter([dm()], { active: false }), [], NO_FOG)).toBeNull();
  });

  it('carries no initiative number, no member and no count of them, and leaves out hidden player characters', () => {
    const tokens = [
      token(1, 'pc'),
      token(2, 'pc', { hidden: true }),
      token(3, 'monster'),
      token(5, 'monster', { hidden: true }),
    ];
    const state = encounter([pc(1, 20), pc(2, 15), dm(12)], { current_index: 0, round: 2, enemies_seen: true });
    const projected = playerEncounter(state, tokens, NO_FOG);
    expect(projected).toEqual({
      round: 2,
      entries: [
        { id: pc(1).id, kind: 'pc', token_id: uuid(1) },
        { id: dm().id, kind: 'dm' },
      ],
      current: 0,
      next: 1,
    });
    expect(Value.Check(PlayerEncounterSchema, projected)).toBe(true);
    const text = JSON.stringify(projected);
    for (const secret of [uuid(2), uuid(3), uuid(5), '"initiative"', 'enemies_seen', '"members"']) {
      expect(text).not.toContain(secret);
    }
  });

  it('is the same whatever hidden monsters the scene holds', () => {
    const state = encounter([pc(1), dm()], { current_index: 0 });
    const visible = [token(1, 'pc')];
    const withHidden = [...visible, token(5, 'monster', { hidden: true }), token(6, 'npc', { hidden: true })];
    expect(playerEncounter(state, withHidden, NO_FOG)).toEqual(playerEncounter(state, visible, NO_FOG));
  });

  it('names no turn when the turn is a player character players cannot see', () => {
    const state = encounter([pc(1), pc(2), dm()], { current_index: 1 });
    const projected = playerEncounter(state, [token(1, 'pc'), token(2, 'pc', { hidden: true })], NO_FOG);
    expect(projected?.current).toBeNull();
    // Nor which is next: it would follow from where the unseen entry stands (TBL-06 review).
    expect(projected?.next).toBeNull();
    // Moving or numbering that unseen entry changes nothing players receive.
    const moved = { ...state, entries: [pc(2), pc(1), dm()], current_index: 0 };
    expect(playerEncounter(moved, [token(1, 'pc'), token(2, 'pc', { hidden: true })], NO_FOG)).toEqual(projected);
  });
});

describe('isEncounter and isPlayerEncounter', () => {
  it('agree with the contract’s schemas on what arrived', async () => {
    const { isEncounter, isPlayerEncounter, EncounterSchema } = await import('./encounter.js');
    const good = encounter([pc(1, 14), dm()], { round: 2 });
    expect(isEncounter(good)).toBe(true);
    expect(Value.Check(EncounterSchema, good)).toBe(true);
    for (const bad of [
      null,
      { ...good, round: 0 },
      { ...good, extra: 1 },
      { ...good, entries: [{ ...pc(1), initiative: 1.5 }] },
      { ...good, entries: [{ id: uuid(1), kind: 'monster', initiative: null }] },
      { ...good, entries: 'many' },
    ]) {
      expect(isEncounter(bad), JSON.stringify(bad)).toBe(false);
      expect(Value.Check(EncounterSchema, bad), JSON.stringify(bad)).toBe(false);
    }
    const strip = playerEncounter(good, [token(1, 'pc')], NO_FOG);
    expect(isPlayerEncounter(strip)).toBe(true);
    for (const bad of [
      { ...strip, members: 2 },
      { ...strip, current: -1 },
      { ...strip, entries: [{ id: uuid(1), kind: 'dm', initiative: 3 }] },
    ]) {
      expect(isPlayerEncounter(bad), JSON.stringify(bad)).toBe(false);
      expect(Value.Check(PlayerEncounterSchema, bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('removing the entry whose turn it is (TBL-06 review)', () => {
  const tokens = [token(1, 'pc'), token(2, 'pc'), token(3, 'pc')];

  it('passes the turn as Next would, over an Enemies entry that never had a member, counting the round', async () => {
    const { changeOf } = await import('./encounter.js');
    const scene = { sceneId: uuid(901), tokens, fog: NO_FOG, newId: () => uuid(500) };
    const third = encounter([pc(1), pc(2), pc(3), dm()], { current_index: 2, round: 2 });
    const after = changeOf(third, { type: 'removeEntry', entry_id: pc(3).id }, scene);
    expect(after && 'encounter' in after ? after.encounter : after).toMatchObject({ current_index: 0, round: 3 });
    const second = encounter([pc(1), pc(2), pc(3), dm()], { current_index: 1 });
    const kept = changeOf(second, { type: 'removeEntry', entry_id: pc(2).id }, scene);
    expect(kept && 'encounter' in kept ? kept.encounter : kept).toMatchObject({ current_index: 1, round: 1 });
    const before = encounter([pc(1), pc(2), pc(3), dm()], { current_index: 2 });
    const earlier = changeOf(before, { type: 'removeEntry', entry_id: pc(1).id }, scene);
    expect(earlier && 'encounter' in earlier ? earlier.encounter : earlier).toMatchObject({ current_index: 1 });
  });
});
