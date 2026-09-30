import { isMeasurement } from '@emberglass/shared';
import type {
  DmCameraPayload,
  DmLiveScene,
  DmSnapshot,
  DmTokenEventPayload,
  EventEnvelope,
  HistoryChangedPayload,
  Region,
  RegionEventPayload,
  RegionRemovedPayload,
  RulerShownPayload,
  SceneToken,
  TokenRemovedPayload,
} from '@emberglass/shared';

// The live scene as the DM view holds it, kept in step from the `dm` room's snapshots and events
// (LIV-04; specs/04-live-sync.md §3, §5, D-109, G-018), free of React. A snapshot replaces
// everything: on connection, after a gap, on activation and after a REST change to the live scene
// (specs/04-live-sync.md §10). `token.added` and `token.updated` carry the token in the DM's shape
// and `relabelled`, the lone token renamed "<name> 1" beside it; `token.removed` names the token;
// `scene.cleared` means nothing is live. Tokens are held bottom of the stack first, as the server
// lists them, so a live canvas draws what a fresh snapshot would. `camera.player` (LIV-06) replaces the
// player camera and the screen shape the TV frame follows, so the frame follows another DM browser.
// `ruler.shown` and `ruler.cleared` (LIV-07) replace and remove the measurement the TV shows, so the DM
// sees what the TV sees, another DM browser's measurement included. `history.changed` (UIX-01) replaces
// whether undo and redo would change anything, which greys the rail's Undo and Redo. `region.added`,
// `region.updated` and `region.removed` (TBL-03) keep the scene's fog regions, in the order drawn.

/** The live scene, or null while nothing is live. */
export type DmScene = DmLiveScene | null;

const stacked = (tokens: readonly SceneToken[]): SceneToken[] =>
  [...tokens].sort((a, b) => a.z_order - b.z_order || a.id.localeCompare(b.id));

const ordered = (regions: readonly Region[]): Region[] =>
  [...regions].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

export function fromDmSnapshot(snapshot: DmSnapshot): DmScene {
  if (snapshot.scene === null) return null;
  return { ...snapshot.scene, tokens: stacked(snapshot.scene.tokens), regions: ordered(snapshot.scene.regions) };
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
    case 'camera.player': {
      const { camera, screen } = event.payload as unknown as Partial<DmCameraPayload>;
      if (!camera) return scene;
      return { ...scene, camera, screen: screen ?? null };
    }
    case 'ruler.shown': {
      const { ruler } = event.payload as unknown as Partial<RulerShownPayload>;
      // A malformed measurement is skipped rather than drawn as "undefined ft" (review C-L3).
      if (!isMeasurement(ruler)) return scene;
      const { from, to, feet } = ruler;
      return { ...scene, ruler: { from: { ...from }, to: { ...to }, feet } };
    }
    case 'ruler.cleared':
      return { ...scene, ruler: null };
    case 'region.added':
    case 'region.updated': {
      const { region } = event.payload as unknown as Partial<RegionEventPayload>;
      if (!region) return scene;
      const rest = scene.regions.filter((each) => each.id !== region.id);
      return { ...scene, regions: ordered([...rest, region]) };
    }
    case 'region.removed': {
      const { id } = event.payload as unknown as Partial<RegionRemovedPayload>;
      return { ...scene, regions: scene.regions.filter((each) => each.id !== id) };
    }
    case 'history.changed': {
      const { can_undo, can_redo } = event.payload as unknown as Partial<HistoryChangedPayload>;
      if (typeof can_undo !== 'boolean' || typeof can_redo !== 'boolean') return scene;
      return { ...scene, history: { can_undo, can_redo } };
    }
    default:
      return scene;
  }
}
