// @vitest-environment jsdom
import { act, createElement } from 'react';
import Konva from 'konva';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { WHEEL_REST_MS } from './wheel.js';

// The Initiative tab of the DM view (TBL-06, DMT-02, specs/08-ux-journeys.md §12, specs/04-live-sync.md §14,
// Q-111, Q-117, Q-118), against the scripted server, which applies the same encounter rules as the server
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
const offer = (view: HTMLElement) => view.querySelector<HTMLElement>('.eg-initiative__offer');
const rowOf = (view: HTMLElement, name: string) =>
  [...view.querySelectorAll<HTMLElement>('.eg-initiative__row')].find(
    (row) => row.querySelector('.eg-initiative__name')!.textContent === name,
  )!;
/** Delivers a token change the server made elsewhere, as another DM browser's command would. */
function changed(token: SceneToken, fields: Partial<SceneToken>) {
  Object.assign(token, fields);
  server.deliver('token.updated', { token: structuredClone(token), relabelled: [] });
}
function revealed(...tokens: SceneToken[]) {
  for (const token of tokens) {
    token.hidden = false;
    server.deliver('token.added', { token: structuredClone(token), relabelled: [] });
  }
}
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
  it('steps a number with the mouse wheel, shown at once and sent once the wheel rests, then sorted (Q-127)', async () => {
    const view = await open(hall);
    await click(view.querySelector(`[data-scene="${cave.id}"] .eg-scenes__select`));
    await click(button(view, t('initiative.start')));
    const wheel = (name: string, deltaY: number) => {
      const event = new WheelEvent('wheel', { deltaY, deltaMode: 1, bubbles: true, cancelable: true });
      act(() => {
        field(view, name).dispatchEvent(event);
      });
      return event;
    };
    const sentBefore = commands().length;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      // An empty field starts at 10; three notches up make 13, the panel left unscrolled.
      expect(wheel('Goblin', -3).defaultPrevented).toBe(true);
      wheel('Goblin', -3);
      wheel('Goblin', -3);
      wheel('Goblin', 3);
      wheel('Goblin', -3);
      expect(field(view, 'Goblin').value).toBe('12');
      expect(commands()).toHaveLength(sentBefore);
      act(() => {
        vi.advanceTimersByTime(WHEEL_REST_MS);
      });
    } finally {
      vi.useRealTimers();
    }
    await settle();
    const sent = commands().slice(sentBefore);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'encounter.setInitiative', payload: { initiative: 12 } });
    expect(rows(view)[0]).toBe('Goblin');
    // Ctrl and the wheel stays the browser's zoom.
    const zoom = new WheelEvent('wheel', { deltaY: -3, deltaMode: 1, ctrlKey: true, bubbles: true, cancelable: true });
    field(view, 'Wren').dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(false);
    expect(field(view, 'Wren').value).toBe('');
  });

  it('asks for the live scene, and starts combat from the visible player characters and monsters', async () => {
    const view = await open(hall);
    expect(view.textContent).toContain(t('initiative.notLive'));
    await click(view.querySelector(`[data-scene="${cave.id}"] .eg-scenes__select`));
    await click(button(view, t('initiative.start')));
    expect(commands()).toContainEqual({ type: 'encounter.start', payload: { scene_id: cave.id } });
    expect(rows(view)).toEqual(['Tamsin', 'Wren', 'Goblin']);
    // A monster's row is a row like the others, in the monster ring colour.
    expect(rowOf(view, 'Goblin').dataset.kind).toBe('monster');
    expect(rowOf(view, 'Goblin').querySelector('.eg-avatar--monster img')).not.toBeNull();
    expect(field(view, 'Goblin')).not.toBeNull();
    expect(currentRow(view)?.textContent).toContain('Tamsin');
    expect(view.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe(
      t('side.initiativeRound', { round: 1 }),
    );
  });

  it('sorts by the numbers typed, keeps a tie in its order, and a drag stands until a number is typed', async () => {
    const view = await open();
    await click(button(view, t('initiative.start')));
    await commit(field(view, 'Wren'), '17');
    expect(rows(view)).toEqual(['Wren', 'Tamsin', 'Goblin']);
    // A tie: the goblin's 17 keeps it below Wren, as it stood.
    await commit(field(view, 'Goblin'), '17');
    expect(rows(view)).toEqual(['Wren', 'Goblin', 'Tamsin']);
    // A drag breaks the tie: the goblin dropped on Wren's row goes first.
    const [wrenRow, goblinRow] = [...view.querySelectorAll<HTMLElement>('.eg-initiative__row')];
    const data = { effectAllowed: '', dropEffect: '', setData: () => {}, getData: () => '' };
    const drag = (target: HTMLElement, name: string) =>
      act(() => {
        const event = new Event(name, { bubbles: true, cancelable: true });
        Object.assign(event, { dataTransfer: data });
        target.dispatchEvent(event);
      });
    // Dragged over Wren, the goblin takes its place at once, its slot marked, and Wren makes room; nothing is sent
    // until the drop, and a drag that ends outside the list puts the order back.
    const sentBefore = commands().length;
    drag(goblinRow!, 'dragstart');
    await settle();
    drag(wrenRow!, 'dragover');
    expect(rows(view)).toEqual(['Goblin', 'Wren', 'Tamsin']);
    expect(goblinRow!.classList.contains('eg-initiative__row--dragging')).toBe(true);
    expect(commands()).toHaveLength(sentBefore);
    drag(goblinRow!, 'dragend');
    expect(rows(view)).toEqual(['Wren', 'Goblin', 'Tamsin']);
    expect(goblinRow!.classList.contains('eg-initiative__row--dragging')).toBe(false);
    drag(goblinRow!, 'dragstart');
    drag(wrenRow!, 'dragover');
    // Dropped anywhere in the list, on its own slot included, the order shown is the one sent.
    drag(goblinRow!, 'drop');
    await settle();
    expect(rows(view)).toEqual(['Goblin', 'Wren', 'Tamsin']);
    expect(
      commands()
        .slice(sentBefore)
        .filter((command) => command.type === 'encounter.reorder'),
    ).toHaveLength(1);
    // Typing another number sorts again, and the tie keeps the dragged order.
    await commit(field(view, 'Tamsin'), '5');
    expect(rows(view)).toEqual(['Goblin', 'Wren', 'Tamsin']);
    // Move Tamsin up, as a drag would: the order stands until a number is typed.
    await click(button(view, t('initiative.moveUpOf', { name: 'Tamsin' })));
    expect(rows(view)).toEqual(['Goblin', 'Tamsin', 'Wren']);
    await commit(field(view, 'Tamsin'), '4');
    expect(rows(view)).toEqual(['Goblin', 'Wren', 'Tamsin']);
    // What is not a whole number goes back to the number stored, sending nothing.
    const sent = commands().length;
    await commit(field(view, 'Wren'), 'twelve');
    expect(field(view, 'Wren').value).toBe('17');
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

  it('rings the token whose turn it is on the map, a monster’s as a player character’s', async () => {
    const view = await open();
    await click(button(view, t('initiative.start')));
    await settle();
    expect(ringed('token-turn')).toEqual([`token-${tamsin.id}`]);
    key(document.body, { key: 'Enter' });
    key(document.body, { key: 'Enter' });
    await settle();
    expect(ringed('token-turn')).toEqual([`token-${goblin.id}`]);
    expect(currentRow(view)?.textContent).toContain('Goblin');
  });

  it('greys a Dead monster and passes it over, removes the dead, and asks whether to end combat', async () => {
    const view = await open();
    await click(button(view, t('initiative.start')));
    changed(goblin, { markers: [{ id: 'dead' }] });
    await settle();
    expect(rowOf(view, 'Goblin').classList).toContain('eg-initiative__row--dead');
    expect(rowOf(view, 'Goblin').textContent).toContain(t('initiative.passedDead'));
    // Asked only once the turn passes.
    expect(view.textContent).not.toContain(t('initiative.noEnemies'));
    key(document.body, { key: 'Enter' });
    await settle();
    expect(encounter().current_index).toBe(1);
    expect(view.textContent).toContain(t('initiative.noEnemies'));
    // Continue leaves combat running; the dead goblin is passed over.
    await click(button(view.querySelector('.eg-initiative__prompt')!, t('initiative.continue')));
    expect(view.textContent).not.toContain(t('initiative.noEnemies'));
    key(document.body, { key: 'Enter' });
    await settle();
    expect(encounter()).toMatchObject({ current_index: 0, round: 2 });
    // Remove dead takes the goblin's row; the encounter still had an enemy.
    await click(button(view.querySelector('.eg-initiative__head')!, t('initiative.removeDead')));
    expect(rows(view)).toEqual(['Tamsin', 'Wren']);
    expect(button(view.querySelector('.eg-initiative__head')!, t('initiative.removeDead'))).toBeUndefined();
    key(document.body, { key: 'Enter' });
    await settle();
    await click(button(view.querySelector('.eg-initiative__prompt')!, t('initiative.end')));
    expect(encounter().active).toBe(false);
    expect(view.textContent).toContain(t('initiative.start'));
  });

  it('never asks to end combat in an encounter that never had a monster entry', async () => {
    changed(goblin, { hidden: true });
    const view = await open();
    await click(button(view, t('initiative.start')));
    expect(rows(view)).toEqual(['Tamsin', 'Wren']);
    for (let turn = 0; turn < 3; turn += 1) key(document.body, { key: 'Enter' });
    await settle();
    expect(encounter().round).toBe(2);
    expect(view.textContent).not.toContain(t('initiative.noEnemies'));
  });

  it('dims a monster players cannot see, and passes it over', async () => {
    const view = await open();
    await click(button(view, t('initiative.start')));
    changed(goblin, { hidden: true });
    await settle();
    expect(rowOf(view, 'Goblin').classList).toContain('eg-initiative__row--unseen');
    expect(rowOf(view, 'Goblin').textContent).toContain(t('initiative.passed'));
    key(document.body, { key: 'Enter' });
    key(document.body, { key: 'Enter' });
    await settle();
    expect(encounter()).toMatchObject({ current_index: 0, round: 2 });
  });

  it('offers the monsters a reveal shows in one prompt, each with its number, and Skip adds none', async () => {
    const view = await open();
    await click(button(view, t('initiative.start')));
    await commit(field(view, 'Tamsin'), '18');
    await commit(field(view, 'Wren'), '10');
    const bandit = server.addAsset({ name: 'Bandit', category: 'monster', default_hidden: true });
    const bandits = [1, 2, 3].map((n) =>
      server.addToken(cave.id, bandit, { x: 10 + n, y: 4, label: `Bandit ${n}`, hidden: true }),
    );
    revealed(...bandits);
    await settle();
    // One prompt for all three, each with its own number field.
    expect(view.querySelectorAll('.eg-initiative__offer')).toHaveLength(1);
    expect(offer(view)!.textContent).toContain(t('initiative.offerMany', { count: 3 }));
    expect([...offer(view)!.querySelectorAll('[data-offer-token]')].map((row) => row.textContent)).toEqual([
      'Bandit 1',
      'Bandit 2',
      'Bandit 3',
    ]);
    await click(button(offer(view)!, t('initiative.skip')));
    expect(offer(view)).toBeNull();
    expect(rows(view)).toEqual(['Tamsin', 'Wren', 'Goblin']);
    expect(commands().some((command) => command.type === 'encounter.addEntry')).toBe(false);
    // Hidden and revealed again, they are not offered a second time in this browser.
    revealed(...bandits);
    await settle();
    expect(offer(view)).toBeNull();
  });

  it('adds the monsters a reveal shows by the numbers typed, and the others at the end', async () => {
    const view = await open();
    await click(button(view, t('initiative.start')));
    await commit(field(view, 'Tamsin'), '18');
    await commit(field(view, 'Wren'), '10');
    const bandit = server.addAsset({ name: 'Bandit', category: 'monster', default_hidden: true });
    const bandits = [1, 2, 3].map((n) =>
      server.addToken(cave.id, bandit, { x: 10 + n, y: 4, label: `Bandit ${n}`, hidden: true }),
    );
    revealed(...bandits);
    await settle();
    const numberOf = (name: string) =>
      offer(view)!.querySelector<HTMLInputElement>(`input[aria-label="${t('initiative.numberOf', { name })}"]`)!;
    await type(numberOf('Bandit 1'), '12');
    await type(numberOf('Bandit 3'), '10');
    // What is not a number keeps the offer from being sent.
    await type(numberOf('Bandit 2'), 'x');
    expect(button(offer(view)!, t('initiative.addAll'))!.disabled).toBe(true);
    await type(numberOf('Bandit 2'), '');
    await click(button(offer(view)!, t('initiative.addAll')));
    // Bandit 1 by its 12, Bandit 3 after Wren's equal 10, Bandit 2 at the end.
    expect(rows(view)).toEqual(['Tamsin', 'Bandit 1', 'Wren', 'Bandit 3', 'Goblin', 'Bandit 2']);
    expect(offer(view)).toBeNull();
    expect(commands().filter((command) => command.type === 'encounter.addEntry')).toEqual([
      { type: 'encounter.addEntry', payload: { scene_id: cave.id, token_id: bandits[0]!.id, initiative: 12 } },
      { type: 'encounter.addEntry', payload: { scene_id: cave.id, token_id: bandits[1]!.id } },
      { type: 'encounter.addEntry', payload: { scene_id: cave.id, token_id: bandits[2]!.id, initiative: 10 } },
    ]);
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
    expect(offer(view)!.textContent).toContain(t('initiative.offer', { name: 'Oren' }));
    await click(button(offer(view)!, t('initiative.add')));
    expect(rows(view)).toEqual(['Tamsin', 'Wren', 'Goblin', 'Oren']);
    expect(offer(view)).toBeNull();
  });

  it('removes a row, and the token’s popover adds it back to the order', async () => {
    const view = await open();
    await click(button(view, t('initiative.start')));
    await click(button(view, t('initiative.removeOf', { name: 'Goblin' })));
    expect(rows(view)).toEqual(['Tamsin', 'Wren']);
    // Removed by the DM, it is not offered back.
    expect(offer(view)).toBeNull();
    await click(view.querySelector('[role="tab"]:nth-child(1)'));
    await selectTokenRow(view, 'Goblin');
    await tokenMenu(view, 'Goblin', t('initiative.addToOrder'));
    await click(view.querySelector('[role="tab"]:nth-child(2)'));
    expect(rows(view)).toEqual(['Tamsin', 'Wren', 'Goblin']);
    // A token with an entry has no such action; a Dead monster's says why it cannot.
    await click(view.querySelector('[role="tab"]:nth-child(1)'));
    await selectTokenRow(view, 'Goblin');
    await expect(tokenMenu(view, 'Goblin', t('initiative.addToOrder'))).rejects.toThrow(/no menu item/);
    key(document.activeElement ?? document.body, { key: 'Escape' });
    changed(goblin, { markers: [{ id: 'dead' }] });
    await click(view.querySelector('[role="tab"]:nth-child(2)'));
    await click(button(view.querySelector('.eg-initiative__head')!, t('initiative.removeDead')));
    await click(view.querySelector('[role="tab"]:nth-child(1)'));
    await selectTokenRow(view, 'Goblin');
    const sent = commands().length;
    await tokenMenu(view, 'Goblin', t('initiative.addToOrder'));
    expect(document.body.textContent).toContain(t('initiative.addDead'));
    expect(commands()).toHaveLength(sent);
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

  it('removes a deleted token’s row, and undo puts it back', async () => {
    const view = await open();
    await click(button(view, t('initiative.start')));
    // The token list is on the first tab.
    await click(view.querySelector('[role="tab"]:nth-child(1)'));
    await selectTokenRow(view, 'Wren');
    await tokenMenu(view, 'Wren', t('tokens.delete'));
    await click(button(document.querySelector('dialog[open]')!, t('tokens.deleteDialog.confirm')));
    await click(view.querySelector('[role="tab"]:nth-child(2)'));
    expect(rows(view)).toEqual(['Tamsin', 'Goblin']);
    key(document.body, { key: 'z', ctrlKey: true });
    await settle();
    expect(rows(view)).toEqual(['Tamsin', 'Wren', 'Goblin']);
  });
});
