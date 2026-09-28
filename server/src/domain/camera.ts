import { FIT_CAMERA, type PlayerCamera, type Screen } from '@emberglass/shared';

// The player camera and the screens it is shown on (LIV-06; specs/04-live-sync.md §9, Q-038, D-018).
//
// The camera is held in memory only, for the live scene: `of` answers FIT_CAMERA for any scene but
// the one it was set on, so a live scene replaced or deleted by any path starts fitted, and every
// activation resets it (`reset`), the live scene's own included. Nothing is stored; a restart fits.
//
// The screens are the player views that reported their viewport (SOCKET_CHANNELS.viewport). The TV
// frame in the DM view takes the shape of the one connected longest, so a phone opened later to look
// at the table changes nothing; every other screen shows at least the frame (D-119).

export class PlayerCameraState {
  private scene: string | null = null;
  private camera: PlayerCamera = FIT_CAMERA;

  /** The camera of `liveSceneId`: fitted unless it was set for that scene since its activation. */
  of(liveSceneId: string | null): PlayerCamera {
    return liveSceneId !== null && this.scene === liveSceneId ? this.camera : FIT_CAMERA;
  }

  set(liveSceneId: string, camera: PlayerCamera): void {
    this.scene = liveSceneId;
    this.camera = { ...camera };
  }

  /** Back to fit-to-map: on every activation and deactivation. */
  reset(): void {
    this.scene = null;
    this.camera = FIT_CAMERA;
  }
}

export const sameCamera = (a: PlayerCamera, b: PlayerCamera): boolean =>
  a.centre_x === b.centre_x && a.centre_y === b.centre_y && a.width === b.width && a.height === b.height;

/** The viewports the player views reported, keyed by socket, in the order the sockets connected. */
export class ScreenRegistry {
  private readonly screens = new Map<string, { order: number; screen: Screen | null }>();
  private sequence = 0;

  /** A player socket connected; it counts once it reports. */
  connected(id: string): void {
    this.screens.set(id, { order: ++this.sequence, screen: null });
  }

  report(id: string, screen: Screen): void {
    const entry = this.screens.get(id);
    if (entry) entry.screen = { width: screen.width, height: screen.height };
  }

  disconnected(id: string): void {
    this.screens.delete(id);
  }

  /** The screen the TV frame follows: the one connected longest among those that reported. */
  chosen(): Screen | null {
    let best: { order: number; screen: Screen } | undefined;
    for (const { order, screen } of this.screens.values()) {
      if (screen && (best === undefined || order < best.order)) best = { order, screen };
    }
    return best ? { ...best.screen } : null;
  }
}

export const sameScreen = (a: Screen | null, b: Screen | null): boolean =>
  a === b || (a !== null && b !== null && a.width === b.width && a.height === b.height);
