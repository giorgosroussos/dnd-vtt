import { describe, expect, it } from 'vitest';
import type { SceneToken } from '@emberglass/shared';
import { deleteCommands, hideCommands, hpCommands, markerCommands, moveCommands } from './group.js';

// What a group action asks of each selected token (UXR-02, specs/08-ux-journeys.md §14): only the changes.

const token = (fields: Partial<SceneToken> & { id: string }): SceneToken =>
  ({
    scene_id: 's',
    asset_id: 'a',
    label: fields.id,
    x: 0,
    y: 0,
    hidden: false,
    z_order: 0,
    markers: [],
    hp_current: null,
    hp_max: null,
    hp_temp: null,
    ac: null,
    notes: '',
    ...fields,
  }) as SceneToken;

describe('group commands', () => {
  it('hides all unless all are hidden, then reveals all, each only when it changes', () => {
    const shown = token({ id: 'a' });
    const hidden = token({ id: 'b', hidden: true });
    expect(hideCommands([shown, hidden])).toEqual({
      hidden: true,
      commands: [{ type: 'token.setVisibility', payload: { token_id: 'a', hidden: true } }],
    });
    expect(hideCommands([hidden, { ...shown, hidden: true }]).hidden).toBe(false);
    expect(hideCommands([hidden, { ...shown, hidden: true }]).commands).toHaveLength(2);
  });

  it('puts a condition on all unless all carry it, keeping the others, and Exhaustion at level 1', () => {
    const prone = token({ id: 'a', markers: [{ id: 'prone' }] });
    const poisoned = token({ id: 'b', markers: [{ id: 'poisoned' }] });
    expect(markerCommands([prone, poisoned], 'prone')).toEqual({
      on: true,
      commands: [
        { type: 'token.setMarkers', payload: { token_id: 'b', markers: [{ id: 'poisoned' }, { id: 'prone' }] } },
      ],
    });
    const both = markerCommands([prone, { ...poisoned, markers: [{ id: 'prone' }, { id: 'poisoned' }] }], 'prone');
    expect(both.on).toBe(false);
    expect(both.commands.map((each) => each.payload)).toEqual([
      { token_id: 'a', markers: [] },
      { token_id: 'b', markers: [{ id: 'poisoned' }] },
    ]);
    expect(markerCommands([prone], 'exhaustion').commands[0]!.payload).toEqual({
      token_id: 'a',
      markers: [{ id: 'prone' }, { id: 'exhaustion', level: 1 }],
    });
  });

  it('applies damage or healing to those with hit points and counts the others', () => {
    const hurt = token({ id: 'a', hp_current: 5, hp_max: 10 });
    const none = token({ id: 'b' });
    expect(hpCommands([hurt, none], -3)).toEqual({
      skipped: 1,
      commands: [{ type: 'token.applyHp', payload: { token_id: 'a', delta: -3 } }],
    });
  });

  it('moves only the tokens whose place changes, and deletes every one', () => {
    const a = token({ id: 'a', x: 1, y: 1 });
    const b = token({ id: 'b', x: 2, y: 2 });
    expect(
      moveCommands(
        [a, b],
        [
          { id: 'a', at: { x: 1, y: 1 } },
          { id: 'b', at: { x: 3, y: 2 } },
          { id: 'gone', at: { x: 0, y: 0 } },
        ],
      ),
    ).toEqual([{ type: 'token.move', payload: { token_id: 'b', x: 3, y: 2 } }]);
    expect(deleteCommands([a, b]).map((each) => each.payload)).toEqual([{ token_id: 'a' }, { token_id: 'b' }]);
  });
});
