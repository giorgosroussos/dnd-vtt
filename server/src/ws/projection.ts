import type Database from 'better-sqlite3';
import type { DmEvent, EventType, PlayerEvent, PlayerToken, SceneToken } from '@emberglass/shared';
import { readFog, sightOf } from '../db/fog.js';
import { readSettings } from '../db/settings.js';
import { listTokens } from '../db/tokens.js';
import type { LiveEffect } from '../domain/live.js';
import { readScene } from '../db/campaigns.js';
import { readEncounter } from '../db/encounters.js';
import { liveMeasurement, readSnapshot, toPlayerToken, type LiveMemory } from './snapshot.js';

// The role-filtered projection of the live commands' effects (LIV-02; specs/04-live-sync.md §3,
// §4; D-039, D-049, Q-083, G-023, G-025). Built on the server, before anything is emitted, and
// never in a client. The `dm` room hears of every change; the `players` room only of visible
// tokens: adding, moving or deleting a hidden token sends it nothing, revealing a token reaches it as
// `token.added` and hiding one as `token.removed`, with exactly what a deletion sends. Its tokens
// are built by `toPlayerToken`, as the snapshot's are, with their rank among the visible tokens read
// from the database after the change. Called in the same synchronous step as the command, so the
// database it reads is the state the command left. The player camera (LIV-06) and the ruler (LIV-07)
// reach both rooms alike, as a ping does (TBL-01): they say nothing of any token.
//
// Fog (TBL-04, specs/04-live-sync.md §4, §13): "visible" here is what players see, a token not hidden
// whose centre is under no fogged cell, judged by the fog as it stands after the change, which a token
// command never changes. A move into the fog reaches players as `token.removed`, a move out of it as
// `token.added`. A change to the painted fog reaches both rooms as the whole mask (`fog.updated`), which
// names no token; the tokens it covered or showed follow as their own effects.
//
// The encounter (TBL-06, specs/04-live-sync.md §4, §14): the DM's room hears every change to it; what players
// see of it is a projection of what they already see, sent when it changes (ws/live.ts).

/** An event before it takes its room's version. */
export type Unversioned<E> = E extends { type: infer T; payload: infer P }
  ? { type: T & EventType; payload: P }
  : never;

export type RoomEvents = { dm?: Unversioned<DmEvent>; players?: Unversioned<PlayerEvent> };

export function project(db: Database.Database, effect: LiveEffect, memory: LiveMemory): RoomEvents {
  switch (effect.type) {
    case 'activated':
      return {
        dm: { type: 'scene.snapshot', payload: readSnapshot(db, 'dm', memory) },
        players: { type: 'scene.snapshot', payload: readSnapshot(db, 'players', memory) },
      };
    case 'camera': {
      // The camera of the live scene, to both rooms (specs/04-live-sync.md §3); the screen shape the
      // frame follows to the DM's only (D-119).
      const camera = memory.camera.of(readSettings(db).live_scene_id);
      return {
        dm: { type: 'camera.player', payload: { camera: { ...camera }, screen: memory.screens.chosen() } },
        players: { type: 'camera.player', payload: { camera: { ...camera } } },
      };
    }
    case 'cleared':
      return { dm: { type: 'scene.cleared', payload: {} }, players: { type: 'scene.cleared', payload: {} } };
    case 'ruler': {
      // The same measurement to both rooms (specs/04-live-sync.md §3, §11): two squares and the feet.
      const id = readSettings(db).live_scene_id;
      const scene = id === null ? undefined : readScene(db, id);
      const ruler = scene && liveMeasurement(db, scene, memory);
      if (!ruler) return {};
      return {
        dm: { type: 'ruler.shown', payload: { ruler } },
        players: { type: 'ruler.shown', payload: { ruler: structuredClone(ruler) } },
      };
    }
    case 'ruler.cleared':
      return { dm: { type: 'ruler.cleared', payload: {} }, players: { type: 'ruler.cleared', payload: {} } };
    case 'ping':
      // The same point to both rooms (TBL-01, specs/04-live-sync.md §12): it names no token.
      return {
        dm: { type: 'ping', payload: { x: effect.x, y: effect.y } },
        players: { type: 'ping', payload: { x: effect.x, y: effect.y } },
      };
    case 'token.added': {
      const dm = { type: 'token.added', payload: { token: effect.token, relabelled: effect.relabelled } } as const;
      if (!sightOf(db, effect.token.scene_id)(effect.token)) return { dm };
      return { dm, players: { type: 'token.added', payload: shown(db, effect.token, effect.relabelled) } };
    }
    case 'token.updated': {
      const dm = { type: 'token.updated', payload: { token: effect.token, relabelled: effect.relabelled } } as const;
      const { before, token } = effect;
      const seen = sightOf(db, token.scene_id);
      const [was, is] = [seen(before), seen(token)];
      if (!was && !is) return { dm };
      if (!was) return { dm, players: { type: 'token.added', payload: shown(db, token, effect.relabelled) } };
      if (!is) return { dm, players: { type: 'token.removed', payload: { id: token.id } } };
      return {
        dm,
        players: { type: 'token.updated', payload: { token: playerTokens(db, token.scene_id, [token])[0]! } },
      };
    }
    case 'token.removed': {
      const dm = { type: 'token.removed', payload: { id: effect.token.id } } as const;
      // Judged where it stood when deleted, under the fog as it is.
      if (!sightOf(db, effect.token.scene_id)(effect.token)) return { dm };
      return { dm, players: { type: 'token.removed', payload: { id: effect.token.id } } };
    }
    case 'fog.changed':
      return {
        dm: { type: 'fog.updated', payload: { fog: readFog(db, effect.sceneId) } },
        players: { type: 'fog.updated', payload: { fog: readFog(db, effect.sceneId) } },
      };
    case 'token.appeared':
      return {
        ...(effect.renamed
          ? { dm: { type: 'token.updated', payload: { token: effect.token, relabelled: effect.relabelled } } }
          : {}),
        players: { type: 'token.added', payload: shown(db, effect.token, effect.relabelled) },
      };
    case 'token.vanished':
      return { players: { type: 'token.removed', payload: { id: effect.token.id } } };
    case 'encounter.changed':
      // The DM's room hears the whole encounter as it is stored now (TBL-06). Players hear their projection
      // only when it changed, whatever command changed it: compared around each command in ws/live.ts.
      return { dm: { type: 'encounter.updated', payload: { encounter: readEncounter(db, effect.sceneId) } } };
  }
}

/** A token shown to players, with the visible token it renamed, if any (G-023). */
function shown(db: Database.Database, token: SceneToken, relabelled: readonly SceneToken[]) {
  // A renamed token is always one players see (Q-092, TBL-03), but one they cannot would never be sent regardless.
  const seen = sightOf(db, token.scene_id);
  const [first, ...renamed] = playerTokens(db, token.scene_id, [token, ...relabelled.filter(seen)]);
  return { token: first!, relabelled: renamed };
}

/** The given tokens players see as they receive them, ranked among the scene's tokens they see now. */
function playerTokens(db: Database.Database, sceneId: string, tokens: readonly SceneToken[]): PlayerToken[] {
  const ranks = new Map(
    (listTokens(db, sceneId) ?? []).filter(sightOf(db, sceneId)).map((each, rank) => [each.id, rank]),
  );
  return tokens.map((token) => {
    const rank = ranks.get(token.id);
    // Only a visible token of the scene has a rank; anything else here would be a bug that leaks.
    if (rank === undefined) throw new Error('A token that players cannot see was about to be sent to them.');
    return toPlayerToken(token, rank);
  });
}
