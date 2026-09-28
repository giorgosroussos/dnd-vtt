import {
  FIT_CAMERA,
  isMeasurement,
  type EventEnvelope,
  type Measurement,
  type PlayerCameraPayload,
  type PlayerLiveScene,
  type PlayerSnapshot,
  type PlayerToken,
  type PlayerTokenAddedPayload,
  type PlayerTokenUpdatedPayload,
  type RulerShownPayload,
  type TokenRemovedPayload,
} from '@emberglass/shared';

// What the player view draws, kept in step from the players' events (LIV-03; specs/04-live-sync.md
// §3, §4, §5, D-109), free of React. A snapshot replaces everything. The visible tokens are held
// in stacking order, bottom first, and each token's `z_order` is its rank among them: an added
// token (a reveal included) is inserted at the rank its event gives and a removed one closes its
// gap, so the ranks held always equal those of a fresh snapshot (G-025). A moved token is
// replaced; a relabelled one keeps its place and takes its new label. `scene.cleared` returns to
// the idle screen. `camera.player` replaces the camera the TV shows (LIV-06, specs/04-live-sync.md
// §9); a snapshot brings the current one, fitted to the map after an activation. `ruler.shown` and
// `ruler.cleared` (LIV-07, §11) replace and remove the measurement drawn; a snapshot brings the one
// shown, if any. Only the player fields are kept, whatever an event carried.

/** The live scene the player view draws, or null for the idle screen. */
export type PlayerScene = PlayerLiveScene | null;

const playerToken = ({ id, x, y, size, image_id, z_order, label }: PlayerToken): PlayerToken => ({
  id,
  x,
  y,
  size,
  image_id,
  z_order,
  label,
});

const ranked = (tokens: readonly PlayerToken[]): PlayerToken[] =>
  tokens.map((token, rank) => (token.z_order === rank ? token : { ...token, z_order: rank }));

/** The tokens with `token` at its rank, any earlier copy of it removed. */
function placed(tokens: readonly PlayerToken[], token: PlayerToken): PlayerToken[] {
  const rest = tokens.filter((each) => each.id !== token.id);
  rest.splice(Math.min(Math.max(token.z_order, 0), rest.length), 0, playerToken(token));
  return ranked(rest);
}

const measurement = ({ from, to, feet }: Measurement): Measurement => ({
  from: { column: from.column, row: from.row },
  to: { column: to.column, row: to.row },
  feet,
});

export function fromSnapshot(snapshot: PlayerSnapshot): PlayerScene {
  if (snapshot.scene === null) return null;
  const { map, grid, tokens, camera, ruler } = snapshot.scene;
  return {
    map,
    grid,
    tokens: ranked([...tokens].sort((a, b) => a.z_order - b.z_order).map(playerToken)),
    camera: camera ? { ...camera } : FIT_CAMERA,
    ruler: ruler ? measurement(ruler) : null,
  };
}

/** The scene after one players' event that is exactly the next version (the connection checks that). */
export function applyPlayerEvent(scene: PlayerScene, event: EventEnvelope): PlayerScene {
  if (event.type === 'scene.cleared') return null;
  if (scene === null) return null;
  switch (event.type) {
    case 'token.added': {
      const { token, relabelled } = event.payload as unknown as Partial<PlayerTokenAddedPayload>;
      // A malformed event is skipped rather than ending the view (LIV-03 review).
      if (!token) return scene;
      let tokens = placed(scene.tokens, token);
      for (const renamed of relabelled ?? []) {
        tokens = tokens.map((each) => (each.id === renamed.id ? { ...each, label: renamed.label } : each));
      }
      return { ...scene, tokens };
    }
    case 'token.updated': {
      const { token } = event.payload as unknown as Partial<PlayerTokenUpdatedPayload>;
      if (!token) return scene;
      return { ...scene, tokens: placed(scene.tokens, token) };
    }
    case 'token.removed': {
      const { id } = event.payload as unknown as TokenRemovedPayload;
      return { ...scene, tokens: ranked(scene.tokens.filter((each) => each.id !== id)) };
    }
    case 'camera.player': {
      const { camera } = event.payload as unknown as Partial<PlayerCameraPayload>;
      if (!camera) return scene;
      const { centre_x, centre_y, width, height } = camera;
      return { ...scene, camera: { centre_x, centre_y, width, height } };
    }
    case 'ruler.shown': {
      const { ruler } = event.payload as unknown as Partial<RulerShownPayload>;
      if (!isMeasurement(ruler)) return scene;
      return { ...scene, ruler: measurement(ruler) };
    }
    case 'ruler.cleared':
      return { ...scene, ruler: null };
    default:
      return scene;
  }
}
