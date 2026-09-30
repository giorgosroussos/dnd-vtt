import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandEnvelope, ErrorEnvelope, LibraryAsset, Scene, SceneToken } from '@emberglass/shared';
import { readToken } from '../db/tokens.js';
import { ok, startLive, type LiveHarness } from '../ws/testing/harness.js';
import { createLiveCommands, type LiveCommands, type LiveEffect } from './live.js';
import { inverseOf, inverseOfInverse, UNDO_LIMIT, UndoHistory, type Inverse } from './undo.js';

// LIV-05: the undo history and the inverse of each undoable command (specs/04-live-sync.md §8,
// specs/10-testing-acceptance.md §2, Q-005, Q-050, D-040, D-117), and redo beside it (UIX-01). The pure parts are tested on plain
// values; the commands with their history against a real SQLite file (specs/10-testing-acceptance.md
// §2), prepared over REST.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const token = (fields: Partial<SceneToken> = {}): SceneToken => ({
  id: id(1),
  scene_id: id(2),
  asset_id: id(3),
  label: 'Lurker',
  x: 2,
  y: 3,
  hidden: true,
  z_order: 4,
  markers: [],
  character_id: null,
  asset: { name: 'Lurker', image_id: 'a'.repeat(64), size: 'medium', category: 'monster' },
  ...fields,
});
const command = (type: CommandEnvelope['type'], payload: Record<string, unknown> = {}): CommandEnvelope => ({
  type,
  payload,
});
const move = (n: number): Inverse => ({ type: 'token.move', payload: { token_id: id(n), x: n, y: 0 } });

describe('the inverse of each undoable command (specs/04-live-sync.md §8)', () => {
  it('undoes an add by deleting the token it placed, a hidden one included', () => {
    for (const hidden of [false, true]) {
      const added = token({ hidden });
      expect(inverseOf(command('token.add'), [{ type: 'token.added', token: added, relabelled: [] }])).toEqual({
        type: 'token.delete',
        payload: { token_id: added.id },
      });
    }
  });

  it('undoes a move by moving the token back to where it was, a hidden one included', () => {
    for (const hidden of [false, true]) {
      const before = token({ hidden, x: 2, y: 3 });
      const effect: LiveEffect = { type: 'token.updated', before, token: { ...before, x: 7.5, y: 1 }, relabelled: [] };
      expect(inverseOf(command('token.move'), [effect])).toEqual({
        type: 'token.move',
        payload: { token_id: before.id, x: 2, y: 3 },
      });
    }
  });

  it('undoes a reveal by hiding, and a hide by revealing', () => {
    for (const hidden of [false, true]) {
      const before = token({ hidden });
      const effect: LiveEffect = {
        type: 'token.updated',
        before,
        token: { ...before, hidden: !hidden },
        relabelled: [],
      };
      expect(inverseOf(command('token.setVisibility'), [effect])).toEqual({
        type: 'token.setVisibility',
        payload: { token_id: before.id, hidden },
      });
    }
  });

  it('undoes a delete by putting back the same token, all of it, a hidden one included', () => {
    for (const [hidden, shown] of [
      [false, true],
      [true, false],
      [true, true],
    ] as const) {
      const deleted = token({ hidden });
      expect(inverseOf(command('token.delete'), [{ type: 'token.removed', token: deleted, shown }])).toEqual({
        type: 'token.add',
        restore: deleted,
        shown,
      });
    }
  });

  it('has nothing to undo for a command that changed nothing, or one that is not undoable', () => {
    const still = token();
    expect(
      inverseOf(command('token.move'), [{ type: 'token.updated', before: still, token: { ...still }, relabelled: [] }]),
    ).toBeUndefined();
    expect(inverseOf(command('token.setVisibility'), [])).toBeUndefined();
    expect(inverseOf(command('scene.activate'), [{ type: 'activated' }])).toBeUndefined();
    expect(inverseOf(command('scene.deactivate'), [{ type: 'cleared' }])).toBeUndefined();
    expect(inverseOf(command('undo'), [{ type: 'token.removed', token: token(), shown: true }])).toBeUndefined();
  });
});

describe('the undo history (specs/04-live-sync.md §8, Q-005)', () => {
  it('gives back the most recent inverse first', () => {
    const history = new UndoHistory();
    history.record(id(9), move(1));
    history.record(id(9), move(2));
    expect(history.pop(id(9))).toEqual(move(2));
    expect(history.pop(id(9))).toEqual(move(1));
    expect(history.pop(id(9))).toBeUndefined();
    expect(history.sceneId).toBeNull();
  });

  it(`holds the last ${UNDO_LIMIT} inverses and forgets older ones`, () => {
    const history = new UndoHistory();
    for (let n = 1; n <= UNDO_LIMIT + 5; n++) history.record(id(9), move(n));
    expect(history.size).toBe(UNDO_LIMIT);
    const popped: Inverse[] = [];
    for (let inverse = history.pop(id(9)); inverse; inverse = history.pop(id(9))) popped.push(inverse);
    expect(popped).toHaveLength(UNDO_LIMIT);
    expect(popped[0]).toEqual(move(UNDO_LIMIT + 5));
    expect(popped.at(-1)).toEqual(move(6));
  });

  it('belongs to one live scene: used for another, or with nothing live, it is emptied', () => {
    const history = new UndoHistory();
    history.record(id(9), move(1));
    expect(history.pop(id(8))).toBeUndefined();
    expect(history.size).toBe(0);
    history.record(id(9), move(1));
    expect(history.pop(null)).toBeUndefined();
    history.record(id(9), move(1));
    history.record(id(8), move(2));
    expect(history.size).toBe(1);
    history.keepOnly(id(8));
    expect(history.size).toBe(1);
    history.keepOnly(id(9));
    expect(history.size).toBe(0);
  });
});

describe('undo with the live commands, against a real SQLite file (specs/04-live-sync.md §8, D-117)', () => {
  let h: LiveHarness;
  let live: LiveCommands;
  let sceneA: Scene;
  let sceneB: Scene;
  let goblin: LibraryAsset;
  let lurker: LibraryAsset;

  beforeEach(async () => {
    h = await startLive();
    live = createLiveCommands(h.data.db);
    sceneA = await h.scene('Undo A', (await h.image('undo map A', 96)).id);
    sceneB = await h.scene('Undo B', (await h.image('undo map B', 80)).id);
    goblin = await h.asset('Goblin');
    lurker = await h.asset('Lurker', { category: 'monster', default_hidden: true });
    effects(live.apply(command('scene.activate', { scene_id: sceneA.id })));
  });

  afterEach(async () => {
    await h.close();
  });

  const effects = (result: ReturnType<LiveCommands['apply']>): LiveEffect[] => {
    expect(Array.isArray(result), JSON.stringify(result)).toBe(true);
    return result as LiveEffect[];
  };
  const refusal = (result: ReturnType<LiveCommands['apply']>): string => (result as ErrorEnvelope).error.code;
  const tokens = () => h.data.db.prepare('SELECT * FROM token ORDER BY id').all();
  const scenes = () => h.data.db.prepare('SELECT id, token_numbers FROM scene ORDER BY id').all();
  const undo = () => live.apply(command('undo'));
  const add = (asset: LibraryAsset, x = 1, y = 1) => {
    const [effect] = effects(live.apply(command('token.add', { scene_id: sceneA.id, asset_id: asset.id, x, y })));
    return (effect as { token: SceneToken }).token;
  };

  it('acknowledges undo with nothing to undo, changing and telling nothing', () => {
    const before = tokens();
    expect(effects(undo())).toEqual([]);
    expect(tokens()).toEqual(before);
  });

  it('undoes each token command, a hidden token included, and restores the database', () => {
    const visible = add(goblin, 1, 1);
    const hidden = add(lurker, 2, 2);
    expect(hidden.hidden).toBe(true);
    const start = tokens();

    // A move of each, undone in turn: back where they were.
    effects(live.apply(command('token.move', { token_id: hidden.id, x: 5, y: 5 })));
    effects(live.apply(command('token.move', { token_id: visible.id, x: 6, y: 6 })));
    const [back] = effects(undo());
    expect(back).toMatchObject({ type: 'token.updated', token: { id: visible.id, x: 1, y: 1 } });
    expect(effects(undo())[0]).toMatchObject({ type: 'token.updated', token: { id: hidden.id, x: 2, y: 2 } });
    expect(tokens()).toEqual(start);

    // A hide of the lone visible goblin, undone: shown again as the "Goblin" it was, not numbered as a
    // first showing would be (specs/05-assets-and-images.md §3, D-117).
    expect(visible.label).toBe('Goblin');
    effects(live.apply(command('token.setVisibility', { token_id: visible.id, hidden: true })));
    expect(effects(undo())[0]).toMatchObject({
      type: 'token.updated',
      before: { hidden: true },
      token: { hidden: false },
    });
    expect(tokens()).toEqual(start);

    // A delete of each, undone: the same tokens, same ids, labels, places, visibility and stacking.
    effects(live.apply(command('token.delete', { token_id: visible.id })));
    effects(live.apply(command('token.delete', { token_id: hidden.id })));
    expect(effects(undo())).toEqual([{ type: 'token.added', token: readToken(h.data.db, hidden.id), relabelled: [] }]);
    expect(effects(undo())[0]).toMatchObject({ type: 'token.added', token: { id: visible.id, hidden: false } });
    expect(tokens()).toEqual(start);

    // The adds, undone: both gone.
    const numbers = scenes();
    expect(effects(undo())[0]).toMatchObject({ type: 'token.removed', token: { id: hidden.id, hidden: true } });
    expect(effects(undo())[0]).toMatchObject({ type: 'token.removed', token: { id: visible.id } });
    expect(tokens()).toEqual([]);
    // Numbers once issued stay issued: undoing an add is a deletion (Q-063, D-117).
    expect(scenes()).toEqual(numbers);
    expect(effects(undo())).toEqual([]);
  });

  it('undoes a reveal by hiding the token again, which keeps the number the reveal gave it (Q-092, D-117)', () => {
    const hidden = add(lurker);
    expect(hidden.label).toBe('Lurker');
    const [revealed] = effects(live.apply(command('token.setVisibility', { token_id: hidden.id, hidden: false })));
    expect((revealed as { token: SceneToken }).token).toMatchObject({ hidden: false, label: 'Lurker' });
    const [hiddenAgain] = effects(undo());
    expect(hiddenAgain).toMatchObject({ type: 'token.updated', token: { id: hidden.id, hidden: true } });
    expect(readToken(h.data.db, hidden.id)).toMatchObject({ hidden: true });
  });

  it('records nothing for a command that changed nothing, and nothing for undo itself', () => {
    const hidden = add(lurker);
    expect(live.history.size).toBe(1);
    expect(effects(live.apply(command('token.setVisibility', { token_id: hidden.id, hidden: true })))).toEqual([]);
    expect(live.history.size).toBe(1);
    effects(undo());
    expect(live.history.size).toBe(0);
    expect(effects(undo())).toEqual([]);
  });

  it('records nothing for a drop back where the token was, so Ctrl+Z undoes the move before it (review C1)', () => {
    const placed = add(goblin, 1, 1);
    effects(live.apply(command('token.move', { token_id: placed.id, x: 4, y: 4 })));
    const size = live.history.size;
    effects(live.apply(command('token.move', { token_id: placed.id, x: 4, y: 4 })));
    expect(live.history.size).toBe(size);
    expect(effects(undo())[0]).toMatchObject({ type: 'token.updated', token: { id: placed.id, x: 1, y: 1 } });
  });

  it("restores a bare-named token with its asset's current name when the asset was renamed since (review C2)", async () => {
    const hidden = add(lurker);
    const numbered = [add(goblin, 1, 1), add(goblin, 2, 2)][1]!;
    expect(hidden.label).toBe('Lurker');
    expect(numbered.label).toBe('Goblin 2');
    effects(live.apply(command('token.delete', { token_id: hidden.id })));
    effects(live.apply(command('token.delete', { token_id: numbered.id })));
    for (const [asset, name] of [
      [lurker, 'Shade'],
      [goblin, 'Hobgoblin'],
    ] as const) {
      ok(await h.inject({ method: 'PATCH', url: `/api/assets/${asset.id}`, payload: { name } }));
    }
    // A numbered label was shown to players and stays; a bare name follows the asset (D-111, Q-094).
    expect(effects(undo())[0]).toMatchObject({ type: 'token.added', token: { id: numbered.id, label: 'Goblin 2' } });
    expect(effects(undo())[0]).toMatchObject({ type: 'token.added', token: { id: hidden.id, label: 'Shade' } });
    // Revealed, it is numbered as a first showing, being the bare name of its asset (Q-092).
    const [revealed] = effects(live.apply(command('token.setVisibility', { token_id: hidden.id, hidden: false })));
    expect((revealed as { token: SceneToken }).token.label).toBe('Shade');
  });

  it('records nothing for a refused command', () => {
    expect(refusal(live.apply(command('token.move', { token_id: id(77), x: 1, y: 1 })))).toBe('not_found');
    expect(refusal(live.apply(command('token.add', { scene_id: sceneB.id, asset_id: goblin.id, x: 1, y: 1 })))).toBe(
      'scene_not_live',
    );
    expect(live.history.size).toBe(0);
  });

  it('is cleared when another scene is activated, and kept when the live scene is activated again', () => {
    add(goblin);
    effects(live.apply(command('scene.activate', { scene_id: sceneA.id })));
    expect(live.history.size).toBe(1);
    effects(live.apply(command('scene.activate', { scene_id: sceneB.id })));
    expect(live.history.size).toBe(0);
    effects(live.apply(command('scene.activate', { scene_id: sceneA.id })));
    const before = tokens();
    expect(effects(undo())).toEqual([]);
    expect(tokens()).toEqual(before);
  });

  it('keeps the history when activating an unknown scene is refused', () => {
    add(goblin);
    expect(refusal(live.apply(command('scene.activate', { scene_id: id(77) })))).toBe('not_found');
    expect(live.history.size).toBe(1);
  });

  it('is cleared by Blank TV: going live on the same scene again starts a new history (D-117)', () => {
    const placed = add(goblin);
    effects(live.apply(command('scene.deactivate')));
    expect(live.history.size).toBe(0);
    // With nothing live, undo has nothing to undo.
    expect(effects(undo())).toEqual([]);
    effects(live.apply(command('scene.activate', { scene_id: sceneA.id })));
    expect(effects(undo())).toEqual([]);
    expect(readToken(h.data.db, placed.id)).toBeDefined();
  });

  it('is cleared by deleting the live scene over REST: undo then has nothing to undo (D-117)', async () => {
    add(goblin);
    const summary = await h.inject({ method: 'GET', url: `/api/scenes/${sceneA.id}/deletion` });
    ok(
      await h.inject({
        method: 'DELETE',
        url: `/api/scenes/${sceneA.id}`,
        payload: { confirm: summary.json<object>() },
      }),
      204,
    );
    expect(effects(undo())).toEqual([]);
    expect(live.history.size).toBe(0);
    effects(live.apply(command('scene.activate', { scene_id: sceneB.id })));
    expect(effects(undo())).toEqual([]);
  });

  it('drops an inverse that no longer applies, refusing it as its command would be and changing nothing', async () => {
    // A move whose token another DM browser deleted since.
    const moved = add(goblin);
    effects(live.apply(command('token.move', { token_id: moved.id, x: 4, y: 4 })));
    h.data.db.prepare('DELETE FROM token WHERE id = ?').run(moved.id);
    expect(refusal(undo())).toBe('not_found');
    // The add below it is next, and its token is already gone too.
    expect(refusal(undo())).toBe('not_found');
    expect(live.history.size).toBe(0);

    // A delete whose asset was deleted meanwhile, which nothing then used.
    const lone = await h.asset('Lone wolf');
    const wolf = add(lone);
    effects(live.apply(command('token.delete', { token_id: wolf.id })));
    ok(await h.inject({ method: 'DELETE', url: `/api/assets/${lone.id}` }), 204);
    const before = tokens();
    expect(refusal(undo())).toBe('reference_not_found');
    expect(tokens()).toEqual(before);
  });
});

describe('redo (UIX-01, specs/04-live-sync.md §8)', () => {
  it('redoes an undo by applying the inverse of the inverse, a restore undone by deleting again', () => {
    const before = token({ x: 2, y: 3 });
    const moved: LiveEffect = { type: 'token.updated', before: { ...before, x: 5 }, token: before, relabelled: [] };
    expect(inverseOfInverse(move(5), [moved])).toEqual({
      type: 'token.move',
      payload: { token_id: before.id, x: 5, y: 3 },
    });
    expect(
      inverseOfInverse({ type: 'token.add', restore: before, shown: true }, [
        { type: 'token.added', token: before, relabelled: [] },
      ]),
    ).toEqual({ type: 'token.delete', payload: { token_id: before.id } });
    expect(
      inverseOfInverse({ type: 'token.delete', payload: { token_id: before.id } }, [
        { type: 'token.removed', token: before, shown: false },
      ]),
    ).toEqual({ type: 'token.add', restore: before, shown: false });
    expect(inverseOfInverse(move(5), [])).toBeUndefined();
  });

  it('keeps redos until a new command, which empties them; a redone command keeps them', () => {
    const history = new UndoHistory();
    history.recordRedo(id(9), move(1));
    history.recordRedo(id(9), move(2));
    expect(history.stateFor(id(9))).toEqual({ can_undo: false, can_redo: true });
    expect(history.popRedo(id(9))).toEqual(move(2));
    history.record(id(9), move(3), true);
    expect(history.redoSize).toBe(1);
    history.record(id(9), move(4));
    expect(history.redoSize).toBe(0);
    expect(history.stateFor(id(9))).toEqual({ can_undo: true, can_redo: false });
  });

  it('belongs to the live scene, as the history does: another scene empties both', () => {
    const history = new UndoHistory();
    history.record(id(9), move(1));
    history.recordRedo(id(9), move(2));
    expect(history.stateFor(id(8))).toEqual({ can_undo: false, can_redo: false });
    expect(history.popRedo(id(8))).toBeUndefined();
    expect(history.size).toBe(0);
    expect(history.redoSize).toBe(0);
  });
});

describe('redo with the live commands, against a real SQLite file (UIX-01)', () => {
  let h: LiveHarness;
  let live: LiveCommands;
  let scene: Scene;
  let other: Scene;
  let goblin: LibraryAsset;

  beforeEach(async () => {
    h = await startLive();
    live = createLiveCommands(h.data.db);
    scene = await h.scene('Redo', (await h.image('redo map', 96)).id);
    other = await h.scene('Redo other', (await h.image('redo map other', 80)).id);
    goblin = await h.asset('Goblin');
    live.apply(command('scene.activate', { scene_id: scene.id }));
  });

  afterEach(async () => {
    await h.close();
  });

  const effects = (result: ReturnType<LiveCommands['apply']>): LiveEffect[] => {
    expect(Array.isArray(result), JSON.stringify(result)).toBe(true);
    return result as LiveEffect[];
  };
  const tokens = () => h.data.db.prepare('SELECT * FROM token ORDER BY id').all();
  const add = () => {
    const [effect] = effects(live.apply(command('token.add', { scene_id: scene.id, asset_id: goblin.id, x: 1, y: 1 })));
    return (effect as { token: SceneToken }).token;
  };
  const undo = () => effects(live.apply(command('undo')));
  const redo = () => effects(live.apply(command('redo')));

  it('acknowledges redo with nothing to redo, changing and telling nothing', () => {
    add();
    const before = tokens();
    expect(redo()).toEqual([]);
    expect(tokens()).toEqual(before);
  });

  it('redoes a move, a hide and a delete, each undoable again, the database as after the command', () => {
    const placed = add();
    effects(live.apply(command('token.move', { token_id: placed.id, x: 6, y: 2 })));
    const moved = tokens();
    undo();
    expect(redo()[0]).toMatchObject({ type: 'token.updated', token: { id: placed.id, x: 6, y: 2 } });
    expect(tokens()).toEqual(moved);

    effects(live.apply(command('token.setVisibility', { token_id: placed.id, hidden: true })));
    undo();
    expect(redo()[0]).toMatchObject({ type: 'token.updated', token: { id: placed.id, hidden: true } });

    effects(live.apply(command('token.delete', { token_id: placed.id })));
    const deleted = tokens();
    undo();
    expect(readToken(h.data.db, placed.id)).toBeDefined();
    expect(redo()[0]).toMatchObject({ type: 'token.removed', token: { id: placed.id } });
    expect(tokens()).toEqual(deleted);
    // And undone once more: the same token back.
    expect(undo()[0]).toMatchObject({ type: 'token.added', token: { id: placed.id } });
  });

  it('redoes several undos in order, newest undo first', () => {
    const placed = add();
    for (const x of [2, 3, 4]) effects(live.apply(command('token.move', { token_id: placed.id, x, y: 1 })));
    undo();
    undo();
    expect(readToken(h.data.db, placed.id)).toMatchObject({ x: 2 });
    redo();
    expect(readToken(h.data.db, placed.id)).toMatchObject({ x: 3 });
    redo();
    expect(readToken(h.data.db, placed.id)).toMatchObject({ x: 4 });
    expect(redo()).toEqual([]);
  });

  it('is emptied by a new command, and not by one that is not undoable', () => {
    const placed = add();
    effects(live.apply(command('token.move', { token_id: placed.id, x: 5, y: 5 })));
    undo();
    live.apply(command('ruler.update', { scene_id: scene.id, from: { column: 0, row: 0 }, to: { column: 2, row: 2 } }));
    expect(live.history.redoSize).toBe(1);
    effects(live.apply(command('token.move', { token_id: placed.id, x: 7, y: 7 })));
    expect(live.history.redoSize).toBe(0);
    expect(redo()).toEqual([]);
  });

  it('is emptied by activating another scene', () => {
    const placed = add();
    effects(live.apply(command('token.move', { token_id: placed.id, x: 5, y: 5 })));
    undo();
    live.apply(command('scene.activate', { scene_id: other.id }));
    expect(live.history.stateFor(other.id)).toEqual({ can_undo: false, can_redo: false });
    live.apply(command('scene.activate', { scene_id: scene.id }));
    expect(redo()).toEqual([]);
  });
});
