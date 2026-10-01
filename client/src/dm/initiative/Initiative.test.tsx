// @vitest-environment jsdom
import { act, createElement } from 'react';
import Konva from 'konva';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Scene, SceneToken } from '@emberglass/shared';
import { t } from '../../ui/messages.js';
import { installCanvas2d, installImageLoading, installResizeObserver } from '../../ui/testing/canvas2d.js';
import {
  button,
  click,
  FakeServer,
  installDialog,
  openSwitcher,
  selectTokenRow,
  settle,
  tokenMenu,
  type,
} from '../../ui/testing/fakeServer.js';
import { render, type Rendered } from '../../ui/testing/render.js';
import { Workspace } from '../Workspace.js';

// The Initiative tab of the DM view (TBL-06, specs/08-ux-journeys.md §12, specs/04-live-sync.md §14, Q-104,
// Q-106), against the scripted server, which applies the same encounter rules as the server
// (shared/src/encounter.ts).

let server: FakeServer;
let rendered: Rendered | undefined;
let cave: Scene;
let hall: Scene;
let tamsin: SceneToken;
let goblin: SceneToken;

beforeEach(() => {
  installCanvas2d();
  installResizeObserver({ width: 800, height: 600 });
  installImageLoading();
  installDialog();
  server = new FakeServer().install();
  const session = server.addSession(server.addCampaign('Lost Mine').id, 'One');
  cave = server.addScene(session.id, 'Cave');
  hall = server.addScene(session.id, 'Hall');
  const map = server.addImage({ width: 4000, height: 3000, variants: { display: { width: 2000, height: 1500 } } });
  for (const scene of server.scenes) {
    scene.map_image_id = map.id;
    scene.grid = { ...scene.grid, size: 100, offset_x: 0, offset_y: 0, columns: 40, rows: 30 };
  }
  tamsin = server.addToken(cave.id, server.addAsset({ name: 'Tamsin', category: 'pc', default_hidden: false }), {
    x: 1,
    y: 1,
  });
  server.addToken(cave.id, server.addAsset({ name: 'Wren', category: 'pc', default_hidden: false }), {
    x: 2,
    y: 1,
  });
  goblin = server.addToken(cave.id, server.addAsset({ name: 'Goblin', category: 'monster', default_hidden: false }), {
    x: 6,
    y: 6,
  });
  server.liveSceneId = cave.id;
});

afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  server.uninstall();
});

async function open(scene: Scene = cave): Promise<HTMLElement> {
  rendered = render(createElement(Workspace, { mainId: 'main' }));
  await settle();
  await server.openSockets();
  const view = rendered.container;
  await openSwitcher(view);
  await click(button(view, 'Lost Mine'));
  await click(button(view, t('tree.openOf', { name: 'One' })));
  await click(view.querySelector(`[data-scene="${scene.id}"] .eg-scenes__select`));
  await click(view.querySelector('[role="tab"]:nth-child(2)'));
  return view;
}

const commands = () => server.sockets.flatMap((socket) => socket.commands());
const rows = (view: HTMLElement) =>
  [...view.querySelectorAll<HTMLElement>('.eg-initiative__row')].map(
    (row) => row.querySelector('.eg-initiative__name')!.textContent,
  );
const currentRow = (view: HTMLElement) => view.querySelector<HTMLElement>('.eg-initiative__row--current');
const field = (view: HTMLElement, name: string) =>
  view.querySelector<HTMLInputElement>(`input[aria-label="${t('initiative.numberOf', { name })}"]`)!;
const encounter = () => server.encounters[cave.id]!;
const stage = () => Konva.stages.filter((each) => each.findOne('.tokens')).at(-1)!;
const ringed = (name: string) =>
  stage()
    .find(`.${name}`)
    .map((ring) => ring.getParent()!.id());

function key(target: EventTarget, init: KeyboardEventInit) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  });
}

async function commit(input: HTMLInputElement, value: string) {
  await type(input, value);
  key(input, { key: 'Enter' });
  await settle();
}

describe('the Initiative tab (08 §12)', () => {
  it('asks for the live scene, and starts combat from the visible player characters and one Enemies row', async () => {
    const view = await open(hall);
    expect(view.textContent).toContain(t('initiative.notLive'));
    await click(view.querySelector(`[data-scene="${cave.id}"] .eg-scenes__select`));
    await click(button(view, t('initiative.start')));
    expect(commands()).toContainEqual({ type: 'encounter.start', payload: { scene_id: cave.id } });
    expect(rows(view)).toEqual(['Tamsin', 'Wren', t('initiative.enemies')]);
    expect(currentRow(view)?.textContent).toContain('Tamsin');
    expect(view.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe(
      t('side.initiativeRound', { round: 1 }),
    );
  });

  it('sorts by the numbers typed, with the unnumbered below, and a drag stands until a number is typed', async () => {
    const view = await open();
    await click(button(view, t('initiative.start')));
    await commit(field(view, 'Wren'), '17');
    expect(rows(view)).toEqual(['Wren', 'Tamsin', t('initiative.enemies')]);
    await commit(field(view, t('initiative.enemies')), '12');
    expect(rows(view)).toEqual(['Wren', t('initiative.enemies'), 'Tamsin']);
    // Move Tamsin up above the Enemies, as a drag to fix a tie would.
    await click(button(view, t('initiative.moveUpOf', { name: 'Tamsin' })));
    expect(rows(view)).toEqual(['Wren', 'Tamsin', t('initiative.enemies')]);
    // A drag and drop: the Enemies dropped on Wren's row go first.
    const [wrenRow, , enemiesRow] = [...view.querySelectorAll<HTMLElement>('.eg-initiative__row')];
    const data = { effectAllowed: '', dropEffect: '', setData: () => {}, getData: () => '' };
    const drag = (target: HTMLElement, name: string) =>
      act(() => {
        const event = new Event(name, { bubbles: true, cancelable: true });
        Object.assign(event, { dataTransfer: data });
        target.dispatchEvent(event);
      });
    drag(enemiesRow!, 'dragstart');
    drag(wrenRow!, 'dragover');
    drag(wrenRow!, 'drop');
    await settle();
    expect(rows(view)).toEqual([t('initiative.enemies'), 'Wren', 'Tamsin']);
    // Typing a number sorts again: Wren's 17 first, the Enemies' 12, then Tamsin without one.
    await commit(field(view, 'Tamsin'), '');
    await commit(field(view, 'Wren'), '18');
    expect(rows(view)).toEqual(['Wren', t('initiative.enemies'), 'Tamsin']);
    // What is not a whole number goes back to the number stored, sending nothing.
    const sent = commands().length;
    await commit(field(view, 'Wren'), 'twelve');
    expect(field(view, 'Wren').value).toBe('18');
    expect(commands()).toHaveLength(sent);
  });

  it('passes turns with Enter and Shift+Enter, never while typing, and counts rounds', async () => {
    const view = await open();
    await click(button(view, t('initiative.start')));
    key(document.body, { key: 'Enter' });
    await settle();
    expect(encounter().current_index).toBe(1);
    expect(currentRow(view)?.textContent).toContain('Wren');
    // Enter in a number field commits it and passes no turn.
    await commit(field(view, 'Tamsin'), '');
    expect(encounter().current_index).toBe(1);
    // Nor on a focused button, which Enter presses.
    key(button(view, t('initiative.end'))!, { key: 'Enter' });
    await settle();
    expect(encounter().current_index).toBe(1);
    key(document.body, { key: 'Enter' });
    key(document.body, { key: 'Enter' });
    await settle();
    expect(encounter()).toMatchObject({ current_index: 0, round: 2 });
    expect(view.querySelector('.eg-initiative__round')!.textContent).toBe(t('initiative.round', { round: 2 }));
    key(document.body, { key: 'Enter', shiftKey: true });
    await settle();
    expect(encounter()).toMatchObject({ current_index: 2, round: 1 });
  });

  it('rings the turn’s player character on the map, and the Enemies’ members on their turn, listed with their conditions', async () => {
    const view = await open();
    await click(button(view, t('initiative.start')));
    await settle();
    expect(ringed('token-turn')).toEqual([`token-${tamsin.id}`]);
    expect(ringed('token-turn-member')).toEqual([]);
    key(document.body, { key: 'Enter' });
    key(document.body, { key: 'Enter' });
    await settle();
    expect(ringed('token-turn')).toEqual([]);
    expect(ringed('token-turn-member')).toEqual([`token-${goblin.id}`]);
    const members = view.querySelector('.eg-initiative__members')!;
    expect(members.textContent).toContain('Goblin');
    // A member chosen is selected on the map.
    await click(members.querySelector('button'));
    expect(ringed('token-selected')).toEqual([`token-${goblin.id}`]);
  });

  it('asks whether to end combat when the Enemies’ turn comes with none left, and Continue passes it', async () => {
    const view = await open();
    await click(button(view, t('initiative.start')));
    goblin.markers = [{ id: 'dead' }];
    server.deliver('token.updated', { token: structuredClone(goblin), relabelled: [] });
    server.encounterElsewhere({ ...encounter(), current_index: 2 });
    await settle();
    expect(view.textContent).toContain(t('initiative.noEnemies'));
    await click(button(view.querySelector('.eg-initiative__prompt')!, t('initiative.continue')));
    expect(encounter()).toMatchObject({ current_index: 0, round: 2 });
    server.encounterElsewhere({ ...encounter(), current_index: 2 });
    await settle();
    await click(button(view.querySelector('.eg-initiative__prompt')!, t('initiative.end')));
    expect(encounter().active).toBe(false);
    expect(view.textContent).toContain(t('initiative.start'));
  });

  it('offers a player character players can now see, at the end of the order', async () => {
    const view = await open();
    await click(button(view, t('initiative.start')));
    const oren = server.addToken(cave.id, server.addAsset({ name: 'Oren', category: 'pc', default_hidden: false }), {
      x: 3,
      y: 3,
    });
    server.deliver('token.added', { token: structuredClone(oren), relabelled: [] });
    await settle();
    expect(view.textContent).toContain(t('initiative.offer', { name: 'Oren' }));
    await click(button(view.querySelector(`[data-offer="${oren.id}"]`)!, t('initiative.add')));
    expect(rows(view)).toEqual(['Tamsin', 'Wren', t('initiative.enemies'), 'Oren']);
    expect(view.textContent).not.toContain(t('initiative.offer', { name: 'Oren' }));
  });

  it('asks before ending combat, and ends it only when confirmed', async () => {
    const view = await open();
    await click(button(view, t('initiative.start')));
    await click(button(view.querySelector('.eg-initiative__head')!, t('initiative.end')));
    const dialog = document.querySelector('dialog[open]')!;
    expect(dialog.textContent).toContain(t('initiative.endDialog.body'));
    await click(button(dialog, t('initiative.endDialog.cancel')));
    expect(encounter().active).toBe(true);
    await click(button(view.querySelector('.eg-initiative__head')!, t('initiative.end')));
    await click(button(document.querySelector('dialog[open]')!, t('initiative.endDialog.confirm')));
    expect(encounter().active).toBe(false);
    expect(commands().at(-1)).toEqual({ type: 'encounter.end', payload: { scene_id: cave.id } });
  });

  it('removes a deleted player character’s row, and undo puts it back', async () => {
    const view = await open();
    await click(button(view, t('initiative.start')));
    // The token list is on the first tab.
    await click(view.querySelector('[role="tab"]:nth-child(1)'));
    await selectTokenRow(view, 'Wren');
    await tokenMenu(view, 'Wren', t('tokens.delete'));
    await click(button(document.querySelector('dialog[open]')!, t('tokens.deleteDialog.confirm')));
    await click(view.querySelector('[role="tab"]:nth-child(2)'));
    expect(rows(view)).toEqual(['Tamsin', t('initiative.enemies')]);
    key(document.body, { key: 'z', ctrlKey: true });
    await settle();
    expect(rows(view)).toEqual(['Tamsin', 'Wren', t('initiative.enemies')]);
  });
});
