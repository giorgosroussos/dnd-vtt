import {
  applyHp,
  EXHAUSTION_LEVELS,
  hasMarker,
  type BatchedCommand,
  type SceneToken,
  type TokenMarker,
} from '@emberglass/shared';

// What an action on several selected tokens asks of each (UXR-02, specs/08-ux-journeys.md §14, Q-122): the
// token commands of one `token.batch` on the live scene, or, in preparation, the same changes sent one token at a
// time. A token the action would not change gets no command, so a batch holds only what changes.

const EXHAUSTION = 'exhaustion';

/** Hide all, unless every one is hidden already: then reveal all. */
export function hideCommands(tokens: readonly SceneToken[]): { hidden: boolean; commands: BatchedCommand[] } {
  const hidden = !tokens.every((token) => token.hidden);
  return {
    hidden,
    commands: tokens
      .filter((token) => token.hidden !== hidden)
      .map((token) => ({ type: 'token.setVisibility', payload: { token_id: token.id, hidden } })),
  };
}

/** A condition on all, unless every one carries it already: then off all. Exhaustion goes on at level 1. */
export function markerCommands(tokens: readonly SceneToken[], id: string): { on: boolean; commands: BatchedCommand[] } {
  const on = !tokens.every((token) => hasMarker(token.markers, id));
  const added: TokenMarker = id === EXHAUSTION ? { id, level: EXHAUSTION_LEVELS.min } : { id };
  return {
    on,
    commands: tokens
      .filter((token) => hasMarker(token.markers, id) !== on)
      .map((token) => ({
        type: 'token.setMarkers',
        payload: {
          token_id: token.id,
          markers: on ? [...token.markers, added] : token.markers.filter((each) => each.id !== id),
        },
      })),
  };
}

/** One amount of damage or healing on each that has hit points; the others are counted as skipped. */
export function hpCommands(
  tokens: readonly SceneToken[],
  delta: number,
): { skipped: number; commands: BatchedCommand[] } {
  const able = tokens.filter((token) => applyHp(token, delta) !== undefined);
  return {
    skipped: tokens.length - able.length,
    commands: able.map((token) => ({ type: 'token.applyHp', payload: { token_id: token.id, delta } })),
  };
}

/** Each token's move to where the group's drop or nudge puts it, those that move only. */
export function moveCommands(
  tokens: readonly SceneToken[],
  moves: readonly { id: string; at: { x: number; y: number } }[],
): BatchedCommand[] {
  return moves.flatMap(({ id, at }) => {
    const token = tokens.find((each) => each.id === id);
    if (!token || (token.x === at.x && token.y === at.y)) return [];
    return [{ type: 'token.move', payload: { token_id: id, x: at.x, y: at.y } }];
  });
}

export const deleteCommands = (tokens: readonly SceneToken[]): BatchedCommand[] =>
  tokens.map((token) => ({ type: 'token.delete', payload: { token_id: token.id } }));
