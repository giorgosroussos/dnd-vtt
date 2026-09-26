import type {
  DmLiveScene,
  DmSnapshot,
  DmTokenEventPayload,
  EventEnvelope,
  SceneToken,
  TokenRemovedPayload,
} from '@emberglass/shared';

// The live scene as the DM view holds it, kept in step from the `dm` room's snapshots and events
// (LIV-04; specs/04-live-sync.md §3, §5, D-109, G-018), free of React. A snapshot replaces
// everything: on connection, after a gap, on activation and after a REST change to the live scene
// (specs/04-live-sync.md §10). `token.added` and `token.updated` carry the token in the DM's shape
// and `relabelled`, the lone token renamed "<name> 1" beside it; `token.removed` names the token;
// `scene.cleared` means nothing is live. Tokens are held bottom of the stack first, as the server
// lists them, so a live canvas draws what a fresh snapshot would.

/** The live scene, or null while nothing is live. */
export type DmScene = DmLiveScene | null;

const stacked = (tokens: readonly SceneToken[]): SceneToken[] =>
  [...tokens].sort((a, b) => a.z_order - b.z_order || a.id.localeCompare(b.id));

export function fromDmSnapshot(snapshot: DmSnapshot): DmScene {
  if (snapshot.scene === null) return null;
  return { ...snapshot.scene, tokens: stacked(snapshot.scene.tokens) };
}

/** The scene after one `dm` event that is exactly the next version (the connection checks that). */
export function applyDmEvent(scene: DmScene, event: EventEnvelope): DmScene {
  if (event.type === 'scene.cleared') return null;
  if (scene === null) return null;
  switch (event.type) {
    case 'token.added':
    case 'token.updated': {
      const { token, relabelled } = event.payload as unknown as Partial<DmTokenEventPayload>;
      // A malformed event is skipped rather than ending the view, as in the player view (D-114).
      if (!token) return scene;
      const changed = [token, ...(relabelled ?? [])];
      const rest = scene.tokens.filter((each) => !changed.some((other) => other.id === each.id));
      // A renamed token not held here is left out: only the scene's own tokens are drawn.
      const renamed = (relabelled ?? []).filter((each) => scene.tokens.some((held) => held.id === each.id));
      return { ...scene, tokens: stacked([...rest, token, ...renamed]) };
    }
    case 'token.removed': {
      const { id } = event.payload as unknown as TokenRemovedPayload;
      return { ...scene, tokens: scene.tokens.filter((each) => each.id !== id) };
    }
    default:
      // The camera and the ruler are LIV-06 and LIV-07's.
      return scene;
  }
}
