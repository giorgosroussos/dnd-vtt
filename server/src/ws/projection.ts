import type Database from 'better-sqlite3';
import type { DmEvent, EventType, PlayerEvent, PlayerToken, SceneToken } from '@emberglass/shared';
import { listTokens } from '../db/tokens.js';
import type { LiveEffect } from '../domain/live.js';
import { readSnapshot, toPlayerToken } from './snapshot.js';

// The role-filtered projection of the live commands' effects (LIV-02; specs/04-live-sync.md §3,
// §4; D-039, D-049, Q-083, G-023, G-025). Built on the server, before anything is emitted, and
// never in a client. The `dm` room hears of every change; the `players` room only of visible
// tokens: adding, moving or deleting a hidden token sends it nothing, revealing a token reaches it as
// `token.added` and hiding one as `token.removed`, with exactly what a deletion sends. Its tokens
// are built by `toPlayerToken`, as the snapshot's are, with their rank among the visible tokens read
// from the database after the change. Called in the same synchronous step as the command, so the
// database it reads is the state the command left.

/** An event before it takes its room's version. */
export type Unversioned<E> = E extends { type: infer T; payload: infer P }
  ? { type: T & EventType; payload: P }
  : never;

export type RoomEvents = { dm?: Unversioned<DmEvent>; players?: Unversioned<PlayerEvent> };

export function project(db: Database.Database, effect: LiveEffect): RoomEvents {
  switch (effect.type) {
    case 'activated':
      return {
        dm: { type: 'scene.snapshot', payload: readSnapshot(db, 'dm') },
        players: { type: 'scene.snapshot', payload: readSnapshot(db, 'players') },
      };
    case 'cleared':
      return { dm: { type: 'scene.cleared', payload: {} }, players: { type: 'scene.cleared', payload: {} } };
    case 'token.added': {
      const dm = { type: 'token.added', payload: { token: effect.token, relabelled: effect.relabelled } } as const;
      if (effect.token.hidden) return { dm };
      return { dm, players: { type: 'token.added', payload: shown(db, effect.token, effect.relabelled) } };
    }
    case 'token.updated': {
      const dm = { type: 'token.updated', payload: { token: effect.token, relabelled: effect.relabelled } } as const;
      const { before, token } = effect;
      if (before.hidden && token.hidden) return { dm };
      if (before.hidden) return { dm, players: { type: 'token.added', payload: shown(db, token, effect.relabelled) } };
      if (token.hidden) return { dm, players: { type: 'token.removed', payload: { id: token.id } } };
      return {
        dm,
        players: { type: 'token.updated', payload: { token: playerTokens(db, token.scene_id, [token])[0]! } },
      };
    }
    case 'token.removed': {
      const dm = { type: 'token.removed', payload: { id: effect.token.id } } as const;
      if (effect.token.hidden) return { dm };
      return { dm, players: { type: 'token.removed', payload: { id: effect.token.id } } };
    }
  }
}

/** A token shown to players, with the visible token it renamed, if any (G-023). */
function shown(db: Database.Database, token: SceneToken, relabelled: readonly SceneToken[]) {
  // A renamed token is always visible (Q-092), but a hidden one would never be sent regardless.
  const [first, ...renamed] = playerTokens(db, token.scene_id, [token, ...relabelled.filter((each) => !each.hidden)]);
  return { token: first!, relabelled: renamed };
}

/** The given visible tokens as players receive them, ranked among the scene's visible tokens now. */
function playerTokens(db: Database.Database, sceneId: string, tokens: readonly SceneToken[]): PlayerToken[] {
  const ranks = new Map(
    (listTokens(db, sceneId) ?? []).filter((each) => !each.hidden).map((each, rank) => [each.id, rank]),
  );
  return tokens.map((token) => {
    const rank = ranks.get(token.id);
    // Only a visible token of the scene has a rank; anything else here would be a bug that leaks.
    if (rank === undefined) throw new Error('A token that players cannot see was about to be sent to them.');
    return toPlayerToken(token, rank);
  });
}
