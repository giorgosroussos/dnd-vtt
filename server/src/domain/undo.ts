import type {
  CommandEnvelope,
  SceneToken,
  TokenDeletePayload,
  TokenMovePayload,
  TokenSetVisibilityPayload,
} from '@emberglass/shared';
import type { LiveEffect } from './live.js';

// The DM's undo history (LIV-05; specs/04-live-sync.md §8, Q-005, Q-050, D-040, D-117). The server
// keeps, in memory only, the inverse of every undoable command applied to the live scene: `token.add`,
// `token.move`, `token.setVisibility` and `token.delete`. Setup edits over REST are not commands and
// never enter it (Q-050). It belongs to one live scene and is emptied whenever the live scene changes
// (another scene activated, Blank TV, the live scene deleted), holds the last 100 inverses, and dies
// with the process. One history serves every DM browser: undo takes back the most recent command on
// the live scene, whoever sent it (D-040).

/**
 * What undoes a command: itself a live token command, applied through the ordinary command path so
 * that each room receives exactly what that command sends. Undoing a deletion is `token.add` in its
 * restoring form, which puts the same token back (id, label, position, visibility, stacking); it
 * exists only on the server, never on the wire, whose `token.add` names an asset and a place only.
 */
export type Inverse =
  | { type: 'token.move'; payload: TokenMovePayload }
  | { type: 'token.setVisibility'; payload: TokenSetVisibilityPayload }
  | { type: 'token.delete'; payload: TokenDeletePayload }
  | { type: 'token.add'; restore: SceneToken; shown: boolean };

export const UNDO_LIMIT = 100;

/**
 * The inverse of an applied command, from what it changed; undefined when there is nothing to undo:
 * a command that is not undoable, or one that changed nothing (hiding a hidden token, moving a token
 * to where it was), which would
 * otherwise make the next Ctrl+Z do nothing visible.
 */
export function inverseOf(command: CommandEnvelope, effects: readonly LiveEffect[]): Inverse | undefined {
  const [effect] = effects;
  if (effect === undefined) return undefined;
  switch (command.type) {
    case 'token.add':
      return effect.type === 'token.added'
        ? { type: 'token.delete', payload: { token_id: effect.token.id } }
        : undefined;
    case 'token.move':
      // A drop back where the token was (a drag that snapped to its own square) moved nothing.
      return effect.type === 'token.updated' &&
        (effect.before.x !== effect.token.x || effect.before.y !== effect.token.y)
        ? { type: 'token.move', payload: { token_id: effect.token.id, x: effect.before.x, y: effect.before.y } }
        : undefined;
    case 'token.setVisibility':
      return effect.type === 'token.updated'
        ? { type: 'token.setVisibility', payload: { token_id: effect.token.id, hidden: effect.before.hidden } }
        : undefined;
    case 'token.delete':
      return effect.type === 'token.removed'
        ? { type: 'token.add', restore: effect.token, shown: effect.shown }
        : undefined;
    default:
      return undefined;
  }
}

export class UndoHistory {
  private scene: string | null = null;
  private readonly inverses: Inverse[] = [];

  constructor(private readonly limit = UNDO_LIMIT) {}

  /** How many inverses are held. */
  get size(): number {
    return this.inverses.length;
  }

  /** The live scene the history belongs to, or null while it is empty. */
  get sceneId(): string | null {
    return this.scene;
  }

  /** Keeps the inverse of a command applied to live scene `sceneId`, dropping the oldest past the limit. */
  record(sceneId: string, inverse: Inverse): void {
    this.keepOnly(sceneId);
    this.scene = sceneId;
    this.inverses.push(inverse);
    if (this.inverses.length > this.limit) this.inverses.splice(0, this.inverses.length - this.limit);
  }

  /** Takes the most recent inverse, if the history belongs to `liveSceneId`; otherwise it is emptied. */
  pop(liveSceneId: string | null): Inverse | undefined {
    this.keepOnly(liveSceneId);
    const inverse = this.inverses.pop();
    if (this.inverses.length === 0) this.scene = null;
    return inverse;
  }

  /** Empties the history unless it belongs to `liveSceneId`. */
  keepOnly(liveSceneId: string | null): void {
    if (this.scene !== null && this.scene !== liveSceneId) this.clear();
  }

  clear(): void {
    this.scene = null;
    this.inverses.length = 0;
  }
}
