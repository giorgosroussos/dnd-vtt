import { rulerFeet, type Grid, type Measurement, type RulerRule, type RulerSquare } from '@emberglass/shared';

// The measurement shown on the TV (LIV-07; specs/04-live-sync.md §11, specs/06-grid-and-measurement.md
// §5, Q-027, Q-048, Q-086, D-121). Held in memory only, for the live scene, and never stored: `of`
// answers null for any scene but the one it was made on, so a live scene replaced or deleted by any
// path shows none. It remembers which DM socket drew it, so that the socket going (a laptop asleep, a
// session ended) takes its line off the TV. The distance is counted whenever it is read, from the
// server-wide rule and the live scene's feet per square, so a new scale reaches both rooms in the
// snapshot that carries it.

export interface RulerPath {
  from: RulerSquare;
  to: RulerSquare;
}

export class RulerState {
  private scene: string | null = null;
  private path: RulerPath | null = null;
  private owner: string | undefined;

  /** The path shown on `liveSceneId`, or null. */
  of(liveSceneId: string | null): RulerPath | null {
    return liveSceneId !== null && this.scene === liveSceneId ? this.path : null;
  }

  set(liveSceneId: string, path: RulerPath, owner: string | undefined): void {
    this.scene = liveSceneId;
    this.path = { from: { ...path.from }, to: { ...path.to } };
    this.owner = owner;
  }

  /** Whether `owner` drew the path now shown on `liveSceneId`. */
  drawnBy(liveSceneId: string | null, owner: string): boolean {
    return this.of(liveSceneId) !== null && this.owner === owner;
  }

  /** Nothing shown: on `ruler.clear`, every activation and deactivation, and a new map. */
  clear(): void {
    this.scene = null;
    this.path = null;
    this.owner = undefined;
  }
}

const sameSquare = (a: RulerSquare, b: RulerSquare): boolean => a.column === b.column && a.row === b.row;

export const samePath = (a: RulerPath | null, b: RulerPath): boolean =>
  a !== null && sameSquare(a.from, b.from) && sameSquare(a.to, b.to);

/** What both rooms are shown of `path` on a scene of `grid`, under `rule`. */
export const measurementOf = (path: RulerPath, grid: Pick<Grid, 'feet_per_square'>, rule: RulerRule): Measurement => ({
  from: { ...path.from },
  to: { ...path.to },
  feet: rulerFeet(path.from, path.to, rule, grid.feet_per_square),
});
