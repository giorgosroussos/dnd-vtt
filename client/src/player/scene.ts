import type {
  EventEnvelope,
  PlayerLiveScene,
  PlayerSnapshot,
  PlayerToken,
  PlayerTokenAddedPayload,
  PlayerTokenUpdatedPayload,
  TokenRemovedPayload,
} from '@emberglass/shared';

// What the player view draws, kept in step from the players' events (LIV-03; specs/04-live-sync.md
// §3, §4, §5, D-109), free of React. A snapshot replaces everything. The visible tokens are held
// in stacking order, bottom first, and each token's `z_order` is its rank among them: an added
// token (a reveal included) is inserted at the rank its event gives and a removed one closes its
// gap, so the ranks held always equal those of a fresh snapshot (G-025). A moved token is
// replaced; a relabelled one keeps its place and takes its new label. `scene.cleared` returns to
// the idle screen. Only the player fields are kept, whatever an event carried.

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

export function fromSnapshot(snapshot: PlayerSnapshot): PlayerScene {
  if (snapshot.scene === null) return null;
  const { map, grid, tokens } = snapshot.scene;
  return { map, grid, tokens: ranked([...tokens].sort((a, b) => a.z_order - b.z_order).map(playerToken)) };
}

/** The scene after one players' event that is exactly the next version (the connection checks that). */
export function applyPlayerEvent(scene: PlayerScene, event: EventEnvelope): PlayerScene {
  if (event.type === 'scene.cleared') return null;
  if (scene === null) return null;
  switch (event.type) {
    case 'token.added': {
      const { token, relabelled } = event.payload as unknown as PlayerTokenAddedPayload;
      let tokens = placed(scene.tokens, token);
      for (const renamed of relabelled) {
        tokens = tokens.map((each) => (each.id === renamed.id ? { ...each, label: renamed.label } : each));
      }
      return { ...scene, tokens };
    }
    case 'token.updated': {
      const { token } = event.payload as unknown as PlayerTokenUpdatedPayload;
      return { ...scene, tokens: placed(scene.tokens, token) };
    }
    case 'token.removed': {
      const { id } = event.payload as unknown as TokenRemovedPayload;
      return { ...scene, tokens: ranked(scene.tokens.filter((each) => each.id !== id)) };
    }
    default:
      // The camera and the ruler are LIV-06 and LIV-07's.
      return scene;
  }
}
