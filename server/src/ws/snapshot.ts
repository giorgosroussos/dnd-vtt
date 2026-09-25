import type Database from 'better-sqlite3';
import type { DmSnapshot, PlayerMap, PlayerSnapshot, PlayerToken, Room, SceneSnapshot } from '@emberglass/shared';
import { readScene } from '../db/campaigns.js';
import { readImage } from '../db/images.js';
import { readSettings } from '../db/settings.js';
import { listTokens } from '../db/tokens.js';

// The `scene.snapshot` of each room (specs/04-live-sync.md §3, §4, §5; LIV-01, D-104), read
// from the database whenever one is sent, so that it is the stored live scene and nothing a
// client said. The players' projection is built here, on the server, field by field: visible
// tokens only, each with exactly the fields of §4, and a stacking order that is the token's
// rank among the visible tokens, so a hidden token between two visible ones leaves no trace
// (G-025). Nothing of the scene record reaches players but its grid and the map's display size.

export function readSnapshot(db: Database.Database, role: 'dm'): DmSnapshot;
export function readSnapshot(db: Database.Database, role: 'players'): PlayerSnapshot;
export function readSnapshot(db: Database.Database, role: Room): SceneSnapshot;
export function readSnapshot(db: Database.Database, role: Room): SceneSnapshot {
  // One transaction, so the scene, its map and its tokens are read at the same moment.
  return db.transaction(() => (role === 'dm' ? readDm(db) : readPlayers(db)))();
}

function readDm(db: Database.Database): DmSnapshot {
  const live = readLive(db);
  if (!live) return { role: 'dm', scene: null };
  return { role: 'dm', scene: live };
}

function readPlayers(db: Database.Database): PlayerSnapshot {
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
      tokens: visible.map((token, rank): PlayerToken => ({
        id: token.id,
        x: token.x,
        y: token.y,
        size: token.asset.size,
        image_id: token.asset.image_id,
        z_order: rank,
        label: token.label,
      })),
    },
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
