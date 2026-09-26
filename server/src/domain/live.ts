import type Database from 'better-sqlite3';
import {
  errorEnvelope,
  type CommandEnvelope,
  type ErrorEnvelope,
  type SceneActivatePayload,
  type SceneToken,
  type TokenAddPayload,
  type TokenDeletePayload,
  type TokenMovePayload,
  type TokenSetVisibilityPayload,
} from '@emberglass/shared';
import { setLiveScene } from '../db/settings.js';
import { createToken, deleteToken, updateToken } from '../db/tokens.js';

// The live commands (LIV-02; specs/04-live-sync.md §2, specs/05-assets-and-images.md §3, §4,
// Q-014, Q-092, D-064). Each is applied to the database in one transaction, last write wins: no
// version or base state is compared, so of two DM browsers' conflicting moves the one the server
// applies last stands. A token command acts only on a token of the live scene and is refused as
// `scene_not_live` otherwise; `token.add` also names the scene it means, refused the same way when
// that scene is no longer live. What changed is answered as effects, in the DM's terms; the socket
// layer projects each into what each room receives (`server/src/ws/projection.ts`). A refused
// command changes nothing and has no effect.

export type LiveEffect =
  /** A scene was made live: every client gets a fresh snapshot (D-039). */
  | { type: 'activated' }
  /** The live scene was cleared: the player view goes idle. */
  | { type: 'cleared' }
  | { type: 'token.added'; token: SceneToken; relabelled: SceneToken[] }
  | { type: 'token.updated'; before: SceneToken; token: SceneToken; relabelled: SceneToken[] }
  | { type: 'token.removed'; token: SceneToken };

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
      // Validation refuses every type without a payload schema, so this is never reached.
      return errorEnvelope('command_unsupported', 'This command is not supported yet.');
  }
}

function changed(result: ReturnType<typeof updateToken>): LiveResult {
  if (result.outcome === 'not_found') return tokenNotFound();
  if (result.outcome !== 'updated') return notLive();
  return [{ type: 'token.updated', before: result.before, token: result.token, relabelled: result.relabelled }];
}
