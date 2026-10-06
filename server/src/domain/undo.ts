import type {
  CommandEnvelope,
  Encounter,
  FogMask,
  SceneToken,
  TokenDeletePayload,
  TokenMovePayload,
  TokenSetMarkersPayload,
  TokenSetVisibilityPayload,
  TokenMarker,
  TokenStats,
} from '@emberglass/shared';
import type { LiveEffect } from './live.js';

// The DM's undo history (LIV-05; specs/04-live-sync.md §8, Q-005, Q-050, D-040, D-117). The server
// keeps, in memory only, the inverse of every undoable command applied to the live scene: `token.add`,
// `token.move`, `token.setVisibility`, `token.setMarkers` (TBL-02), `token.delete`, the fog commands
// (TBL-04), the encounter commands (TBL-06), the hit-point commands (DMT-01) and `token.batch` (UXR-02), one step. Setup edits over REST are not commands and
// never enter it (Q-050). It belongs to one live scene and is emptied whenever the live scene changes
// (another scene activated, Blank TV, the live scene deleted), holds the last 100 inverses, and dies
// with the process. One history serves every DM browser: undo takes back the most recent command on
// the live scene, whoever sent it (D-040).
//
// Redo (UIX-01, specs/04-live-sync.md §8): each undo that changed something keeps what would undo the
// undo, on a redo stack beside the history; `redo` applies the most recent one and records its inverse
// back into the history, so Ctrl+Z undoes it again. Any new undoable command that changes something
// empties the redo stack, as does everything that empties the history. A command that is not undoable
// (the camera, the ruler, a ping) leaves both alone: it changes no token.

/**
 * What undoes a command: itself a live token command, applied through the ordinary command path so
 * that each room receives exactly what that command sends. Undoing a deletion is `token.add` in its
 * restoring form, which puts the same token back (id, label, position, visibility, stacking); it
 * exists only on the server, never on the wire, whose `token.add` names an asset and a place only.
 */
export type Inverse =
  | { type: 'token.move'; payload: TokenMovePayload }
  | { type: 'token.setVisibility'; payload: TokenSetVisibilityPayload }
  | { type: 'token.setMarkers'; payload: TokenSetMarkersPayload }
  // `token.setStats` and `token.applyHp` (DMT-01): undone by putting the four fields and the markers back together,
  // so one undo takes back the markers the hit points set; not on the wire.
  | { type: 'token.restoreStats'; payload: { token_id: string; stats: TokenStats; markers: TokenMarker[] } }
  | { type: 'token.delete'; payload: TokenDeletePayload }
  // `encounter`: the scene's encounter before the deletion took the token's entry, put back with it (TBL-06).
  | { type: 'token.add'; restore: SceneToken; shown: boolean; encounter?: Encounter }
  // The painted fog (TBL-04): a stroke, a fill or a clear is undone by putting the whole mask back as it
  // was, which is not on the wire.
  | { type: 'fog.restore'; scene_id: string; restore: FogMask }
  // The encounter (TBL-06): every encounter command is undone by putting the whole encounter back as it
  // was, or taking it away when the scene had none; not on the wire either.
  | { type: 'encounter.restore'; scene_id: string; restore: Encounter | null }
  // A `token.batch` (UXR-02, Q-123): the inverses of its commands in their order, replayed last first in one
  // transaction, so one undo takes back the whole group; not on the wire.
  | { type: 'batch'; inverses: Inverse[] };

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
    case 'token.setMarkers':
      // The markers it carried before: a set that changed nothing never gets here, as it has no effect.
      return effect.type === 'token.updated'
        ? { type: 'token.setMarkers', payload: { token_id: effect.token.id, markers: [...effect.before.markers] } }
        : undefined;
    case 'token.setStats':
    case 'token.applyHp':
    case 'token.restoreStats' as CommandEnvelope['type']:
      return effect.type === 'token.updated'
        ? {
            type: 'token.restoreStats',
            payload: {
              token_id: effect.token.id,
              stats: {
                hp_current: effect.before.hp_current,
                hp_max: effect.before.hp_max,
                hp_temp: effect.before.hp_temp,
                ac: effect.before.ac,
              },
              markers: [...effect.before.markers],
            },
          }
        : undefined;
    case 'fog.paint':
    case 'fog.fill':
    case 'fog.restore' as CommandEnvelope['type']:
      return effect.type === 'fog.changed'
        ? { type: 'fog.restore', scene_id: effect.sceneId, restore: effect.before }
        : undefined;
    case 'encounter.start':
    case 'encounter.end':
    case 'encounter.reorder':
    case 'encounter.setInitiative':
    case 'encounter.next':
    case 'encounter.previous':
    case 'encounter.addEntry':
    case 'encounter.removeEntry':
    case 'encounter.restore' as CommandEnvelope['type']:
      return effect.type === 'encounter.changed'
        ? { type: 'encounter.restore', scene_id: effect.sceneId, restore: effect.before }
        : undefined;
    case 'token.delete': {
      if (effect.type !== 'token.removed') return undefined;
      // The entry the deletion took, if any, comes back with the token.
      const entry = effects.find((each) => each.type === 'encounter.changed');
      return entry?.type === 'encounter.changed' && entry.before !== null
        ? { type: 'token.add', restore: effect.token, shown: effect.shown, encounter: entry.before }
        : { type: 'token.add', restore: effect.token, shown: effect.shown };
    }
    default:
      return undefined;
  }
}

/**
 * What undoes an inverse just applied, from what it changed: the inverse of the command it stands
 * for, read the same way as `inverseOf` reads a command's effects. Undoing a restore (`token.add` in
 * its restoring form) is deleting the token again.
 */
export function inverseOfInverse(inverse: Inverse, effects: readonly LiveEffect[]): Inverse | undefined {
  const command = { type: inverse.type, payload: 'payload' in inverse ? inverse.payload : {} } as CommandEnvelope;
  return inverseOf(command, effects);
}

export class UndoHistory {
  private scene: string | null = null;
  private readonly inverses: Inverse[] = [];
  private readonly redos: Inverse[] = [];

  constructor(private readonly limit = UNDO_LIMIT) {}

  /** How many inverses are held. */
  get size(): number {
    return this.inverses.length;
  }

  /** The live scene the history belongs to, or null while it is empty. */
  get sceneId(): string | null {
    return this.scene;
  }

  /** How many undone commands `redo` can apply again. */
  get redoSize(): number {
    return this.redos.length;
  }

  /**
   * Keeps the inverse of a command applied to live scene `sceneId`, dropping the oldest past the limit.
   * A new command empties the redo stack; the inverse of a redo (`redone`) keeps it.
   */
  record(sceneId: string, inverse: Inverse, redone = false): void {
    this.keepOnly(sceneId);
    this.scene = sceneId;
    this.inverses.push(inverse);
    if (this.inverses.length > this.limit) this.inverses.splice(0, this.inverses.length - this.limit);
    if (!redone) this.redos.length = 0;
  }

  /** Takes the most recent inverse, if the history belongs to `liveSceneId`; otherwise it is emptied. */
  pop(liveSceneId: string | null): Inverse | undefined {
    this.keepOnly(liveSceneId);
    const inverse = this.inverses.pop();
    this.settle();
    return inverse;
  }

  /** Keeps what redoes an undo applied to live scene `sceneId`, bounded like the history. */
  recordRedo(sceneId: string, redo: Inverse): void {
    this.keepOnly(sceneId);
    this.scene = sceneId;
    this.redos.push(redo);
    if (this.redos.length > this.limit) this.redos.splice(0, this.redos.length - this.limit);
  }

  /** Takes the most recent redo, if the history belongs to `liveSceneId`; otherwise it is emptied. */
  popRedo(liveSceneId: string | null): Inverse | undefined {
    this.keepOnly(liveSceneId);
    const redo = this.redos.pop();
    this.settle();
    return redo;
  }

  /** Whether undo and redo would find anything for live scene `liveSceneId` (UIX-01). */
  stateFor(liveSceneId: string | null): { can_undo: boolean; can_redo: boolean } {
    const mine = this.scene !== null && this.scene === liveSceneId;
    return { can_undo: mine && this.inverses.length > 0, can_redo: mine && this.redos.length > 0 };
  }

  /** Forgets the scene once nothing is held for it. */
  private settle(): void {
    if (this.inverses.length === 0 && this.redos.length === 0) this.scene = null;
  }

  /** Empties the history unless it belongs to `liveSceneId`. */
  keepOnly(liveSceneId: string | null): void {
    if (this.scene !== null && this.scene !== liveSceneId) this.clear();
  }

  clear(): void {
    this.scene = null;
    this.inverses.length = 0;
    this.redos.length = 0;
  }
}
