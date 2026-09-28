import type Database from 'better-sqlite3';
import type {
  DmSnapshot,
  PlayerMap,
  PlayerSnapshot,
  PlayerToken,
  Room,
  SceneSnapshot,
  SceneToken,
} from '@emberglass/shared';
import { readScene } from '../db/campaigns.js';
import { readImage } from '../db/images.js';
import { readSettings } from '../db/settings.js';
import { listTokens } from '../db/tokens.js';
import type { PlayerCameraState, ScreenRegistry } from '../domain/camera.js';

/** What the snapshots read from the server's memory rather than the database (LIV-06). */
export interface LiveMemory {
  camera: PlayerCameraState;
  screens: ScreenRegistry;
}

// The `scene.snapshot` of each room (specs/04-live-sync.md §3, §4, §5; LIV-01, D-104), read
// from the database whenever one is sent, so that it is the stored live scene and nothing a
// client said. The players' projection is built here, on the server, field by field: visible
// tokens only, each with exactly the fields of §4, and a stacking order that is the token's
// rank among the visible tokens, so a hidden token between two visible ones leaves no trace
// (G-025). Nothing of the scene record reaches players but its grid and the map's display size.
// Both rooms receive the player camera (LIV-06, specs/04-live-sync.md §9), so a screen connecting or
// reconnecting shows what the others show; only the DM's carries the screen shape the TV frame
// follows (D-119).

export function readSnapshot(db: Database.Database, role: 'dm', memory: LiveMemory): DmSnapshot;
export function readSnapshot(db: Database.Database, role: 'players', memory: LiveMemory): PlayerSnapshot;
export function readSnapshot(db: Database.Database, role: Room, memory: LiveMemory): SceneSnapshot;
export function readSnapshot(db: Database.Database, role: Room, memory: LiveMemory): SceneSnapshot {
  // One transaction, so the scene, its map and its tokens are read at the same moment.
  return db.transaction(() => (role === 'dm' ? readDm(db, memory) : readPlayers(db, memory)))();
}

function readDm(db: Database.Database, memory: LiveMemory): DmSnapshot {
  const live = readLive(db);
  if (!live) return { role: 'dm', scene: null };
  return {
    role: 'dm',
    scene: { ...live, camera: { ...memory.camera.of(live.scene.id) }, screen: memory.screens.chosen() },
  };
}

function readPlayers(db: Database.Database, memory: LiveMemory): PlayerSnapshot {
  const live = readLive(db);
  if (!live) return { role: 'players', scene: null };
  const { scene, map, tokens } = live;
  // listTokens answers bottom of the stack first; the rank counts visible tokens only.
  const visible = tokens.filter((token) => !token.hidden);
  return {
    role: 'players',
    scene: {
      map: map && playerMap(map),
      grid: { ...scene.grid },
      tokens: visible.map(toPlayerToken),
      camera: { ...memory.camera.of(scene.id) },
    },
  };
}

/**
 * A token as players receive it, field by field (specs/04-live-sync.md §4, Q-047): `rank` is its
 * place among the visible tokens, bottom first, never the stored `z_order` (G-025). The live
 * events build their players' tokens here too, so a snapshot and an event can never disagree.
 */
export function toPlayerToken(token: SceneToken, rank: number): PlayerToken {
  return {
    id: token.id,
    x: token.x,
    y: token.y,
    size: token.asset.size,
    image_id: token.asset.image_id,
    z_order: rank,
    label: token.label,
  };
}

function playerMap(map: NonNullable<ReturnType<typeof readImage>>): PlayerMap {
  const { display } = map.variants;
  return {
    id: map.id,
    width: map.width,
    height: map.height,
    variants: display ? { display: { width: display.width, height: display.height } } : {},
  };
}

function readLive(db: Database.Database) {
  const id = readSettings(db).live_scene_id;
  if (id === null) return undefined;
  const scene = readScene(db, id);
  // The foreign key clears live_scene_id with its scene (specs/03-domain-model.md §7); a
  // dangling id would be a broken database, shown as nothing live rather than a failure.
  if (!scene) return undefined;
  const map = scene.map_image_id === null ? null : (readImage(db, scene.map_image_id) ?? null);
  return { scene, map, tokens: listTokens(db, id) ?? [] };
}
