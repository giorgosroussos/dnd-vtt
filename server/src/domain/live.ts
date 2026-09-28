import type Database from 'better-sqlite3';
import {
  errorEnvelope,
  type CameraSetPlayerPayload,
  type CommandEnvelope,
  type ErrorEnvelope,
  type SceneActivatePayload,
  type SceneToken,
  type TokenAddPayload,
  type TokenDeletePayload,
  type TokenMovePayload,
  type TokenSetVisibilityPayload,
} from '@emberglass/shared';
import { readSettings, setLiveScene } from '../db/settings.js';
import { createToken, deleteToken, readToken, restoreToken, updateToken } from '../db/tokens.js';
import { PlayerCameraState, sameCamera } from './camera.js';
import { inverseOf, UndoHistory, type Inverse } from './undo.js';

// The live commands (LIV-02; specs/04-live-sync.md §2, specs/05-assets-and-images.md §3, §4,
// Q-014, Q-092, D-064). Each is applied to the database in one transaction, last write wins: no
// version or base state is compared, so of two DM browsers' conflicting moves the one the server
// applies last stands. A token command acts only on a token of the live scene and is refused as
// `scene_not_live` otherwise; `token.add` also names the scene it means, refused the same way when
// that scene is no longer live. What changed is answered as effects, in the DM's terms; the socket
// layer projects each into what each room receives (`server/src/ws/projection.ts`). A refused
// command changes nothing and has no effect.
//
// Undo (LIV-05, specs/04-live-sync.md §8, D-040, D-117): `createLiveCommands` keeps the undo history
// beside the database and answers `undo` by applying the most recent inverse through the same steps
// as the command it stands for, so its effects, and what each room receives, are that command's.

export type LiveEffect =
  /** A scene was made live: every client gets a fresh snapshot (D-039). */
  | { type: 'activated' }
  /** The live scene was cleared: the player view goes idle. */
  | { type: 'cleared' }
  | { type: 'token.added'; token: SceneToken; relabelled: SceneToken[] }
  | { type: 'token.updated'; before: SceneToken; token: SceneToken; relabelled: SceneToken[] }
  | { type: 'token.removed'; token: SceneToken }
  /** The player camera was set (LIV-06): both rooms receive `camera.player`. */
  | { type: 'camera' };

export type LiveResult = LiveEffect[] | ErrorEnvelope;

const tokenNotFound = (): ErrorEnvelope => errorEnvelope('not_found', 'No such token.');
const notLive = (): ErrorEnvelope => errorEnvelope('scene_not_live', 'The scene is not live.');

/** Applies a valid live command; the envelope and payload were checked against their schemas. */
export function applyLiveCommand(db: Database.Database, command: CommandEnvelope): LiveResult {
  switch (command.type) {
    case 'token.add': {
      const { scene_id, asset_id, x, y } = command.payload as TokenAddPayload;
      const result = createToken(db, scene_id, { asset_id, x, y }, 'live');
      // An unknown scene cannot be the live one: said as not live, as for a scene that exists.
      if (result.outcome === 'not_found' || result.outcome === 'not_live' || result.outcome === 'live') {
        return notLive();
      }
      if (result.outcome === 'asset_not_found')
        return errorEnvelope('reference_not_found', 'The asset does not exist.');
      return [{ type: 'token.added', token: result.token, relabelled: result.relabelled }];
    }
    case 'token.move': {
      const { token_id, x, y } = command.payload as TokenMovePayload;
      return changed(updateToken(db, token_id, { x, y }, 'live'));
    }
    case 'token.setVisibility': {
      const { token_id, hidden } = command.payload as TokenSetVisibilityPayload;
      const result = updateToken(db, token_id, { hidden }, 'live');
      // Hiding a hidden token or revealing a visible one changes nothing, so nobody is told.
      if (result.outcome === 'updated' && result.before.hidden === hidden) return [];
      return changed(result);
    }
    case 'token.delete': {
      const { token_id } = command.payload as TokenDeletePayload;
      const result = deleteToken(db, token_id, 'live');
      if (result.outcome === 'not_found') return tokenNotFound();
      if (result.outcome !== 'deleted') return notLive();
      return [{ type: 'token.removed', token: result.token }];
    }
    case 'scene.activate': {
      const { scene_id } = command.payload as SceneActivatePayload;
      const result = setLiveScene(db, scene_id);
      if (result.outcome === 'not_found') return errorEnvelope('not_found', 'No such scene.');
      return [{ type: 'activated' }];
    }
    case 'scene.deactivate': {
      const result = setLiveScene(db, null);
      // Possible at any time (specs/04-live-sync.md §2); with nothing live there is nothing to tell.
      return result.outcome === 'set' && result.previous !== null ? [{ type: 'cleared' }] : [];
    }
    default:
      // Validation refuses every type without a payload schema, and `undo` is answered by
      // `createLiveCommands`, so this is never reached.
      return errorEnvelope('command_unsupported', 'This command is not supported yet.');
  }
}

/**
 * Applies an inverse from the undo history as the command it is. The reveal that undoes a hide keeps
 * the token's label: the token was shown with it, so it is not numbered as a first showing would be
 * (specs/05-assets-and-images.md §3, Q-092, D-117), and a lone "Goblin" hidden and undone is "Goblin"
 * again.
 */
export function applyInverse(db: Database.Database, inverse: Inverse): LiveResult {
  if (inverse.type === 'token.setVisibility' && !inverse.payload.hidden) {
    const current = readToken(db, inverse.payload.token_id);
    if (current === undefined) return tokenNotFound();
    const result = updateToken(db, current.id, { hidden: false, label: current.label }, 'live');
    if (result.outcome === 'updated' && !result.before.hidden) return [];
    return changed(result);
  }
  if (inverse.type !== 'token.add') return applyLiveCommand(db, inverse);
  const result = restoreToken(db, inverse.restore, 'live');
  switch (result.outcome) {
    case 'restored':
      return [{ type: 'token.added', token: result.token, relabelled: [] }];
    case 'asset_not_found':
      return errorEnvelope('reference_not_found', 'The asset does not exist.');
    default:
      return notLive();
  }
}

export interface LiveCommands {
  apply: (command: CommandEnvelope) => LiveResult;
  /** The undo history, for the tests. */
  history: UndoHistory;
  /** The player camera, which the snapshots read. */
  camera: PlayerCameraState;
}

/**
 * The live commands with their undo history (LIV-05). An undoable command that changed something
 * records its inverse for the live scene. Activating another scene, deactivating, and a live scene
 * deleted over REST (seen as the live scene having changed when the history is next used) empty it
 * (Q-005, D-117). `undo` with nothing to undo is acknowledged and tells nobody; an inverse that no
 * longer applies (its token deleted by another DM browser, its asset deleted) is dropped and refused
 * as the command it stands for would be, changing nothing.
 *
 * The player camera (LIV-06, specs/04-live-sync.md §9, Q-038, D-018) is kept beside it: every
 * activation, of the live scene too, and every deactivation reset it to fit-to-map. `camera.setPlayer`
 * is refused as `scene_not_live` unless it names the live scene, tells nobody when the camera is
 * already that one, and is never undoable (§2).
 */
export function createLiveCommands(
  db: Database.Database,
  history = new UndoHistory(),
  camera = new PlayerCameraState(),
): LiveCommands {
  const liveSceneId = () => readSettings(db).live_scene_id;
  const apply = (command: CommandEnvelope): LiveResult => {
    switch (command.type) {
      case 'undo': {
        const inverse = history.pop(liveSceneId());
        return inverse === undefined ? [] : applyInverse(db, inverse);
      }
      case 'scene.activate':
      case 'scene.deactivate': {
        const result = applyLiveCommand(db, command);
        if (Array.isArray(result)) {
          history.keepOnly(liveSceneId());
          camera.reset();
        }
        return result;
      }
      case 'camera.setPlayer': {
        const { scene_id, camera: next } = command.payload as CameraSetPlayerPayload;
        const live = liveSceneId();
        if (live === null || live !== scene_id) return notLive();
        if (sameCamera(camera.of(live), next)) return [];
        camera.set(live, next);
        return [{ type: 'camera' }];
      }
      default: {
        const result = applyLiveCommand(db, command);
        const live = liveSceneId();
        const inverse = Array.isArray(result) ? inverseOf(command, result) : undefined;
        if (inverse !== undefined && live !== null) history.record(live, inverse);
        return result;
      }
    }
  };
  return { apply, history, camera };
}

function changed(result: ReturnType<typeof updateToken>): LiveResult {
  if (result.outcome === 'not_found') return tokenNotFound();
  if (result.outcome !== 'updated') return notLive();
  return [{ type: 'token.updated', before: result.before, token: result.token, relabelled: result.relabelled }];
}
