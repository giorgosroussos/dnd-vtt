import { describe, expect, it } from 'vitest';
import type { EventEnvelope, Grid, PlayerMap, PlayerSnapshot, PlayerToken } from '@emberglass/shared';
import { applyPlayerEvent, fromSnapshot, type PlayerScene } from './scene.js';

// The player view's drawn state kept in step from the players' events (LIV-03, specs/04-live-sync.md
// §3, §4, D-109): after every event it must equal what a fresh snapshot of the same moment gives.
// The "server" below is a stacking order of every token, hidden ones included, from which each
// event and each snapshot is derived exactly as server/src/ws/projection.ts does: ranks among the
// visible tokens after the change.

const GRID: Grid = {
  type: 'square',
  size: 70,
  offset_x: 0,
  offset_y: 0,
  visible: true,
  feet_per_square: 5,
  columns: 30,
  rows: 20,
};
const MAP: PlayerMap = {
  id: 'a'.repeat(64),
  width: 2100,
  height: 1400,
  variants: { display: { width: 2100, height: 1400 } },
};

interface ServerToken {
  id: string;
  label: string;
  x: number;
  y: number;
  hidden: boolean;
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

class Server {
  version = 1;
  constructor(public stack: ServerToken[]) {}
  private visible() {
    return this.stack.filter((token) => !token.hidden);
  }
  player(token: ServerToken): PlayerToken {
    const rank = this.visible().findIndex((each) => each.id === token.id);
    if (rank < 0) throw new Error('a hidden token would be sent');
    return {
      id: token.id,
      x: token.x,
      y: token.y,
      size: 'medium',
      image_id: 'b'.repeat(64),
      z_order: rank,
      label: token.label,
    };
  }
  snapshot(): PlayerSnapshot {
    return {
      role: 'players',
      scene: { map: MAP, grid: GRID, tokens: this.visible().map((token) => this.player(token)) },
    };
  }
  event(type: EventEnvelope['type'], payload: object): EventEnvelope {
    return { type, version: ++this.version, payload: payload as Record<string, unknown> };
  }
  find(n: number): ServerToken {
    return this.stack.find((token) => token.id === id(n))!;
  }
}

const expectSameAsSnapshot = (scene: PlayerScene, server: Server) =>
  expect(scene).toEqual(fromSnapshot(server.snapshot()));

describe('the players’ events applied to the drawn state', () => {
  it('gives after each event what a fresh snapshot would, through adds, moves, reveals, hides, relabels and deletions', () => {
    // 1 visible, 2 hidden, 3 visible, 4 hidden, 5 visible: players hold 1, 3, 5 at ranks 0, 1, 2.
    const server = new Server([
      { id: id(1), label: 'Goblin 1', x: 0, y: 0, hidden: false },
      { id: id(2), label: 'Assassin', x: 1, y: 0, hidden: true },
      { id: id(3), label: 'Goblin 2', x: 2, y: 0, hidden: false },
      { id: id(4), label: 'Ogre', x: 3, y: 0, hidden: true },
      { id: id(5), label: 'Hero', x: 4, y: 0, hidden: false },
    ]);
    let scene = fromSnapshot(server.snapshot());
    expect(scene?.tokens.map((token) => [token.label, token.z_order])).toEqual([
      ['Goblin 1', 0],
      ['Goblin 2', 1],
      ['Hero', 2],
    ]);

    // A reveal between visible tokens: the assassin enters at rank 1, the tokens above move up.
    server.find(2).hidden = false;
    scene = applyPlayerEvent(
      scene,
      server.event('token.added', { token: server.player(server.find(2)), relabelled: [] }),
    );
    expectSameAsSnapshot(scene, server);
    expect(scene?.tokens.map((token) => token.label)).toEqual(['Goblin 1', 'Assassin', 'Goblin 2', 'Hero']);

    // A move replaces the token where it is.
    server.find(3).x = 7.5;
    scene = applyPlayerEvent(scene, server.event('token.updated', { token: server.player(server.find(3)) }));
    expectSameAsSnapshot(scene, server);

    // A hide reaches players as the removal a deletion sends; the gap closes.
    server.find(1).hidden = true;
    scene = applyPlayerEvent(scene, server.event('token.removed', { id: id(1) }));
    expectSameAsSnapshot(scene, server);

    // A token added live goes on top; the lone "Ogre" revealed later is relabelled "Ogre 1"
    // inside the event of the second ogre's addition (G-023).
    server.find(4).hidden = false;
    scene = applyPlayerEvent(
      scene,
      server.event('token.added', { token: server.player(server.find(4)), relabelled: [] }),
    );
    expectSameAsSnapshot(scene, server);
    server.find(4).label = 'Ogre 1';
    server.stack.push({ id: id(6), label: 'Ogre 2', x: 9, y: 9, hidden: false });
    scene = applyPlayerEvent(
      scene,
      server.event('token.added', {
        token: server.player(server.find(6)),
        relabelled: [server.player(server.find(4))],
      }),
    );
    expectSameAsSnapshot(scene, server);
    expect(scene?.tokens.map((token) => token.label)).toEqual(['Assassin', 'Goblin 2', 'Ogre 1', 'Hero', 'Ogre 2']);

    // A deletion of the bottom token renumbers every rank above it.
    server.stack = server.stack.filter((token) => token.id !== id(2));
    scene = applyPlayerEvent(scene, server.event('token.removed', { id: id(2) }));
    expectSameAsSnapshot(scene, server);
    expect(scene?.tokens.map((token) => token.z_order)).toEqual([0, 1, 2, 3]);
  });

  it('returns to the idle screen on scene.cleared, and draws nothing from token events while idle', () => {
    const server = new Server([{ id: id(1), label: 'Goblin', x: 0, y: 0, hidden: false }]);
    const scene = fromSnapshot(server.snapshot());
    expect(applyPlayerEvent(scene, server.event('scene.cleared', {}))).toBeNull();
    expect(
      applyPlayerEvent(null, server.event('token.added', { token: server.player(server.find(1)), relabelled: [] })),
    ).toBeNull();
    expect(fromSnapshot({ role: 'players', scene: null })).toBeNull();
  });

  it('keeps only the player fields of a token, whatever an event carried', () => {
    const server = new Server([]);
    const scene = fromSnapshot(server.snapshot());
    server.stack.push({ id: id(1), label: 'Goblin', x: 0, y: 0, hidden: false });
    const token = server.player(server.find(1));
    const next = applyPlayerEvent(
      scene,
      server.event('token.added', { token: { ...token, notes: 'secret', asset_id: id(9) }, relabelled: [] }),
    );
    expect(Object.keys(next!.tokens[0]!).sort()).toEqual(['id', 'image_id', 'label', 'size', 'x', 'y', 'z_order']);
  });

  it('orders a snapshot by stacking order whatever order its tokens arrived in', () => {
    const server = new Server([
      { id: id(1), label: 'A', x: 0, y: 0, hidden: false },
      { id: id(2), label: 'B', x: 0, y: 0, hidden: false },
    ]);
    const snapshot = server.snapshot();
    snapshot.scene!.tokens.reverse();
    expect(fromSnapshot(snapshot)?.tokens.map((token) => token.label)).toEqual(['A', 'B']);
  });

  it('is idempotent and ignores what it does not hold: a replayed add, an unknown removal or relabel, a malformed event', () => {
    const server = new Server([
      { id: id(1), label: 'Goblin 1', x: 0, y: 0, hidden: false },
      { id: id(2), label: 'Hero', x: 1, y: 0, hidden: false },
    ]);
    const start = fromSnapshot(server.snapshot());
    server.stack.push({ id: id(3), label: 'Ogre', x: 2, y: 0, hidden: false });
    const added = server.event('token.added', { token: server.player(server.find(3)), relabelled: [] });
    const once = applyPlayerEvent(start, added);
    expect(applyPlayerEvent(once, added)).toEqual(once);
    expectSameAsSnapshot(once, server);
    expect(applyPlayerEvent(once, server.event('token.removed', { id: id(9) }))).toEqual(once);
    const stranger = { ...server.player(server.find(3)), id: id(9), label: 'Nobody' };
    const relabel = applyPlayerEvent(
      once,
      server.event('token.added', { token: server.player(server.find(3)), relabelled: [stranger] }),
    );
    expect(relabel).toEqual(once);
    expect(applyPlayerEvent(once, server.event('token.added', {}))).toEqual(once);
    expect(applyPlayerEvent(once, server.event('token.updated', {}))).toEqual(once);
  });

  it('moves a token to the rank its update gives', () => {
    const server = new Server([
      { id: id(1), label: 'A', x: 0, y: 0, hidden: false },
      { id: id(2), label: 'B', x: 0, y: 0, hidden: false },
    ]);
    const scene = fromSnapshot(server.snapshot());
    const moved = applyPlayerEvent(
      scene,
      server.event('token.updated', { token: { ...server.player(server.find(1)), z_order: 1 } }),
    );
    expect(moved?.tokens.map((token) => [token.label, token.z_order])).toEqual([
      ['B', 0],
      ['A', 1],
    ]);
  });
});
