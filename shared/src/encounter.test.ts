import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import {
  changeOf,
  firstTurn,
  insertionIndex,
  missingTokens,
  nextIndex,
  noEnemiesLeft,
  playerEncounter,
  PlayerEncounterSchema,
  sortByInitiative,
  startTokens,
  stepTurn,
  turnView,
  type Encounter,
  type EncounterDecision,
  type EncounterEntry,
  type EncounterToken,
} from './encounter.js';
import type { FogMask } from './fog.js';

// The initiative tracker's turn rules (TBL-06, DMT-02, specs/04-live-sync.md §14, Q-111, Q-117, Q-118, D-180).

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
const DEAD = { markers: [{ id: 'dead' }] };
const pc = (n: number, initiative: number | null = null): EncounterEntry => ({
  id: uuid(100 + n),
  kind: 'pc',
  token_id: uuid(n),
  initiative,
});
const monster = (n: number, initiative: number | null = null): EncounterEntry => ({
  id: uuid(100 + n),
  kind: 'monster',
  token_id: uuid(n),
  initiative,
});

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
/** The encounter a change leads to; the test fails on a refusal or no change. */
function after(decision: EncounterDecision): Encounter | null {
  if (decision === undefined || 'refused' in decision) throw new Error(`No change: ${JSON.stringify(decision)}`);
  return decision.encounter;
}
let next = 500;
const scene = (tokens: readonly EncounterToken[], fog: FogMask = NO_FOG) => ({
  sceneId: uuid(901),
  tokens,
  fog,
  newId: () => uuid((next += 1)),
});

describe('sortByInitiative', () => {
  it('puts numbered entries first, highest first, and keeps the unnumbered in their order below them', () => {
    const entries = [pc(1), pc(2, 12), monster(5), pc(3, 18), pc(4)];
    expect(ids(sortByInitiative(entries))).toEqual(ids([pc(3, 18), pc(2, 12), pc(1), monster(5), pc(4)]));
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
    const dragged = [pc(1, 5), pc(2, 17), monster(5)];
    expect(ids(sortByInitiative(dragged))).toEqual(ids([pc(2), pc(1), monster(5)]));
  });

  it('keeps equal numbers in their order, and a drag between them stands until a number is edited (DMT-02)', () => {
    const tokens = [token(1, 'pc'), token(5, 'monster'), token(6, 'monster')];
    const start = encounter([pc(1), monster(5), monster(6)]);
    // Both bandits rolled 14: the sort keeps them as they were, bandit 5 above bandit 6.
    const fourteen = after(
      changeOf(start, { type: 'setInitiative', entry_id: monster(6).id, initiative: 14 }, scene(tokens)),
    );
    const tied = after(
      changeOf(fourteen, { type: 'setInitiative', entry_id: monster(5).id, initiative: 14 }, scene(tokens)),
    );
    expect(ids(tied!.entries)).toEqual(ids([monster(6), monster(5), pc(1)]));
    // The DM drags bandit 5 above bandit 6 to break the tie.
    const dragged = after(
      changeOf(tied, { type: 'reorder', entry_ids: ids([monster(5), monster(6), pc(1)]) }, scene(tokens)),
    );
    expect(ids(dragged!.entries)).toEqual(ids([monster(5), monster(6), pc(1)]));
    // The player character's 9 sorts again, and the tie keeps the dragged order.
    const nine = after(changeOf(dragged, { type: 'setInitiative', entry_id: pc(1).id, initiative: 9 }, scene(tokens)));
    expect(ids(nine!.entries)).toEqual(ids([monster(5), monster(6), pc(1)]));
    // A drag that breaks the numbers stands until a number is edited again.
    const broken = after(
      changeOf(nine, { type: 'reorder', entry_ids: ids([pc(1), monster(5), monster(6)]) }, scene(tokens)),
    );
    expect(ids(broken!.entries)).toEqual(ids([pc(1), monster(5), monster(6)]));
    const edited = after(
      changeOf(broken, { type: 'setInitiative', entry_id: monster(6).id, initiative: 15 }, scene(tokens)),
    );
    expect(ids(edited!.entries)).toEqual(ids([monster(6), monster(5), pc(1)]));
  });
});

describe('stepTurn', () => {
  const tokens = [token(1, 'pc'), token(2, 'pc'), token(3, 'monster')];
  const view = turnView(tokens, NO_FOG);

  it('passes the turn in order and counts a round past the last entry', () => {
    const state = encounter([pc(1), pc(2), monster(3)], { current_index: 2 });
    expect(stepTurn({ ...state, current_index: 0 }, view, 1)).toEqual({ current_index: 1, round: 1 });
    expect(stepTurn(state, view, 1)).toEqual({ current_index: 0, round: 2 });
  });

  it('goes back a round before the first entry, and does nothing on round 1’s first turn', () => {
    const state = encounter([pc(1), pc(2), monster(3)], { round: 3 });
    expect(stepTurn(state, view, -1)).toEqual({ current_index: 2, round: 2 });
    expect(stepTurn({ ...state, round: 1 }, view, -1)).toBeUndefined();
  });

  it('passes over a monster or npc carrying Dead, and one players cannot see (Q-118)', () => {
    // Token 4 stands at x 8: its centre (8.5, 0.5) is cell (34, 2) of a quarter square.
    const fog: FogMask = [{ y: 2, runs: [30, 40] }];
    const scene = [token(1, 'pc'), token(3, 'monster', DEAD), token(4, 'npc'), token(5, 'monster', { hidden: true })];
    const state = encounter([pc(1), monster(3), monster(4), monster(5)]);
    expect(stepTurn(state, turnView(scene, NO_FOG), 1)).toEqual({ current_index: 2, round: 1 });
    expect(stepTurn(state, turnView(scene, fog), 1)).toEqual({ current_index: 0, round: 2 });
    expect(nextIndex(state, turnView(scene, fog))).toBeNull();
    // Revealed again, the npc takes its turn again.
    expect(nextIndex(state, turnView(scene, NO_FOG))).toBe(2);
  });

  it('does not pass over an Unconscious or a Dead player character', () => {
    const down = [token(1, 'pc'), token(2, 'pc', { markers: [{ id: 'unconscious' }] }), token(4, 'pc', DEAD)];
    const state = encounter([pc(1), pc(2), pc(4)]);
    const downView = turnView(down, NO_FOG);
    expect(stepTurn(state, downView, 1)).toEqual({ current_index: 1, round: 1 });
    expect(stepTurn({ ...state, current_index: 1 }, downView, 1)).toEqual({ current_index: 2, round: 1 });
  });

  it('does not pass over an Unconscious monster', () => {
    const scene = [token(1, 'pc'), token(3, 'monster', { markers: [{ id: 'unconscious' }] })];
    expect(stepTurn(encounter([pc(1), monster(3)]), turnView(scene, NO_FOG), 1)).toEqual({
      current_index: 1,
      round: 1,
    });
  });

  it('passes over a player character players cannot see, hidden or in the fog', () => {
    const fog: FogMask = [{ y: 2, runs: [30, 40] }];
    const tokens = [token(1, 'pc'), token(2, 'pc', { hidden: true }), token(4, 'pc')];
    const state = encounter([pc(1), pc(2), pc(4)]);
    expect(stepTurn(state, turnView(tokens, NO_FOG), 1)).toEqual({ current_index: 2, round: 1 });
    expect(stepTurn(state, turnView(tokens, fog), 1)).toEqual({ current_index: 0, round: 2 });
  });

  it('does nothing when no entry takes its turn', () => {
    const state = encounter([monster(3)]);
    const deadView = turnView([token(3, 'monster', DEAD)], NO_FOG);
    expect(stepTurn(state, deadView, 1)).toBeUndefined();
    expect(firstTurn(state, deadView)).toBe(0);
  });
});

describe('start, missing tokens and adding', () => {
  it('starts from the player characters and the living monsters and npcs players see, in the DM list’s order', () => {
    const tokens = [
      token(3, 'pc'),
      token(1, 'pc'),
      token(2, 'pc', { hidden: true }),
      token(4, 'monster'),
      token(5, 'npc'),
      token(6, 'object'),
      token(7, 'monster', { hidden: true }),
      token(8, 'monster', DEAD),
      token(9, 'monster', { markers: [{ id: 'unconscious' }] }),
      token(10, 'pc', DEAD),
    ];
    expect(startTokens(tokens, NO_FOG).map((t) => t.id)).toEqual([1, 3, 4, 5, 9, 10].map(uuid));
    const started = after(changeOf(null, { type: 'start' }, scene(tokens)));
    expect(started!.entries.map((entry) => [entry.kind, entry.token_id, entry.initiative])).toEqual([
      ['pc', uuid(1), null],
      ['pc', uuid(3), null],
      ['monster', uuid(4), null],
      ['monster', uuid(5), null],
      ['monster', uuid(9), null],
      ['pc', uuid(10), null],
    ]);
    expect(started).toMatchObject({ active: true, round: 1, current_index: 0, enemies_seen: true });
  });

  it('offers the visible tokens without an entry: player characters and living monsters and npcs', () => {
    const tokens = [
      token(1, 'pc'),
      token(2, 'pc'),
      token(3, 'pc', { hidden: true }),
      token(4, 'monster'),
      token(5, 'monster'),
      token(6, 'monster', DEAD),
      token(7, 'object'),
    ];
    const state = encounter([pc(1), monster(4)]);
    expect(missingTokens(state, tokens, NO_FOG).map((t) => t.id)).toEqual([uuid(2), uuid(5)]);
  });

  it('adds a token by its number, after equal numbers and before lower ones, or at the end without one', () => {
    const entries = [pc(1, 18), monster(4, 12), pc(2, 12), monster(5, 7), pc(3)];
    expect(insertionIndex(entries, 20)).toBe(0);
    expect(insertionIndex(entries, 12)).toBe(3);
    expect(insertionIndex(entries, 1)).toBe(4);
    expect(insertionIndex(entries, null)).toBe(5);
    // A dragged order is left as it is: the new entry goes before the first entry with a lower number.
    expect(insertionIndex([pc(1, 3), pc(2, 15)], 10)).toBe(0);
  });

  it('adds a revealed monster with its number, keeping the turn where it was, and refuses what may not enter', () => {
    const tokens = [token(1, 'pc'), token(2, 'pc'), token(5, 'monster'), token(6, 'monster', DEAD), token(7, 'object')];
    const state = encounter([pc(1, 18), pc(2, 10)], { current_index: 1 });
    const added = after(changeOf(state, { type: 'addEntry', token_id: uuid(5), initiative: 14 }, scene(tokens)));
    expect(added!.entries.map((entry) => [entry.kind, entry.token_id, entry.initiative])).toEqual([
      ['pc', uuid(1), 18],
      ['monster', uuid(5), 14],
      ['pc', uuid(2), 10],
    ]);
    expect(added!.current_index).toBe(2);
    expect(added!.enemies_seen).toBe(true);
    const atEnd = after(changeOf(state, { type: 'addEntry', token_id: uuid(5) }, scene(tokens)));
    expect(atEnd!.entries.at(-1)).toMatchObject({ kind: 'monster', token_id: uuid(5), initiative: null });
    for (const refused of [uuid(6), uuid(7), uuid(1)]) {
      expect(changeOf(state, { type: 'addEntry', token_id: refused }, scene(tokens))).toMatchObject({
        refused: { code: 'bad_request' },
      });
    }
  });
});

describe('No enemies left (Q-118)', () => {
  it('asks once the encounter had a monster that could act and none can now', () => {
    const living = [token(1, 'pc'), token(3, 'monster')];
    const started = after(changeOf(null, { type: 'start' }, scene(living)))!;
    expect(started.enemies_seen).toBe(true);
    expect(noEnemiesLeft(started, turnView(living, NO_FOG))).toBe(false);
    const dead = [token(1, 'pc'), token(3, 'monster', DEAD)];
    expect(noEnemiesLeft(started, turnView(dead, NO_FOG))).toBe(true);
    // Removing the dead monster's entry changes nothing: the encounter had one.
    const removed = after(changeOf(started, { type: 'removeEntry', entry_id: started.entries[1]!.id }, scene(dead)));
    expect(noEnemiesLeft(removed, turnView(dead, NO_FOG))).toBe(true);
  });

  it('never asks in an encounter that never had a monster entry', () => {
    const party = [token(1, 'pc'), token(2, 'pc'), token(3, 'monster', { hidden: true })];
    const started = after(changeOf(null, { type: 'start' }, scene(party)))!;
    expect(started.enemies_seen).toBe(false);
    expect(noEnemiesLeft(started, turnView(party, NO_FOG))).toBe(false);
    const stepped = after(changeOf(started, { type: 'next' }, scene(party)))!;
    expect(noEnemiesLeft(stepped, turnView(party, NO_FOG))).toBe(false);
  });
});

describe('playerEncounter', () => {
  it('is null unless combat runs', () => {
    expect(playerEncounter(null, [], NO_FOG)).toBeNull();
    expect(playerEncounter(encounter([pc(1)], { active: false }), [token(1, 'pc')], NO_FOG)).toBeNull();
  });

  it('carries the entries of tokens players see, a Dead monster’s included, and no number or unseen token', () => {
    const tokens = [
      token(1, 'pc'),
      token(2, 'pc', { hidden: true }),
      token(3, 'monster'),
      token(4, 'monster', DEAD),
      token(5, 'monster', { hidden: true }),
    ];
    const state = encounter([pc(1, 20), pc(2, 15), monster(5, 14), monster(4, 13), monster(3, 12)], {
      current_index: 0,
      round: 2,
      enemies_seen: true,
    });
    const projected = playerEncounter(state, tokens, NO_FOG);
    expect(projected).toEqual({
      round: 2,
      entries: [
        { id: pc(1).id, kind: 'pc', token_id: uuid(1) },
        { id: monster(4).id, kind: 'monster', token_id: uuid(4) },
        { id: monster(3).id, kind: 'monster', token_id: uuid(3) },
      ],
      current: 0,
      // Next passes over the hidden player character, the hidden bandit and the dead one.
      next: 2,
    });
    expect(Value.Check(PlayerEncounterSchema, projected)).toBe(true);
    const text = JSON.stringify(projected);
    for (const secret of [uuid(2), uuid(5), pc(2).id, monster(5).id, '"initiative"', 'enemies_seen']) {
      expect(text).not.toContain(secret);
    }
  });

  it('is the same whatever hidden monsters the scene holds and wherever their entries stand', () => {
    const visible = [token(1, 'pc'), token(3, 'monster')];
    const withHidden = [...visible, token(5, 'monster', { hidden: true }), token(6, 'npc', { hidden: true })];
    const state = encounter([pc(1), monster(3)], { current_index: 0 });
    const withEntries = encounter([monster(5), pc(1, 4), monster(6), monster(3)], { current_index: 1 });
    expect(playerEncounter(state, withHidden, NO_FOG)).toEqual(playerEncounter(state, visible, NO_FOG));
    expect(playerEncounter(withEntries, withHidden, NO_FOG)).toEqual(playerEncounter(state, visible, NO_FOG));
  });

  it('names no turn when the turn is an entry players cannot see', () => {
    const tokens = [token(1, 'pc'), token(2, 'pc', { hidden: true }), token(3, 'monster')];
    const state = encounter([pc(1), pc(2), monster(3)], { current_index: 1 });
    const projected = playerEncounter(state, tokens, NO_FOG);
    expect(projected?.current).toBeNull();
    // Nor which is next: it would follow from where the unseen entry stands (TBL-06 review).
    expect(projected?.next).toBeNull();
    // Moving or numbering that unseen entry changes nothing players receive.
    const moved = { ...state, entries: [pc(2), pc(1), monster(3)], current_index: 0 };
    expect(playerEncounter(moved, tokens, NO_FOG)).toEqual(projected);
  });
});

describe('isEncounter and isPlayerEncounter', () => {
  it('agree with the contract’s schemas on what arrived', async () => {
    const { isEncounter, isPlayerEncounter, EncounterSchema } = await import('./encounter.js');
    const good = encounter([pc(1, 14), monster(3)], { round: 2 });
    expect(isEncounter(good)).toBe(true);
    expect(Value.Check(EncounterSchema, good)).toBe(true);
    for (const bad of [
      null,
      { ...good, round: 0 },
      { ...good, extra: 1 },
      { ...good, entries: [{ ...pc(1), initiative: 1.5 }] },
      { ...good, entries: [{ id: uuid(1), kind: 'monster', initiative: null }] },
      { ...good, entries: [{ id: uuid(1), kind: 'dm', initiative: null }] },
      { ...good, entries: [{ ...monster(3), kind: 'object' }] },
      { ...good, entries: 'many' },
    ]) {
      expect(isEncounter(bad), JSON.stringify(bad)).toBe(false);
      expect(Value.Check(EncounterSchema, bad), JSON.stringify(bad)).toBe(false);
    }
    const strip = playerEncounter(good, [token(1, 'pc'), token(3, 'monster')], NO_FOG);
    expect(isPlayerEncounter(strip)).toBe(true);
    for (const bad of [
      { ...strip, members: 2 },
      { ...strip, current: -1 },
      { ...strip, entries: [{ id: uuid(1), kind: 'dm' }] },
      { ...strip, entries: [{ ...monster(3), initiative: 3 }] },
    ]) {
      expect(isPlayerEncounter(bad), JSON.stringify(bad)).toBe(false);
      expect(Value.Check(PlayerEncounterSchema, bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('removing the entry whose turn it is (TBL-06 review)', () => {
  const tokens = [token(1, 'pc'), token(2, 'pc'), token(3, 'pc'), token(4, 'monster', DEAD)];

  it('passes the turn as Next would, over a Dead monster, counting the round', () => {
    const third = encounter([pc(1), pc(2), pc(3), monster(4)], { current_index: 2, round: 2 });
    expect(after(changeOf(third, { type: 'removeEntry', entry_id: pc(3).id }, scene(tokens)))).toMatchObject({
      current_index: 0,
      round: 3,
    });
    const second = encounter([pc(1), pc(2), pc(3), monster(4)], { current_index: 1 });
    expect(after(changeOf(second, { type: 'removeEntry', entry_id: pc(2).id }, scene(tokens)))).toMatchObject({
      current_index: 1,
      round: 1,
    });
    const before = encounter([pc(1), pc(2), pc(3), monster(4)], { current_index: 2 });
    expect(after(changeOf(before, { type: 'removeEntry', entry_id: pc(1).id }, scene(tokens)))).toMatchObject({
      current_index: 1,
    });
  });

  it('removes a monster’s entry, a Dead one’s included', () => {
    const state = encounter([pc(1), monster(4)]);
    expect(after(changeOf(state, { type: 'removeEntry', entry_id: monster(4).id }, scene(tokens)))!.entries).toEqual([
      pc(1),
    ]);
  });
});
