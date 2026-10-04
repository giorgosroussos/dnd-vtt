import type Database from 'better-sqlite3';
import {
  applyHp,
  repeatsCondition,
  sameMarkers,
  sameStats,
  statsOf,
  errorEnvelope,
  type CameraSetPlayerPayload,
  type CommandEnvelope,
  type Encounter,
  type EncounterChange,
  type EncounterAddEntryPayload,
  type EncounterRemoveEntryPayload,
  type EncounterReorderPayload,
  type EncounterScenePayload,
  type EncounterSetInitiativePayload,
  type ErrorEnvelope,
  type PingPayload,
  type FogFillPayload,
  type FogMask,
  type FogPaintPayload,
  type RulerClearPayload,
  type RulerUpdatePayload,
  type SceneActivatePayload,
  type SceneToken,
  type TokenAddPayload,
  type TokenDeletePayload,
  type TokenMovePayload,
  type TokenApplyHpPayload,
  type TokenSetMarkersPayload,
  type TokenSetStatsPayload,
  type TokenSetVisibilityPayload,
} from '@emberglass/shared';
import { changeEncounter, noteEnemies, type EncounterOutcome } from '../db/encounters.js';
import { writeFog, type FogWriteOutcome } from '../db/fog.js';
import { readSettings, setLiveScene } from '../db/settings.js';
import { refusal } from '../db/scope.js';
import { createToken, deleteToken, readToken, restoreToken, updateToken } from '../db/tokens.js';
import { PlayerCameraState, sameCamera } from './camera.js';
import { RulerState, samePath } from './ruler.js';
import { inverseOf, inverseOfInverse, UndoHistory, type Inverse } from './undo.js';

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
  // `shown` is for the undo that puts the token back; the projection sends only the id.
  | { type: 'token.removed'; token: SceneToken; shown: boolean }
  /** The player camera was set (LIV-06): both rooms receive `camera.player`. */
  | { type: 'camera' }
  /** A measurement is shown on the live scene (LIV-07): both rooms receive `ruler.shown`. */
  | { type: 'ruler' }
  /** The measurement was taken off: both rooms receive `ruler.cleared`. */
  | { type: 'ruler.cleared' }
  /** A point of the live scene was pinged (TBL-01): both rooms receive `ping`; nothing keeps it. */
  | { type: 'ping'; x: number; y: number }
  /**
   * The painted fog changed (TBL-04): both rooms receive the whole mask. `before` and `fog` are the mask
   * before and after, which undo and redo put back.
   */
  | { type: 'fog.changed'; sceneId: string; before: FogMask; fog: FogMask }
  /**
   * A token players now see because the fog changed (TBL-04): they receive `token.added`; the DM's room
   * hears of it only when its label, or `relabelled`'s, changed as it was first shown.
   */
  | { type: 'token.appeared'; token: SceneToken; relabelled: SceneToken[]; renamed: boolean }
  /** A token players no longer see because the fog covers it: they receive `token.removed`. */
  | { type: 'token.vanished'; token: SceneToken }
  /**
   * The live scene's encounter changed (TBL-06): the DM's room receives the whole of it. `before` is what
   * undo puts back. Players hear of it through their projection, compared before and after each command.
   */
  | { type: 'encounter.changed'; sceneId: string; before: Encounter | null; encounter: Encounter | null };

export type LiveResult = LiveEffect[] | ErrorEnvelope;

const tokenNotFound = (): ErrorEnvelope => errorEnvelope('not_found', 'No such token.');

/**
 * The effects of a write to the fog: the mask's, then each token the fog now covers, then each it shows,
 * bottom of the stack first, so that players insert each at its rank, with the token its numbering renamed
 * if players saw that one already. A write that changed nothing has none. An unknown scene cannot be the
 * live one: said as not live, as for token.add.
 */
function fogChanged(result: FogWriteOutcome): LiveResult {
  if (result.outcome === 'unchanged') return [];
  if (result.outcome === 'too_large') return errorEnvelope('payload_too_large', 'The fog would be too large.');
  if (result.outcome !== 'written') return notLive();
  const { sceneId, before, fog, appeared, vanished } = result;
  return [
    { type: 'fog.changed', sceneId, before, fog },
    ...vanished.map((token): LiveEffect => ({ type: 'token.vanished', token })),
    ...appeared.map(({ token, relabelled, numbered }): LiveEffect => ({
      type: 'token.appeared',
      token,
      relabelled,
      // The DM's room hears of it only when a label changed as it was first shown.
      renamed: numbered || relabelled.length > 0,
    })),
  ];
}
const notLive = (): ErrorEnvelope => errorEnvelope('scene_not_live', 'The scene is not live.');

/** The effect of an encounter command (TBL-06); one that changes nothing tells nobody and is not undoable. */
function encounterChanged(result: EncounterOutcome): LiveResult {
  switch (result.outcome) {
    case 'unchanged':
      return [];
    case 'not_live':
      return notLive();
    case 'refused':
      return errorEnvelope(result.code, result.message);
    case 'changed':
      return [
        { type: 'encounter.changed', sceneId: result.sceneId, before: result.before, encounter: result.encounter },
      ];
  }
}

/** What each encounter command asks of the encounter (specs/04-live-sync.md §14). */
function encounterChange(command: CommandEnvelope): { sceneId: string; change: EncounterChange } | undefined {
  const { scene_id: sceneId } = command.payload as EncounterScenePayload;
  switch (command.type) {
    case 'encounter.start':
      return { sceneId, change: { type: 'start' } };
    case 'encounter.end':
      return { sceneId, change: { type: 'end' } };
    case 'encounter.next':
      return { sceneId, change: { type: 'next' } };
    case 'encounter.previous':
      return { sceneId, change: { type: 'previous' } };
    case 'encounter.reorder':
      return {
        sceneId,
        change: { type: 'reorder', entry_ids: (command.payload as EncounterReorderPayload).entry_ids },
      };
    case 'encounter.setInitiative': {
      const { entry_id, initiative } = command.payload as EncounterSetInitiativePayload;
      return { sceneId, change: { type: 'setInitiative', entry_id, initiative } };
    }
    case 'encounter.addEntry':
      return {
        sceneId,
        change: { type: 'addEntry', token_id: (command.payload as EncounterAddEntryPayload).token_id },
      };
    case 'encounter.removeEntry':
      return {
        sceneId,
        change: { type: 'removeEntry', entry_id: (command.payload as EncounterRemoveEntryPayload).entry_id },
      };
    default:
      return undefined;
  }
}

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
    case 'token.setMarkers': {
      // TBL-02: the whole set after the change; the same set as before changes nothing, so nobody is told.
      const { token_id, markers } = command.payload as TokenSetMarkersPayload;
      // Each condition once: Exhaustion at two levels passes the schema's uniqueItems, and is refused here.
      if (repeatsCondition(markers)) {
        return errorEnvelope('validation_failed', 'The payload does not match its schema.', [
          { path: '/markers', message: 'must name each condition at most once' },
        ]);
      }
      const result = updateToken(db, token_id, { markers }, 'live');
      if (result.outcome === 'updated' && sameMarkers(result.before.markers, result.token.markers)) return [];
      return changed(result);
    }
    case 'token.setStats': {
      // DMT-01: any of the four fields set or cleared; a change of hit points sets the markers they drive in the
      // same write (specs/04-live-sync.md §15). Values the token already has change nothing, so nobody is told.
      const { token_id, ...stats } = command.payload as TokenSetStatsPayload;
      return statsChanged(updateToken(db, token_id, stats, 'live'));
    }
    case 'token.applyHp': {
      // DMT-01: a signed amount, damage taking the temporary hit points first, healing never past the maximum.
      const { token_id, delta } = command.payload as TokenApplyHpPayload;
      const token = readToken(db, token_id);
      if (token === undefined) return tokenNotFound();
      const refused = refusal(db, token.scene_id, 'live');
      if (refused) return notLive();
      if (delta === 0) return [];
      const next = applyHp(token, delta);
      if (next === undefined) return errorEnvelope('bad_request', 'The token has no hit points.');
      return statsChanged(updateToken(db, token_id, next, 'live'));
    }
    case 'fog.paint': {
      // TBL-04: one stroke of the brush, painting or erasing; one that changes nothing tells nobody.
      const { scene_id, stroke } = command.payload as FogPaintPayload;
      return fogChanged(writeFog(db, scene_id, { stroke }, 'live'));
    }
    case 'fog.fill': {
      const { scene_id, fogged } = command.payload as FogFillPayload;
      return fogChanged(writeFog(db, scene_id, { fill: fogged }, 'live'));
    }
    case 'token.delete': {
      const { token_id } = command.payload as TokenDeletePayload;
      const result = deleteToken(db, token_id, 'live');
      if (result.outcome === 'not_found') return tokenNotFound();
      if (result.outcome !== 'deleted') return notLive();
      // The token's initiative entry goes with it (TBL-06), after the removal, which undo reads first.
      const removed: LiveEffect = { type: 'token.removed', token: result.token, shown: result.shown };
      if (result.encounter === undefined) return [removed];
      const { before, encounter } = result.encounter;
      return [removed, { type: 'encounter.changed', sceneId: result.token.scene_id, before, encounter }];
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
    default: {
      const asked = encounterChange(command);
      if (asked !== undefined) return encounterChanged(changeEncounter(db, asked.sceneId, asked.change));
      // Validation refuses every type without a payload schema, and `undo` is answered by
      // `createLiveCommands`, so this is never reached.
      return errorEnvelope('command_unsupported', 'This command is not supported yet.');
    }
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
  if (inverse.type === 'token.restoreStats') {
    // Hit points, armour class and the markers they set, put back together as they were (DMT-01).
    const { token_id, stats, markers } = inverse.payload;
    return statsChanged(updateToken(db, token_id, { ...stats, markers }, 'live'));
  }
  if (inverse.type === 'fog.restore') {
    return fogChanged(writeFog(db, inverse.scene_id, { restore: inverse.restore }, 'live'));
  }
  if (inverse.type === 'encounter.restore') {
    return encounterChanged(changeEncounter(db, inverse.scene_id, { type: 'restore', encounter: inverse.restore }));
  }
  if (inverse.type !== 'token.add') return applyLiveCommand(db, inverse);
  const result = restoreToken(db, inverse.restore, 'live', inverse.shown);
  switch (result.outcome) {
    case 'restored': {
      const added: LiveEffect = { type: 'token.added', token: result.token, relabelled: result.relabelled };
      if (inverse.encounter === undefined) return [added];
      // The entry the deletion took goes back with the token (TBL-06).
      const restored = changeEncounter(db, result.token.scene_id, { type: 'restore', encounter: inverse.encounter });
      const changed = encounterChanged(restored);
      return Array.isArray(changed) ? [added, ...changed] : [added];
    }
    case 'asset_not_found':
      return errorEnvelope('reference_not_found', 'The asset does not exist.');
    default:
      return notLive();
  }
}

export interface LiveCommands {
  /** Applies a valid command; `sender` names the DM socket it came from, which a measurement remembers. */
  apply: (command: CommandEnvelope, sender?: string) => LiveResult;
  /** A DM socket went: the measurement it drew, if still shown, is taken off the TV (D-121). */
  release: (sender: string) => LiveEffect[];
  /** The undo history, for the tests. */
  history: UndoHistory;
  /** The player camera, which the snapshots read. */
  camera: PlayerCameraState;
  /** The measurement shown on the TV, which the snapshots read. */
  ruler: RulerState;
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
 *
 * The ruler (LIV-07, specs/04-live-sync.md §2, §11, Q-027, Q-086, D-121) is kept there too, in memory
 * only: `ruler.update` and `ruler.clear` are refused as `scene_not_live` unless they name the live
 * scene, so a measurement on a scene that is not live never reaches the TV; a measurement already shown,
 * or a clear with nothing shown, tells nobody; neither is undoable. Every activation and deactivation
 * clear it, as does the DM socket that drew it going (`release`).
 */
export function createLiveCommands(
  db: Database.Database,
  history = new UndoHistory(),
  camera = new PlayerCameraState(),
  ruler = new RulerState(),
): LiveCommands {
  const liveSceneId = () => readSettings(db).live_scene_id;
  const apply = (command: CommandEnvelope, sender?: string): LiveResult => {
    switch (command.type) {
      case 'undo': {
        const live = liveSceneId();
        const inverse = history.pop(live);
        if (inverse === undefined) return [];
        const result = applyInverse(db, inverse);
        const redo = Array.isArray(result) ? inverseOfInverse(inverse, result) : undefined;
        if (redo !== undefined && live !== null) history.recordRedo(live, redo);
        return result;
      }
      case 'redo': {
        // As undo: the most recent undone command applied again through the ordinary path, its inverse
        // back in the history (UIX-01, specs/04-live-sync.md §8).
        const live = liveSceneId();
        const redo = history.popRedo(live);
        if (redo === undefined) return [];
        const result = applyInverse(db, redo);
        const inverse = Array.isArray(result) ? inverseOfInverse(redo, result) : undefined;
        if (inverse !== undefined && live !== null) history.record(live, inverse, true);
        return result;
      }
      case 'scene.activate':
      case 'scene.deactivate': {
        const result = applyLiveCommand(db, command);
        if (Array.isArray(result)) {
          history.keepOnly(liveSceneId());
          camera.reset();
          ruler.clear();
        }
        return result;
      }
      case 'ruler.update': {
        const { scene_id, from, to } = command.payload as RulerUpdatePayload;
        const live = liveSceneId();
        if (live === null || live !== scene_id) return notLive();
        const path = { from, to };
        const shown = samePath(ruler.of(live), path);
        // Whoever measured last owns the line, even when it is the same one (last write wins).
        ruler.set(live, path, sender);
        return shown ? [] : [{ type: 'ruler' }];
      }
      case 'ruler.clear': {
        const { scene_id } = command.payload as RulerClearPayload;
        const live = liveSceneId();
        if (live === null || live !== scene_id) return notLive();
        if (ruler.of(live) === null) return [];
        ruler.clear();
        return [{ type: 'ruler.cleared' }];
      }
      case 'ping': {
        // Stored nowhere and never undone (specs/04-live-sync.md §12).
        const { scene_id, x, y } = command.payload as PingPayload;
        const live = liveSceneId();
        if (live === null || live !== scene_id) return notLive();
        return [{ type: 'ping', x, y }];
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
  // After every command that changed something: the live scene's encounter remembers that it has had an
  // enemy once the Enemies entry has a member (TBL-06, Q-106). Not a step of the undo history.
  const applyNoting = (command: CommandEnvelope, sender?: string): LiveResult => {
    const result = apply(command, sender);
    const live = liveSceneId();
    if (!Array.isArray(result) || result.length === 0 || live === null) return result;
    const noted = noteEnemies(db, live);
    return noted === undefined
      ? result
      : [...result, { type: 'encounter.changed', sceneId: live, before: noted.before, encounter: noted.encounter }];
  };
  const release = (sender: string): LiveEffect[] => {
    if (!ruler.drawnBy(liveSceneId(), sender)) return [];
    ruler.clear();
    return [{ type: 'ruler.cleared' }];
  };
  return { apply: applyNoting, release, history, camera, ruler };
}

/** A change of hit points or armour class: none when the stats and the markers are what they were. */
function statsChanged(result: ReturnType<typeof updateToken>): LiveResult {
  if (
    result.outcome === 'updated' &&
    sameStats(statsOf(result.before), statsOf(result.token)) &&
    sameMarkers(result.before.markers, result.token.markers)
  ) {
    return [];
  }
  return changed(result);
}

function changed(result: ReturnType<typeof updateToken>): LiveResult {
  if (result.outcome === 'not_found') return tokenNotFound();
  if (result.outcome !== 'updated') return notLive();
  return [{ type: 'token.updated', before: result.before, token: result.token, relabelled: result.relabelled }];
}
