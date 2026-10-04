import { Type, type Static } from 'typebox';
import { hasMarker } from './conditions.js';
import { UuidSchema } from './entities.js';
import { seenByPlayers, type FogMask } from './fog.js';
import type { SceneToken } from './tokens.js';

// The initiative tracker (TBL-06, DMT-02; specs/04-live-sync.md §14, specs/03-domain-model.md §1, Q-111,
// Q-117, Q-118, D-180). A scene holds at most one encounter: the order the table rolled with physical dice,
// one entry per player character and one per monster or npc, each naming its token. Nothing here rolls,
// computes or suggests a number. Whether an entry takes its turn is never stored: it follows from what players
// can see of its token and whether a monster carries Dead, computed whenever needed by the functions below,
// which the server, the DM view and the players' projection share.

const strict = { additionalProperties: false } as const;

/** The initiative number a player rolled, or none. */
export const INITIATIVE_BOUNDS = { min: -99, max: 999 } as const;
export const InitiativeSchema = Type.Union([
  Type.Integer({ minimum: INITIATIVE_BOUNDS.min, maximum: INITIATIVE_BOUNDS.max }),
  Type.Null(),
]);

/** More entries than any table holds; a bound so that no command or row is unbounded. */
export const MAX_ENCOUNTER_ENTRIES = 200;

// An entry is a player character's (`pc`) or a monster's or npc's (`monster`); both name their token. The one
// Enemies entry of TBL-06 (`kind: 'dm'`) is gone: migration 0011 expanded every stored one (DMT-02).
export const PcEntrySchema = Type.Object(
  { id: UuidSchema, kind: Type.Literal('pc'), token_id: UuidSchema, initiative: InitiativeSchema },
  strict,
);
export const MonsterEntrySchema = Type.Object(
  { id: UuidSchema, kind: Type.Literal('monster'), token_id: UuidSchema, initiative: InitiativeSchema },
  strict,
);
export const EncounterEntrySchema = Type.Union([PcEntrySchema, MonsterEntrySchema]);

/** The encounter as it is stored and as the DM receives it. */
export const EncounterSchema = Type.Object(
  {
    id: UuidSchema,
    scene_id: UuidSchema,
    active: Type.Boolean(),
    round: Type.Integer({ minimum: 1 }),
    current_index: Type.Integer({ minimum: 0 }),
    // Whether a monster or npc entry could take its turn at some point of this encounter (Q-118): what
    // "No enemies left. End combat?" waits for. Never sent to players.
    enemies_seen: Type.Boolean(),
    entries: Type.Array(EncounterEntrySchema, { maxItems: MAX_ENCOUNTER_ENTRIES }),
  },
  strict,
);

// What players receive (specs/04-live-sync.md §4): the round, the entries whose token they can see, in order,
// and which has the turn and which is next. No initiative number, nothing of a token they cannot see. A Dead
// monster they see stays, its token's marker greying its card (Q-118).
export const PlayerEncounterEntrySchema = Type.Object(
  { id: UuidSchema, kind: Type.Union([Type.Literal('pc'), Type.Literal('monster')]), token_id: UuidSchema },
  strict,
);
const EntryIndex = Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]);
export const PlayerEncounterSchema = Type.Object(
  {
    round: Type.Integer({ minimum: 1 }),
    entries: Type.Array(PlayerEncounterEntrySchema, { maxItems: MAX_ENCOUNTER_ENTRIES }),
    current: EntryIndex,
    next: EntryIndex,
  },
  strict,
);

export type PcEntry = Static<typeof PcEntrySchema>;
export type MonsterEntry = Static<typeof MonsterEntrySchema>;
export type EncounterEntry = Static<typeof EncounterEntrySchema>;
export type Encounter = Static<typeof EncounterSchema>;
export type PlayerEncounterEntry = Static<typeof PlayerEncounterEntrySchema>;
export type PlayerEncounter = Static<typeof PlayerEncounterSchema>;

/** What the turn rules read of a token: what players see of it, its category and its markers. */
export type EncounterToken = Pick<SceneToken, 'id' | 'x' | 'y' | 'hidden' | 'z_order' | 'markers'> & {
  asset: Pick<SceneToken['asset'], 'size' | 'category'>;
};

/** What the turn rules need of the scene at the moment they are applied. */
export interface TurnView {
  /** The ids of the tokens players can see. */
  seen: ReadonlySet<string>;
  /** The ids of the tokens carrying Dead. */
  dead: ReadonlySet<string>;
}

const seenBy = (fog: FogMask) => (token: EncounterToken) => seenByPlayers(token, token.asset.size, fog);

/** The entry kind a token takes: `pc` for a player character, `monster` for a monster or npc, none for an object. */
export function entryKindOf(token: Pick<EncounterToken, 'asset'>): EncounterEntry['kind'] | undefined {
  const { category } = token.asset;
  if (category === 'pc') return 'pc';
  return category === 'monster' || category === 'npc' ? 'monster' : undefined;
}

export function turnView(tokens: readonly EncounterToken[], fog: FogMask): TurnView {
  const seen = seenBy(fog);
  return {
    seen: new Set(tokens.filter(seen).map((token) => token.id)),
    dead: new Set(tokens.filter((token) => hasMarker(token.markers, 'dead')).map((token) => token.id)),
  };
}

/**
 * Whether an entry takes its turn (Q-111, Q-118): a player character's while players can see its token,
 * whatever it carries, Unconscious and Dead included; a monster's or npc's while players can see its token and
 * it does not carry Dead.
 */
export function takesTurn(entry: EncounterEntry, view: TurnView): boolean {
  if (!view.seen.has(entry.token_id)) return false;
  return entry.kind === 'pc' || !view.dead.has(entry.token_id);
}

/** Whether some monster or npc entry can take its turn now. */
export function enemiesCanAct(encounter: Pick<Encounter, 'entries'>, view: TurnView): boolean {
  return encounter.entries.some((entry) => entry.kind === 'monster' && takesTurn(entry, view));
}

/**
 * Whether the DM is to be asked "No enemies left. End combat?" (Q-118): combat runs, the encounter has had a
 * monster or npc entry that could act, and none can now.
 */
export function noEnemiesLeft(encounter: Encounter | null, view: TurnView): boolean {
  return encounter !== null && encounter.active && encounter.enemies_seen && !enemiesCanAct(encounter, view);
}

type Turn = Pick<Encounter, 'current_index' | 'round'>;
type TurnState = Pick<Encounter, 'current_index' | 'round' | 'entries'>;

/**
 * The turn after `encounter.next` (+1) or `encounter.previous` (-1): the nearest entry that takes its turn,
 * past the last entry back to the first with one more round, or back past the first with one fewer.
 * Undefined when nothing would change: no entry takes its turn, or previous on round 1's first turn.
 */
export function stepTurn(encounter: TurnState, view: TurnView, direction: 1 | -1): Turn | undefined {
  const { entries } = encounter;
  const count = entries.length;
  if (count === 0) return undefined;
  let round = encounter.round;
  let index = Math.min(encounter.current_index, count - 1);
  for (let step = 0; step < count; step += 1) {
    index += direction;
    if (index >= count) {
      index = 0;
      round += 1;
    } else if (index < 0) {
      if (round === 1) return undefined;
      index = count - 1;
      round -= 1;
    }
    if (takesTurn(entries[index]!, view)) return { current_index: index, round };
  }
  return undefined;
}

/** The index of the entry Next would give the turn to, or null when it is the same entry or none. */
export function nextIndex(encounter: TurnState, view: TurnView): number | null {
  const next = stepTurn(encounter, view, 1);
  return next === undefined || next.current_index === encounter.current_index ? null : next.current_index;
}

/** The first entry that takes its turn, or the first entry when none does. */
export function firstTurn(encounter: Pick<Encounter, 'entries'>, view: TurnView): number {
  const index = encounter.entries.findIndex((entry) => takesTurn(entry, view));
  return Math.max(index, 0);
}

/**
 * The order after an initiative number was set (Q-111): numbered entries first, highest first, then those
 * without one; a stable sort, so ties and the unnumbered keep the order they had, a dragged one included.
 */
export function sortByInitiative<T extends { initiative: number | null }>(entries: readonly T[]): T[] {
  return entries
    .map((entry, at) => ({ entry, at }))
    .sort((a, b) => {
      const x = a.entry.initiative;
      const y = b.entry.initiative;
      if (x === null && y === null) return a.at - b.at;
      if (x === null) return 1;
      if (y === null) return -1;
      return y - x || a.at - b.at;
    })
    .map(({ entry }) => entry);
}

/** Where the entry that had the turn is in a new order; the first entry when it is gone. */
export function followTurn(before: readonly EncounterEntry[], after: readonly EncounterEntry[], index: number): number {
  const id = before[index]?.id;
  const at = after.findIndex((entry) => entry.id === id);
  return Math.max(at, 0);
}

/**
 * Whether a token may take an entry (Q-111, Q-117): players can see it, and it is a player character, or a
 * monster or npc not carrying Dead. Objects never do.
 */
export function canEnter(token: EncounterToken, fog: FogMask): boolean {
  const kind = entryKindOf(token);
  if (kind === undefined || !seenByPlayers(token, token.asset.size, fog)) return false;
  return kind === 'pc' || !hasMarker(token.markers, 'dead');
}

/**
 * The tokens `encounter.start` builds entries for, in the order of the DM's token list (stacking order):
 * those that may take an entry.
 */
export function startTokens<T extends EncounterToken>(tokens: readonly T[], fog: FogMask): T[] {
  return tokens
    .filter((token) => canEnter(token, fog))
    .sort((a, b) => a.z_order - b.z_order || a.id.localeCompare(b.id));
}

/** The tokens that may take an entry and have none: those the DM is offered to add (Q-117). */
export function missingTokens<T extends EncounterToken>(
  encounter: Pick<Encounter, 'entries'>,
  tokens: readonly T[],
  fog: FogMask,
): T[] {
  const entered = new Set(encounter.entries.map((entry) => entry.token_id));
  return startTokens(tokens, fog).filter((token) => !entered.has(token.id));
}

/**
 * Where an entry added with `initiative` goes (DMT-02): before the first entry with a lower number or none,
 * so after those with the same number, and the order the DM dragged stays as it is; at the end without one.
 */
export function insertionIndex(entries: readonly EncounterEntry[], initiative: number | null): number {
  if (initiative === null) return entries.length;
  const at = entries.findIndex((entry) => entry.initiative === null || entry.initiative < initiative);
  return at === -1 ? entries.length : at;
}

/**
 * What players receive of an encounter (specs/04-live-sync.md §4, §14): null unless combat runs; the entries
 * whose token they can see, a Dead monster's included, without numbers; which of them has the turn, null when
 * it is an entry they do not see; and which is next. Everything here follows from what players already see, so
 * a hidden token changes nothing in it.
 */
export function playerEncounter(
  encounter: Encounter | null,
  tokens: readonly EncounterToken[],
  fog: FogMask,
): PlayerEncounter | null {
  if (encounter === null || !encounter.active) return null;
  const view = turnView(tokens, fog);
  const shown: number[] = [];
  const entries: PlayerEncounterEntry[] = [];
  encounter.entries.forEach((entry, index) => {
    if (!view.seen.has(entry.token_id)) return;
    shown.push(index);
    entries.push({ id: entry.id, kind: entry.kind, token_id: entry.token_id });
  });
  const at = (index: number | null): number | null => {
    if (index === null) return null;
    const found = shown.indexOf(index);
    return found === -1 ? null : found;
  };
  const current = at(encounter.current_index);
  // While the turn is an entry players cannot see, Next is not named either: it would follow from
  // where that unseen entry stands, which players must not learn (TBL-06 review).
  return { round: encounter.round, entries, current, next: current === null ? null : at(nextIndex(encounter, view)) };
}

export function samePlayerEncounter(a: PlayerEncounter | null, b: PlayerEncounter | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// The client's checks of what arrived, written out as `isFogMask` is: the contract's validator would bring
// TypeBox's format checks, and the URL they name, into the client bundle, which must name no other host.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOnly = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
const isWhole = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const isInitiative = (value: unknown): boolean =>
  value === null || isWhole(value, INITIATIVE_BOUNDS.min, INITIATIVE_BOUNDS.max);
const isIndex = (value: unknown): boolean => value === null || isWhole(value, 0);

const isKind = (value: unknown): boolean => value === 'pc' || value === 'monster';

function isEntry(value: unknown): value is EncounterEntry {
  return (
    isObject(value) &&
    hasOnly(value, ['id', 'kind', 'token_id', 'initiative']) &&
    isUuid(value.id) &&
    isKind(value.kind) &&
    isUuid(value.token_id) &&
    isInitiative(value.initiative)
  );
}

function isPlayerEntry(value: unknown): value is PlayerEncounterEntry {
  return (
    isObject(value) &&
    hasOnly(value, ['id', 'kind', 'token_id']) &&
    isUuid(value.id) &&
    isKind(value.kind) &&
    isUuid(value.token_id)
  );
}

const ENCOUNTER_KEYS = ['id', 'scene_id', 'active', 'round', 'current_index', 'enemies_seen', 'entries'] as const;

/** Whether a value is an encounter as the DM receives it: a client's check of what arrived. */
export function isEncounter(value: unknown): value is Encounter {
  return (
    isObject(value) &&
    hasOnly(value, ENCOUNTER_KEYS) &&
    isUuid(value.id) &&
    isUuid(value.scene_id) &&
    typeof value.active === 'boolean' &&
    isWhole(value.round, 1) &&
    isWhole(value.current_index, 0) &&
    typeof value.enemies_seen === 'boolean' &&
    Array.isArray(value.entries) &&
    value.entries.length <= MAX_ENCOUNTER_ENTRIES &&
    value.entries.every(isEntry)
  );
}

/** Whether a value is what players receive of an encounter. */
export function isPlayerEncounter(value: unknown): value is PlayerEncounter {
  return (
    isObject(value) &&
    hasOnly(value, ['round', 'entries', 'current', 'next']) &&
    isWhole(value.round, 1) &&
    isIndex(value.current) &&
    isIndex(value.next) &&
    Array.isArray(value.entries) &&
    value.entries.length <= MAX_ENCOUNTER_ENTRIES &&
    value.entries.every(isPlayerEntry)
  );
}

// --- the encounter commands' rules (specs/04-live-sync.md §14) ------------------------------------
//
// What each encounter command does to an encounter, decided from the scene's tokens and fog at that moment.
// The server applies it inside the transaction that writes the result; the client's test server applies the
// same rules, so the DM view is tested against them. `newId` gives a new entry or encounter its UUID, which
// only the server generates (specs/03-domain-model.md §3).

/** What an encounter command asks for; `restore` is undo's, never on the wire. */
export type EncounterChange =
  | { type: 'start' }
  | { type: 'end' }
  | { type: 'reorder'; entry_ids: readonly string[] }
  | { type: 'setInitiative'; entry_id: string; initiative: number | null }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'addEntry'; token_id: string; initiative?: number | null }
  | { type: 'removeEntry'; entry_id: string }
  | { type: 'restore'; encounter: Encounter | null };

/** Why an encounter command is refused: an error code of the contract and its message. */
export interface EncounterRefusal {
  code: 'bad_request' | 'not_found' | 'order_mismatch';
  message: string;
}

export interface EncounterScene {
  sceneId: string;
  tokens: readonly EncounterToken[];
  fog: FogMask;
  newId: () => string;
}

/** The encounter after a change, or why it is refused; undefined when it would change nothing. */
export type EncounterDecision = { encounter: Encounter | null } | { refused: EncounterRefusal } | undefined;

const refusal = (code: EncounterRefusal['code'], message: string): EncounterDecision => ({
  refused: { code, message },
});

/** The encounter without the entry at `at`; the turn stays with the entry that had it, or passes to the next. */
export function withoutEntry(encounter: Encounter, at: number, view: TurnView): Encounter {
  const entries = encounter.entries.filter((_, index) => index !== at);
  if (at !== encounter.current_index) {
    const current = at < encounter.current_index ? encounter.current_index - 1 : encounter.current_index;
    return { ...encounter, entries, current_index: Math.min(current, Math.max(entries.length - 1, 0)) };
  }
  // The entry whose turn it was goes: the turn passes as Next would pass it, to the next entry that takes it,
  // counting a round past the last (TBL-06 review), never to an entry that must be passed over.
  const passed = stepTurn(encounter, view, 1);
  const id = passed === undefined ? undefined : encounter.entries[passed.current_index]?.id;
  const index = entries.findIndex((entry) => entry.id === id);
  if (passed === undefined || index === -1) return { ...encounter, entries, current_index: 0 };
  return { ...encounter, entries, current_index: index, round: passed.round };
}

/** The encounter marked as having had an enemy, once a monster or npc entry can take its turn (Q-118). */
export function notingEnemies(encounter: Encounter | null, view: TurnView): Encounter | null {
  return encounter !== null && encounter.active && !encounter.enemies_seen && enemiesCanAct(encounter, view)
    ? { ...encounter, enemies_seen: true }
    : encounter;
}

function decided(current: Encounter | null, change: EncounterChange, scene: EncounterScene): EncounterDecision {
  const { sceneId, tokens, fog, newId } = scene;
  const view = turnView(tokens, fog);
  if (change.type === 'restore') return { encounter: change.encounter };
  if (change.type === 'start') {
    if (current?.active) return refusal('bad_request', 'Combat is already running on this scene.');
    const entries = startTokens(tokens, fog).map((token): EncounterEntry => ({
      id: newId(),
      kind: entryKindOf(token)!,
      token_id: token.id,
      initiative: null,
    }));
    const encounter: Encounter = {
      id: current?.id ?? newId(),
      scene_id: sceneId,
      active: true,
      round: 1,
      current_index: firstTurn({ entries }, view),
      enemies_seen: false,
      entries,
    };
    return { encounter };
  }
  if (current === null || !current.active) return refusal('bad_request', 'No combat is running on this scene.');
  const { entries } = current;
  const reordered = (next: EncounterEntry[]): EncounterDecision => ({
    encounter: { ...current, entries: next, current_index: followTurn(entries, next, current.current_index) },
  });
  switch (change.type) {
    case 'end':
      return { encounter: { ...current, active: false, round: 1, current_index: 0, enemies_seen: false, entries: [] } };
    case 'reorder': {
      const byId = new Map(entries.map((entry) => [entry.id, entry]));
      const order = change.entry_ids.map((id) => byId.get(id));
      if (order.length !== entries.length || order.some((entry) => entry === undefined)) {
        return refusal('order_mismatch', 'The order must name every entry of the encounter once.');
      }
      return reordered(order as EncounterEntry[]);
    }
    case 'setInitiative': {
      if (!entries.some((entry) => entry.id === change.entry_id)) return refusal('not_found', 'No such entry.');
      return reordered(
        sortByInitiative(
          entries.map((entry) => (entry.id === change.entry_id ? { ...entry, initiative: change.initiative } : entry)),
        ),
      );
    }
    case 'next':
    case 'previous': {
      const turn = stepTurn(current, view, change.type === 'next' ? 1 : -1);
      return turn === undefined ? undefined : { encounter: { ...current, ...turn } };
    }
    case 'addEntry': {
      const token = tokens.find((candidate) => candidate.id === change.token_id);
      if (token === undefined) return refusal('not_found', 'No such token.');
      if (!canEnter(token, fog)) {
        return refusal(
          'bad_request',
          'Only a player character, or a monster or npc not carrying Dead, that players can see takes an entry.',
        );
      }
      if (entries.some((entry) => entry.token_id === token.id)) {
        return refusal('bad_request', 'This token already has an entry.');
      }
      const initiative = change.initiative ?? null;
      const added: EncounterEntry = { id: newId(), kind: entryKindOf(token)!, token_id: token.id, initiative };
      const at = insertionIndex(entries, initiative);
      return reordered([...entries.slice(0, at), added, ...entries.slice(at)]);
    }
    case 'removeEntry': {
      const at = entries.findIndex((entry) => entry.id === change.entry_id);
      if (at === -1) return refusal('not_found', 'No such entry.');
      return { encounter: withoutEntry(current, at, view) };
    }
  }
}

/**
 * What an encounter command does to the scene's encounter (specs/04-live-sync.md §14): the encounter after it,
 * marked as having had an enemy once a monster or npc entry can take its turn, or why it is refused; undefined
 * when it changes nothing, which tells nobody and is not undoable.
 */
export function changeOf(current: Encounter | null, change: EncounterChange, scene: EncounterScene): EncounterDecision {
  const decision = decided(current, change, scene);
  if (decision === undefined || 'refused' in decision) return decision;
  const after =
    change.type === 'restore'
      ? decision.encounter
      : notingEnemies(decision.encounter, turnView(scene.tokens, scene.fog));
  return JSON.stringify(after) === JSON.stringify(current) ? undefined : { encounter: after };
}
