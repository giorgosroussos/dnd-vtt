// @vitest-environment jsdom
import { act, createElement } from 'react';
import Konva from 'konva';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandAck, LibraryAsset, Scene, SceneToken } from '@emberglass/shared';
import { t } from '../ui/messages.js';
import { installCanvas2d, installImageLoading, installResizeObserver } from '../ui/testing/canvas2d.js';
import { button, click, FakeServer, installDialog, settle, submit } from '../ui/testing/fakeServer.js';
import { render, type Rendered } from '../ui/testing/render.js';
import { Workspace } from './Workspace.js';

// Live and prep modes in the DM workspace (LIV-04; specs/08-ux-journeys.md §2, specs/04-live-sync.md
// §2, §3, §7, §10, Q-024, Q-025, D-109, G-018, G-024), against a scripted server whose live side
// follows the server's rules for the `dm` room (`client/src/ui/testing/fakeServer.ts`).

let server: FakeServer;
let rendered: Rendered | undefined;
let cave: Scene;
let hall: Scene;
let goblin: LibraryAsset;
let lurker: LibraryAsset;
let caveGoblin: SceneToken;
let caveLurker: SceneToken;

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
  goblin = server.addAsset({ name: 'Goblin', category: 'npc', default_hidden: false });
  lurker = server.addAsset({ name: 'Lurker', category: 'monster' });
  caveGoblin = server.addToken(cave.id, goblin, { x: 2, y: 2 });
  caveLurker = server.addToken(cave.id, lurker, { x: 4, y: 4 });
});

afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  server.uninstall();
});

async function open(): Promise<HTMLElement> {
  rendered = render(createElement(Workspace, { mainId: 'main' }));
  await settle();
  await server.openSockets();
  const view = rendered.container;
  await click(button(view, 'Lost Mine'));
  await click(button(view, 'One'));
  return view;
}

async function selectScene(view: HTMLElement, scene: Scene) {
  await click(view.querySelector(`[data-item="${scene.id}"] [data-action="name"]`));
}

const panel = (view: HTMLElement) => view.querySelector<HTMLElement>('.eg-scene')!;
const mode = (view: HTMLElement) => panel(view).dataset.mode;
const indicator = (view: HTMLElement) => view.querySelector('.eg-scene__canvas--live');
const liveBar = (view: HTMLElement) =>
  view.querySelector(`section[aria-label="${t('liveBar.label')}"] [role="status"]`)!.textContent;
const heading = (view: HTMLElement) => panel(view).querySelector('h1')!.textContent;
const viewport = (view: HTMLElement) => view.querySelector<HTMLElement>('[role="application"]')!;
const stage = () => Konva.stages.filter((each) => each.findOne('.tokens')).at(-1)!;
const drawn = () =>
  stage()
    .find<Konva.Label>('.token-label')
    .map((label) => label.findOne<Konva.Text>('Text')!.text());
const tokenSelect = (view: HTMLElement) =>
  [...view.querySelectorAll('select')].find((each) => each.labels?.[0]?.textContent === t('tokens.selected'))!;
const picker = () => document.querySelector<HTMLDialogElement>('dialog[open]')!;
const tokenWrites = () => server.writes().filter((write) => /\/tokens(\/|$)/.test(write));
const bar = (view: HTMLElement) => view.querySelector<HTMLElement>('.eg-tokens')!;
const commands = () => server.sockets.flatMap((socket) => socket.commands());

async function selectToken(view: HTMLElement, id: string) {
  const select = tokenSelect(view);
  act(() => {
    select.value = id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}

function press(element: HTMLElement, key: string) {
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

const goLiveButton = (view: HTMLElement) => button(view, t('liveBar.goLiveWith', { name: heading(view) }));

async function goLive(view: HTMLElement) {
  await click(goLiveButton(view));
  await settle();
}

describe('one canvas, prep mode and live mode (08 §2, Q-024)', () => {
  it('shows a scene that is not live in prep mode, with Go live and no live indicator', async () => {
    const view = await open();
    await selectScene(view, cave);
    expect(mode(view)).toBe('prep');
    expect(indicator(view)).toBeNull();
    expect(panel(view).textContent).not.toContain(t('scene.live'));
    expect(viewport(view).getAttribute('aria-label')).toBe(t('canvas.label', { name: 'Cave' }));
    expect(goLiveButton(view)?.textContent).toBe(t('liveBar.goLive'));
    expect(liveBar(view)).toBe(t('liveBar.none'));
  });

  it('Go live sends scene.activate for the scene on screen and turns the canvas into live mode', async () => {
    const view = await open();
    await selectScene(view, cave);
    await goLive(view);
    expect(commands()).toEqual([{ type: 'scene.activate', payload: { scene_id: cave.id } }]);
    expect(mode(view)).toBe('live');
    expect(indicator(view)).not.toBeNull();
    expect(panel(view).textContent).toContain(t('scene.live'));
    expect(viewport(view).getAttribute('aria-label')).toBe(t('canvas.labelLive', { name: 'Cave' }));
    expect(goLiveButton(view)).toBeUndefined();
    expect(liveBar(view)).toBe(t('liveBar.live', { name: 'Cave' }));
    // The DM sees every token of the live scene, the hidden one included.
    expect(drawn().sort()).toEqual(['Goblin', 'Lurker']);
  });

  it('Blank TV sends scene.deactivate, and the canvas returns to prep mode with its tokens read again', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    expect(mode(view)).toBe('live');
    const reads = server.calls.filter((call) => call.method === 'GET' && call.path.endsWith('/tokens')).length;
    await click(button(view, t('liveBar.blank')));
    await settle();
    expect(commands()).toEqual([{ type: 'scene.deactivate', payload: {} }]);
    expect(liveBar(view)).toBe(t('liveBar.none'));
    expect(mode(view)).toBe('prep');
    expect(indicator(view)).toBeNull();
    expect(server.calls.filter((call) => call.method === 'GET' && call.path.endsWith('/tokens')).length).toBe(
      reads + 1,
    );
    expect(view.textContent).not.toContain(t('liveBar.blank'));
  });

  it('says why Go live or Blank TV failed', async () => {
    const view = await open();
    await selectScene(view, cave);
    server.beforeCommand = () => ({ error: { code: 'not_found', message: 'test' } });
    await goLive(view);
    expect(view.textContent).toContain(t('scene.goLiveFailed', { reason: t('error.code.not_found') }));
    expect(mode(view)).toBe('prep');
    server.beforeCommand = undefined;
    await goLive(view);
    server.beforeCommand = () => ({ error: { code: 'internal_error', message: 'test' } });
    await click(button(view, t('liveBar.blank')));
    await settle();
    expect(view.textContent).toContain(t('liveBar.blankFailed', { reason: t('error.code.internal_error') }));
    expect(mode(view)).toBe('live');
  });

  it('the live bar returns the canvas to the live scene in one click', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, hall);
    expect(mode(view)).toBe('prep');
    await click(button(view, t('liveBar.showLive')));
    expect(heading(view)).toBe('Cave');
    expect(mode(view)).toBe('live');
    // Shown only when the canvas is not on the live scene already.
    expect(view.textContent).not.toContain(t('liveBar.showLive'));
  });
});

describe('the token controls in live mode send the live commands (04 §2, D-109, G-024)', () => {
  it('places, moves, hides, reveals and deletes through commands, with no REST token write', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    // Place: the add flow, then Enter at the centre of the view.
    await click(button(view, t('tokens.add')));
    await click(button(picker(), t('tokens.picker.chooseOf', { name: 'Goblin' })));
    press(viewport(view), 'Enter');
    await settle();
    const add = commands().at(-1)!;
    expect(add).toMatchObject({ type: 'token.add', payload: { scene_id: cave.id, asset_id: goblin.id } });
    const placed = server.sceneTokens.at(-1)!;
    expect(tokenSelect(view).value).toBe(placed.id);
    expect(drawn()).toContain(placed.label);
    expect(view.querySelector('[role="status"].eg-scene__progress')?.textContent).toBe(
      t('tokens.placed', { label: placed.label }),
    );
    // Move: an arrow key moves the selected token a square.
    const { x, y } = placed;
    press(viewport(view), 'ArrowRight');
    await settle();
    expect(commands().at(-1)).toEqual({ type: 'token.move', payload: { token_id: placed.id, x: x + 1, y } });
    expect(server.sceneTokens.at(-1)).toMatchObject({ x: x + 1, y });
    // Hide and reveal.
    await click(button(bar(view), t('tokens.hide')));
    expect(commands().at(-1)).toEqual({ type: 'token.setVisibility', payload: { token_id: placed.id, hidden: true } });
    expect(server.sceneTokens.at(-1)!.hidden).toBe(true);
    await click(button(bar(view), t('tokens.reveal')));
    expect(commands().at(-1)).toEqual({ type: 'token.setVisibility', payload: { token_id: placed.id, hidden: false } });
    // Delete, after the confirmation.
    await click(button(bar(view), t('tokens.delete')));
    await click(button(picker(), t('tokens.deleteDialog.confirm')));
    expect(commands().at(-1)).toEqual({ type: 'token.delete', payload: { token_id: placed.id } });
    expect(server.sceneTokens.some((each) => each.id === placed.id)).toBe(false);
    expect(drawn()).not.toContain(placed.label);
    // Nothing went over REST: live tokens change only by the live commands.
    expect(tokenWrites()).toEqual([]);
    expect(server.calls.some((call) => call.path.endsWith('/tokens'))).toBe(false);
  });

  it('offers no rename or stacking order in live mode, and both again in prep mode (04 §2)', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    await selectToken(view, caveGoblin.id);
    expect(bar(view).textContent).toContain(t('tokens.hide'));
    for (const key of ['tokens.rename', 'tokens.front', 'tokens.back'] as const) {
      expect(bar(view).textContent).not.toContain(t(key));
    }
    await click(button(view, t('liveBar.blank')));
    await settle();
    await selectToken(view, caveGoblin.id);
    for (const key of ['tokens.rename', 'tokens.front', 'tokens.back'] as const) {
      expect(bar(view).textContent).toContain(t(key));
    }
  });

  it('shows a refused move where it was and says why', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    await selectToken(view, caveGoblin.id);
    server.beforeCommand = (command) =>
      command.type === 'token.move' ? { error: { code: 'scene_not_live', message: 'test' } } : undefined;
    press(viewport(view), 'ArrowDown');
    await settle();
    expect(view.textContent).toContain(t('scene.liveFailed', { reason: t('error.code.scene_not_live') }));
    const tokens = JSON.parse(viewport(view).dataset.tokens ?? '[]') as { id: string; x: number; y: number }[];
    expect(tokens.find((each) => each.id === caveGoblin.id)).toMatchObject({ x: 2, y: 2 });
  });
});

describe('following another DM browser (G-018)', () => {
  it('the live bar follows a scene made live, and blanked, elsewhere', async () => {
    const view = await open();
    expect(liveBar(view)).toBe(t('liveBar.none'));
    // Another browser's scene.activate reaches every DM socket as a snapshot.
    server.liveSceneId = hall.id;
    act(() => {
      server.deliver('scene.snapshot', server.dmSnapshot());
    });
    expect(liveBar(view)).toBe(t('liveBar.live', { name: 'Hall' }));
    server.liveSceneId = null;
    act(() => {
      server.deliver('scene.cleared', {});
    });
    expect(liveBar(view)).toBe(t('liveBar.none'));
  });

  it('the live canvas follows another browser’s token events, and turns to prep mode when the scene is replaced', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    const hero = server.addAsset({ name: 'Hero', category: 'pc', default_hidden: false });
    const added = server.addToken(cave.id, hero, { x: 6, y: 1 });
    act(() => {
      server.deliver('token.added', { token: added, relabelled: [] });
    });
    expect(drawn()).toContain('Hero');
    act(() => {
      server.deliver('token.updated', { token: { ...caveLurker, hidden: false, label: 'Lurker' }, relabelled: [] });
    });
    act(() => {
      server.deliver('token.removed', { id: caveGoblin.id });
    });
    expect(drawn().sort()).toEqual(['Hero', 'Lurker']);
    expect(stage().findOne('.token-hidden-marker')).toBeUndefined();
    // Another browser made the hall live: the cave is back in prep mode here.
    server.liveSceneId = hall.id;
    act(() => {
      server.deliver('scene.snapshot', server.dmSnapshot());
    });
    await settle();
    expect(mode(view)).toBe('prep');
    expect(liveBar(view)).toBe(t('liveBar.live', { name: 'Hall' }));
  });

  it('a setup change saved in live mode reaches the canvas through the snapshot it causes (04 §10)', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    const box = panel(view).querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.checked).toBe(true);
    act(() => box.click());
    await settle();
    expect(server.writes()).toContain(`PATCH /api/scenes/${cave.id}`);
    // Live mode draws the live scene's record, which only the snapshot the change caused updates.
    expect(box.checked).toBe(false);
    expect(mode(view)).toBe('live');
  });
});

// The LIV-04 review's fixes (D-116).

/** Holds every command until `release` lets the oldest one through (applied, or refused with `answer`). */
function holdCommands() {
  const held: ((answer?: CommandAck) => void)[] = [];
  server.beforeCommand = () => new Promise<CommandAck | undefined>((resolve) => held.push(resolve));
  return {
    get count() {
      return held.length;
    },
    async release(answer?: CommandAck) {
      await act(async () => {
        held.shift()!(answer);
        await Promise.resolve();
      });
      await settle();
    },
  };
}

const drawnToken = (view: HTMLElement, id: string) =>
  (JSON.parse(viewport(view).dataset.tokens ?? '[]') as { id: string; x: number; hidden: boolean }[]).find(
    (each) => each.id === id,
  );

describe('a live change shows at once and keeps the latest (review M5)', () => {
  it('draws a move before the server answers, and an earlier answer does not take back a later move', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    await selectToken(view, caveGoblin.id);
    const held = holdCommands();
    press(viewport(view), 'ArrowRight');
    await settle();
    expect(drawnToken(view, caveGoblin.id)?.x).toBe(3);
    press(viewport(view), 'ArrowRight');
    await settle();
    expect(held.count).toBe(2);
    expect(drawnToken(view, caveGoblin.id)?.x).toBe(4);
    // The first move is applied and answered: the second is still on its way and stays drawn.
    await held.release();
    expect(drawnToken(view, caveGoblin.id)?.x).toBe(4);
    await held.release();
    expect(drawnToken(view, caveGoblin.id)?.x).toBe(4);
    expect(server.sceneTokens.find((each) => each.id === caveGoblin.id)?.x).toBe(4);
  });

  it('draws a hide at once, and puts the token back when the server refuses it', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    await selectToken(view, caveGoblin.id);
    const held = holdCommands();
    await click(button(bar(view), t('tokens.hide')));
    expect(drawnToken(view, caveGoblin.id)?.hidden).toBe(true);
    await held.release({ error: { code: 'scene_not_live', message: 'test' } });
    expect(drawnToken(view, caveGoblin.id)?.hidden).toBe(false);
    expect(view.textContent).toContain(t('scene.liveFailed', { reason: t('error.code.scene_not_live') }));
  });
});

describe('focus after the live bar’s actions (08 §8, review M2)', () => {
  it('goes to Blank TV after Go live, to the scene after Show live scene, and to Go live after Blank TV', async () => {
    const view = await open();
    await selectScene(view, cave);
    await goLive(view);
    expect(document.activeElement).toBe(button(view, t('liveBar.blank')));
    await selectScene(view, hall);
    await click(button(view, t('liveBar.showLive')));
    expect(heading(view)).toBe('Cave');
    expect(document.activeElement?.id).toBe('main');
    await click(button(view, t('liveBar.blank')));
    await settle();
    expect(document.activeElement).toBe(goLiveButton(view));
  });

  it('goes to Connect a screen after Blank TV when no scene is selected', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await click(button(view, t('liveBar.blank')));
    await settle();
    expect(document.activeElement).toBe(button(view, t('connect.open')));
  });
});

describe('while the connection is down (review M3, M4)', () => {
  it('names live mode in the head, and says when it is not connected', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, hall);
    expect(panel(view).querySelector('.eg-scene__mode')).toBeNull();
    await click(button(view, t('liveBar.showLive')));
    expect(panel(view).querySelector('.eg-scene__mode')?.textContent).toBe(t('scene.live'));
    expect(indicator(view)?.classList.contains('eg-scene__canvas--offline')).toBe(false);
    act(() => server.sockets[0]!.drop());
    await settle();
    expect(panel(view).querySelector('.eg-scene__mode')?.textContent).toBe(t('scene.liveOffline'));
    expect(indicator(view)?.classList.contains('eg-scene__canvas--offline')).toBe(true);
    expect(viewport(view).getAttribute('aria-label')).toBe(t('canvas.labelOffline', { name: 'Cave' }));
  });

  it('keeps Go live and Blank TV in place but refusing, sends nothing, and clears a stale refusal once back', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, hall);
    server.beforeCommand = () => ({ error: { code: 'internal_error', message: 'test' } });
    await click(button(view, t('liveBar.blank')));
    await settle();
    expect(view.textContent).toContain(t('liveBar.blankFailed', { reason: t('error.code.internal_error') }));
    server.beforeCommand = undefined;
    const sent = commands().length;
    act(() => server.sockets[0]!.drop());
    await settle();
    for (const control of [goLiveButton(view)!, button(view, t('liveBar.blank'))!]) {
      expect(control.getAttribute('aria-disabled')).toBe('true');
      await click(control);
    }
    expect(commands()).toHaveLength(sent);
    // Refused in place: no second notice contradicting the bar, which says it is reconnecting.
    expect(view.querySelector('.eg-workspace > [role="alert"]')?.textContent).toBe(
      t('liveBar.blankFailed', { reason: t('error.code.internal_error') }),
    );
    await server.openSockets();
    await settle();
    expect(view.textContent).not.toContain(t('liveBar.blankFailed', { reason: t('error.code.internal_error') }));
    expect(goLiveButton(view)!.getAttribute('aria-disabled')).toBeNull();
  });
});

describe('a DM view demoted to players (G-027, review M1)', () => {
  it('applies none of the players room’s events to the DM’s live scene while it asks the server', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    // The auth check is held open: the window in which players' events arrive.
    server.before = (call) => (call.path === '/api/auth' ? new Promise<undefined>(() => {}) : undefined);
    const socket = server.sockets[0]!;
    act(() => socket.drop('io server disconnect'));
    act(() => socket.open({ role: 'players', scene: null }, 7));
    const moved = {
      id: caveGoblin.id,
      x: 9,
      y: 9,
      size: 'medium',
      image_id: goblin.image_id,
      z_order: 0,
      label: 'Goblin',
    };
    act(() => socket.deliver({ type: 'token.updated', version: 8, payload: { token: moved } }));
    await settle();
    expect(view.querySelector('.eg-scene')).not.toBeNull();
    expect(drawnToken(view, caveGoblin.id)).toMatchObject({ x: 2 });
    expect(drawn().sort()).toEqual(['Goblin', 'Lurker']);
  });
});

describe('Ctrl+Z in live mode undoes the last change on the live scene (04 §8, 08 §3, LIV-05)', () => {
  function undoKey(target: EventTarget, init: KeyboardEventInit = {}) {
    act(() => {
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          code: 'KeyZ',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      );
    });
  }
  const tokenAt = (view: HTMLElement, id: string) =>
    (JSON.parse(viewport(view).dataset.tokens ?? '[]') as { id: string; x: number; y: number }[]).find(
      (each) => each.id === id,
    );
  const status = (view: HTMLElement) => view.querySelector('[role="status"].eg-scene__progress')?.textContent;
  const undos = () => commands().filter((command) => command.type === 'undo');

  it('sends undo, and the canvas follows the events it brings; with nothing left it says so', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    await selectToken(view, caveGoblin.id);
    press(viewport(view), 'ArrowRight');
    await settle();
    expect(tokenAt(view, caveGoblin.id)).toMatchObject({ x: 3, y: 2 });

    undoKey(viewport(view));
    await settle();
    expect(commands().at(-1)).toEqual({ type: 'undo', payload: {} });
    expect(tokenAt(view, caveGoblin.id)).toMatchObject({ x: 2, y: 2 });
    expect(server.sceneTokens.find((each) => each.id === caveGoblin.id)).toMatchObject({ x: 2, y: 2 });
    expect(status(view)).toBe(t('scene.undoneMoved', { label: 'Goblin', column: '3', row: '3' }));

    undoKey(viewport(view));
    await settle();
    expect(undos()).toHaveLength(2);
    expect(status(view)).toBe(t('scene.nothingToUndo'));
    expect(tokenWrites()).toEqual([]);
  });

  it('undoes a delete and a hide from anywhere in the DM view, by Cmd+Z too, and on a Greek keyboard', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    await selectToken(view, caveGoblin.id);
    await click(button(bar(view), t('tokens.hide')));
    await click(button(bar(view), t('tokens.delete')));
    await click(button(picker(), t('tokens.deleteDialog.confirm')));
    expect(drawn()).not.toContain('Goblin');

    // Focus on the token bar's Add button, not the canvas; Cmd+Z as on a Mac.
    undoKey(button(bar(view), t('tokens.add'))!, { ctrlKey: false, metaKey: true });
    await settle();
    expect(drawn()).toContain('Goblin');
    expect(server.sceneTokens.find((each) => each.id === caveGoblin.id)).toMatchObject({ hidden: true });

    // A Greek layout reports ζ for the Z key.
    undoKey(document.body, { key: 'ζ' });
    await settle();
    expect(server.sceneTokens.find((each) => each.id === caveGoblin.id)).toMatchObject({ hidden: false });
    expect(undos()).toHaveLength(2);
  });

  it('sends nothing in prep mode', async () => {
    const view = await open();
    await selectScene(view, cave);
    expect(mode(view)).toBe('prep');
    await selectToken(view, caveGoblin.id);
    undoKey(viewport(view));
    undoKey(document.body);
    await settle();
    expect(commands()).toEqual([]);
  });

  it('leaves a text field its own undo, and sends nothing with Shift or Alt, or while a dialog is open', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    const field = document.createElement('input');
    field.type = 'text';
    view.appendChild(field);
    undoKey(field);
    undoKey(viewport(view), { shiftKey: true });
    undoKey(viewport(view), { altKey: true });
    undoKey(viewport(view), { key: 'y' });
    await selectToken(view, caveGoblin.id);
    await click(button(bar(view), t('tokens.delete')));
    undoKey(picker());
    await settle();
    expect(undos()).toEqual([]);
  });

  it('says why an undo was refused: a change that no longer applies was skipped, anything else with its reason', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    for (const code of ['not_found', 'reference_not_found', 'scene_not_live'] as const) {
      server.beforeCommand = (command) => (command.type === 'undo' ? { error: { code, message: 'test' } } : undefined);
      undoKey(viewport(view));
      await settle();
      expect(view.querySelector('[role="alert"]')?.textContent, code).toBe(t('scene.undoStale'));
    }
    server.beforeCommand = (command) =>
      command.type === 'undo' ? { error: { code: 'internal_error', message: 'test' } } : undefined;
    undoKey(viewport(view));
    await settle();
    expect(view.querySelector('[role="alert"]')?.textContent).toBe(
      t('scene.undoFailed', { reason: t('error.code.internal_error') }),
    );
  });

  it('names what each undo changed: a token removed, back, back hidden, hidden again or shown again (review U2)', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    const undone = async () => {
      undoKey(viewport(view));
      await settle();
      return status(view);
    };
    await selectToken(view, caveGoblin.id);
    await click(button(bar(view), t('tokens.hide')));
    await selectToken(view, caveLurker.id);
    await click(button(bar(view), t('tokens.delete')));
    await click(button(picker(), t('tokens.deleteDialog.confirm')));
    await click(button(view, t('tokens.add')));
    await click(button(picker(), t('tokens.picker.chooseOf', { name: 'Goblin' })));
    press(viewport(view), 'Enter');
    await settle();
    const placed = server.sceneTokens.at(-1)!;
    expect(await undone()).toBe(t('scene.undoneRemoved', { label: placed.label }));
    expect(await undone()).toBe(t('scene.undoneRestoredHidden', { label: 'Lurker' }));
    expect(await undone()).toBe(t('scene.undoneShown', { label: 'Goblin' }));
    await selectToken(view, caveGoblin.id);
    await click(button(bar(view), t('tokens.hide')));
    await click(button(bar(view), t('tokens.reveal')));
    // An ordinary reveal numbers the bare-named goblin (Q-096); undoing it hides it under that label.
    const label = server.sceneTokens.find((each) => each.id === caveGoblin.id)!.label;
    expect(await undone()).toBe(t('scene.undoneHidden', { label }));
  });

  it('sends one undo at a time: a second Ctrl+Z before the answer, and a held key, send nothing (review U5)', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    await selectToken(view, caveGoblin.id);
    press(viewport(view), 'ArrowRight');
    await settle();
    expect(status(view)).toContain('Goblin');
    let answer: (ack: CommandAck) => void = () => {};
    server.beforeCommand = (command) =>
      command.type === 'undo' ? new Promise<undefined>((resolve) => (answer = () => resolve(undefined))) : undefined;
    undoKey(viewport(view));
    undoKey(viewport(view));
    undoKey(viewport(view), { repeat: true });
    await settle();
    expect(undos()).toHaveLength(1);
    // While it waits, the move's announcement is no longer shown as if it were the answer (review U11).
    expect(status(view)).toBe('');
    answer({ ok: true });
    await settle();
    expect(tokenAt(view, caveGoblin.id)).toMatchObject({ x: 2, y: 2 });
    server.beforeCommand = undefined;
    // A held key repeats: only its first press counts, and it sends nothing more once answered.
    undoKey(viewport(view), { repeat: true });
    await settle();
    expect(undos()).toHaveLength(1);
    undoKey(viewport(view));
    await settle();
    expect(undos()).toHaveLength(2);
    expect(status(view)).toBe(t('scene.nothingToUndo'));
  });

  it('announces a repeated answer again, as a new node of the status line (review U1)', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    const node = () => view.querySelector('[role="status"].eg-scene__progress span');
    undoKey(viewport(view));
    await settle();
    const first = node();
    expect(first?.textContent).toBe(t('scene.nothingToUndo'));
    undoKey(viewport(view));
    await settle();
    expect(node()?.textContent).toBe(t('scene.nothingToUndo'));
    expect(node()).not.toBe(first);
  });

  it('sends nothing while not connected, and says so without an alert (review U3)', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    act(() => server.sockets[0]!.drop());
    await settle();
    undoKey(viewport(view));
    await settle();
    expect(undos()).toEqual([]);
    expect(status(view)).toBe(t('scene.undoOffline'));
    expect(view.querySelector('.eg-scene [role="alert"]')).toBeNull();
    // Pressed again, the same words are a new node, read out again (review U1).
    const node = () => view.querySelector('[role="status"].eg-scene__progress span');
    const first = node();
    undoKey(viewport(view));
    await settle();
    expect(node()?.textContent).toBe(t('scene.undoOffline'));
    expect(node()).not.toBe(first);
  });

  it('sends nothing while calibrating the live scene’s grid (review U6)', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    await click(button(view, t('calibration.open')));
    undoKey(viewport(view));
    undoKey(document.body);
    await settle();
    expect(undos()).toEqual([]);
  });

  it('has nothing to undo once the live scene was deleted and another went live (review T5)', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, hall);
    await click(button(view, t('liveBar.showLive')));
    await selectToken(view, caveGoblin.id);
    press(viewport(view), 'ArrowRight');
    await settle();
    // The live scene deleted over REST from another browser: the server clears it and says so.
    act(() => {
      server.liveSceneId = null;
      server.deliver('scene.cleared', {});
    });
    await settle();
    await selectScene(view, hall);
    await goLive(view);
    undoKey(viewport(view));
    await settle();
    expect(undos()).toHaveLength(1);
    expect(status(view)).toBe(t('scene.nothingToUndo'));
  });
});

describe('the TV frame steers the player camera (LIV-06; 04 §9, 08 §2, Q-080, D-046, D-119)', () => {
  // The map's display version is 2000 × 1500 world pixels in an 800 × 600 viewport. With no screen
  // reported the TV is 16:9: the fitted frame is the whole map widened to 2666.67 × 1500, centred, and
  // the DM's own view fits the map and that frame with room around them (review U-H1).
  const WORLD = { width: 2000, height: 1500 };
  const VIEW = { width: 800, height: 600 };
  const FRAME_WIDTH = 1500 * (16 / 9);
  const status = (view: HTMLElement) => view.querySelector('[role="status"].eg-scene__progress')?.textContent;
  const frameOnScreen = (view: HTMLElement) =>
    JSON.parse(viewport(view).dataset.tvFrame ?? 'null') as {
      left: number;
      top: number;
      width: number;
      height: number;
    } | null;
  const dmCamera = (view: HTMLElement) => {
    const { cameraX, cameraY, cameraScale } = viewport(view).dataset;
    return { x: Number(cameraX), y: Number(cameraY), scale: Number(cameraScale) };
  };
  const cameras = () =>
    commands()
      .filter((each) => each.type === 'camera.setPlayer')
      .map(
        (each) =>
          (each.payload as { camera: { centre_x: number; centre_y: number; width: number; height: number } }).camera,
      );
  const frameNode = () => stage().findOne<Konva.Rect>('.tv-frame');
  const handle = (corner: string) => stage().findOne<Konva.Rect>(`.tv-frame-handle-${corner}`)!;
  const steerButton = (view: HTMLElement) => button(view, t('canvas.steerTv'));
  const pressed = (view: HTMLElement) => steerButton(view)?.getAttribute('aria-pressed');

  async function liveCave(): Promise<HTMLElement> {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    expect(mode(view)).toBe('live');
    return view;
  }

  async function drag(node: Konva.Node, to: { x: number; y: number }) {
    act(() => {
      node.fire('dragstart', { target: node, evt: new MouseEvent('mousedown') });
      node.position(to);
      node.fire('dragmove', { target: node, evt: new MouseEvent('mousemove') });
      node.fire('dragend', { target: node, evt: new MouseEvent('mouseup') });
    });
    await settle();
  }

  function key(element: HTMLElement, name: string, init: KeyboardEventInit = {}) {
    act(() => {
      element.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
    });
  }

  it('is shown in live mode only, fitted to the map in the TV’s shape, with all of it inside the canvas', async () => {
    const view = await open();
    await selectScene(view, hall);
    expect(frameOnScreen(view)).toBeNull();
    expect(frameNode()).toBeUndefined();
    expect(steerButton(view)).toBeUndefined();
    await selectScene(view, cave);
    await goLive(view);
    const frame = frameOnScreen(view)!;
    const camera = dmCamera(view);
    expect(frame.width / frame.height).toBeCloseTo(16 / 9, 6);
    expect(frame.width).toBeCloseTo(FRAME_WIDTH * camera.scale, 6);
    // Every edge and corner is on screen to grab, with room around (review U-H1).
    expect(frame.left).toBeGreaterThan(0);
    expect(frame.top).toBeGreaterThan(0);
    expect(frame.left + frame.width).toBeLessThan(VIEW.width);
    expect(frame.top + frame.height).toBeLessThan(VIEW.height);
    expect(frame.left + frame.width / 2).toBeCloseTo(VIEW.width / 2, 6);
    expect(frameNode()).toBeDefined();
    expect(pressed(view)).toBe('false');
    // Fit, by button or 0, fits the map and the frame again, as live mode opened.
    await click(button(view, t('canvas.zoomIn')));
    expect(dmCamera(view)).not.toEqual(camera);
    key(viewport(view), '0');
    await settle();
    expect(dmCamera(view)).toEqual(camera);
  });

  it('is gone in live mode while a non-live scene is shown, after Blank TV, and while calibrating the live scene', async () => {
    const view = await liveCave();
    await selectScene(view, hall);
    expect(frameOnScreen(view)).toBeNull();
    await click(button(view, t('liveBar.showLive')));
    expect(frameOnScreen(view)).not.toBeNull();
    await click(button(view, t('calibration.open')));
    expect(frameOnScreen(view)).toBeNull();
    expect(steerButton(view)).toBeUndefined();
    await click(button(view, t('calibration.cancel')));
    expect(frameOnScreen(view)).not.toBeNull();
    await click(button(view, t('liveBar.blank')));
    await settle();
    expect(frameOnScreen(view)).toBeNull();
  });

  it('dragging its edge sends camera.setPlayer for the live scene, moves the frame and leaves the DM’s own view where it was', async () => {
    const view = await liveCave();
    const before = dmCamera(view);
    await drag(frameNode()!, { x: 200, y: 100 });
    expect(commands().filter((each) => each.type === 'camera.setPlayer')).toEqual([
      {
        type: 'camera.setPlayer',
        payload: {
          scene_id: cave.id,
          camera: {
            centre_x: Number(((200 + FRAME_WIDTH / 2) / WORLD.width).toFixed(6)),
            centre_y: Number(((100 + 750) / WORLD.height).toFixed(6)),
            width: Number((FRAME_WIDTH / WORLD.width).toFixed(6)),
            height: 1,
          },
        },
      },
    ]);
    expect(dmCamera(view)).toEqual(before);
    expect(frameOnScreen(view)!.left).toBeCloseTo(before.x + 200 * before.scale, 3);
    expect(frameOnScreen(view)!.top).toBeCloseTo(before.y + 100 * before.scale, 3);
    expect(server.playerCamera).toEqual(cameras()[0]);
    expect(status(view)).toBe(t('scene.tvSteered'));
    // Dropped where it already is: nothing is sent (review C-M2).
    await drag(frameNode()!, { x: 200, y: 100 });
    expect(cameras()).toHaveLength(1);
  });

  it('holds the frame where it was put until the server answers, and then keeps it (review T-M1)', async () => {
    const view = await liveCave();
    let answer: ((ack: CommandAck | undefined) => void) | undefined;
    server.beforeCommand = (command) =>
      command.type === 'camera.setPlayer' ? new Promise((resolve) => (answer = resolve)) : undefined;
    const before = dmCamera(view);
    await drag(frameNode()!, { x: 300, y: 150 });
    expect(answer).toBeDefined();
    const held = frameOnScreen(view)!;
    expect(held.left).toBeCloseTo(before.x + 300 * before.scale, 3);
    // Another browser's camera meanwhile does not take the frame from under the DM's hand.
    act(() => server.steerElsewhere({ centre_x: 0.5, centre_y: 0.5, width: 0.5, height: 0.5 }));
    await settle();
    expect(frameOnScreen(view)).toEqual(held);
    await act(async () => {
      answer!(undefined);
      await Promise.resolve();
    });
    await settle();
    expect(frameOnScreen(view)!.left).toBeCloseTo(held.left, 3);
    expect(dmCamera(view)).toEqual(before);
  });

  it('dragging a corner zooms the TV, keeping its shape and the opposite corner', async () => {
    const view = await liveCave();
    const before = frameOnScreen(view)!;
    await drag(handle('se'), { x: 1000, y: 800 });
    const [camera] = cameras();
    // The frame keeps 16:9 in world pixels, and its top-left corner stays put.
    expect((camera!.width * WORLD.width) / (camera!.height * WORLD.height)).toBeCloseTo(16 / 9, 4);
    const after = frameOnScreen(view)!;
    expect(after.left).toBeCloseTo(before.left, 3);
    expect(after.top).toBeCloseTo(before.top, 3);
    expect(after.width).toBeLessThan(before.width);
    expect(after.width / after.height).toBeCloseTo(16 / 9, 4);
  });

  it('never shows a frame smaller than the TV can zoom to (review C-M1)', async () => {
    const view = await liveCave();
    const scale = dmCamera(view).scale;
    // A corner dragged onto the opposite one: the frame stops at 1920 ÷ 8 = 240 world pixels wide.
    await drag(handle('se'), { x: -333, y: 1 });
    expect(cameras()[0]!.width * WORLD.width).toBeCloseTo(240, 3);
    // Another browser's camera smaller than that is drawn as what the TV really shows.
    act(() => server.steerElsewhere({ centre_x: 0.5, centre_y: 0.5, width: 0.01, height: 0.01 }));
    await settle();
    expect(frameOnScreen(view)!.width).toBeCloseTo(240 * scale, 3);
  });

  it('follows another DM browser’s steering and the shape of the screen the server says it follows', async () => {
    const view = await liveCave();
    act(() =>
      server.steerElsewhere({ centre_x: 0.5, centre_y: 0.5, width: 0.5, height: 0.5 }, { width: 1024, height: 768 }),
    );
    await settle();
    // The DM's view, still fitted, fits the map and the 4:3 frame now.
    const scale = dmCamera(view).scale;
    const frame = frameOnScreen(view)!;
    // 1000 × 750 world pixels is already 4:3, the reported screen's shape.
    expect(frame.width).toBeCloseTo(1000 * scale, 3);
    expect(frame.height).toBeCloseTo(750 * scale, 3);
    expect(cameras()).toEqual([]);
  });

  it('is steered by keyboard: T or Steer the TV, then arrows, + and −, 0 and Escape, the DM’s view unchanged', async () => {
    const view = await liveCave();
    const before = dmCamera(view);
    await click(steerButton(view));
    expect(pressed(view)).toBe('true');
    expect(viewport(view).dataset.tvSteering).toBe('on');
    expect(view.querySelector('.eg-canvas__help')!.textContent).toBe(t('canvas.helpSteer'));
    key(viewport(view), 'ArrowRight');
    await settle();
    key(viewport(view), '+');
    await settle();
    key(viewport(view), '0');
    await settle();
    const sent = cameras();
    expect(sent).toHaveLength(3);
    expect(sent[0]!.centre_x).toBeGreaterThan(0.5);
    expect(sent[1]!.width).toBeLessThan(sent[0]!.width);
    expect(sent[2]).toEqual({ centre_x: 0.5, centre_y: 0.5, width: 1, height: 1 });
    expect(status(view)).toBe(t('scene.tvFitted'));
    expect(dmCamera(view)).toEqual(before);
    // 0 again changes nothing and sends nothing (review C-M2, U-M1).
    key(viewport(view), '0');
    await settle();
    expect(cameras()).toHaveLength(3);
    // The view's buttons steer the TV too while steering.
    await click(button(view, t('canvas.tvZoomIn')));
    expect(cameras()).toHaveLength(4);
    key(viewport(view), 'Escape');
    await settle();
    expect(pressed(view)).toBe('false');
    // Once steering stops, the keys move the DM's own view again and send nothing.
    key(viewport(view), 'ArrowRight');
    await settle();
    expect(cameras()).toHaveLength(4);
    expect(dmCamera(view).x).toBe(before.x - 64);
    // T on the canvas turns steering on and off (review U-M5).
    key(viewport(view), 't');
    await settle();
    expect(pressed(view)).toBe('true');
    key(viewport(view), 'T');
    await settle();
    expect(pressed(view)).toBe('false');
  });

  it('sends one command for a held key, not one per repeat (review U-M1)', async () => {
    const view = await liveCave();
    key(viewport(view), 't');
    await settle();
    key(viewport(view), 'ArrowLeft');
    for (let n = 0; n < 5; n++) key(viewport(view), 'ArrowLeft', { repeat: true });
    await settle();
    expect(cameras()).toHaveLength(1);
  });

  it('stops steering when a token is chosen, when placing starts, and when the scene leaves live mode (review U-M3, U-M4)', async () => {
    const view = await liveCave();
    key(viewport(view), 't');
    await settle();
    expect(pressed(view)).toBe('true');
    // Choosing a token gives the arrow keys back to it.
    await selectToken(view, caveGoblin.id);
    expect(pressed(view)).toBe('false');
    key(viewport(view), 'ArrowRight');
    await settle();
    expect(cameras()).toEqual([]);
    expect(commands().filter((each) => each.type === 'token.move')).toHaveLength(1);
    // Blank TV and live again: steering starts off.
    key(viewport(view), 't');
    await settle();
    expect(pressed(view)).toBe('true');
    await click(button(view, t('liveBar.blank')));
    await settle();
    await goLive(view);
    expect(pressed(view)).toBe('false');
  });

  it('while not connected, cannot be moved and says why without sending (review U-M2)', async () => {
    const view = await liveCave();
    act(() => server.sockets[0]!.drop());
    await settle();
    const before = frameOnScreen(view)!;
    expect(frameNode()!.draggable()).toBe(false);
    key(viewport(view), 't');
    await settle();
    key(viewport(view), 'ArrowRight');
    await settle();
    expect(cameras()).toEqual([]);
    expect(status(view)).toBe(t('scene.tvOffline'));
    expect(frameOnScreen(view)).toEqual(before);
    expect(view.querySelector('.eg-scene [role="alert"]')).toBeNull();
  });

  it('puts the frame back and says why when the server refuses the camera', async () => {
    const view = await liveCave();
    const before = frameOnScreen(view)!;
    server.beforeCommand = (command) =>
      command.type === 'camera.setPlayer' ? { error: { code: 'scene_not_live', message: 'test' } } : undefined;
    await drag(frameNode()!, { x: 300, y: 300 });
    expect(cameras()).toHaveLength(1);
    expect(frameOnScreen(view)).toEqual(before);
    expect(view.querySelector('.eg-scene [role="alert"]')?.textContent).toBe(
      t('scene.tvFailed', { reason: t('error.code.scene_not_live') }),
    );
  });
});

describe('the ruler (LIV-07, specs/06-grid-and-measurement.md §5, specs/04-live-sync.md §2, §11, Q-027, Q-086)', () => {
  const status = (view: HTMLElement) => view.querySelector('[role="status"].eg-scene__progress')?.textContent;
  const rulers = () => commands().filter((command) => command.type.startsWith('ruler.'));
  // The measurement drawn: its squares and distance, without where on screen it lies.
  const shown = (view: HTMLElement) => {
    const drawn = JSON.parse(viewport(view).dataset.ruler ?? 'null') as {
      from: { column: number; row: number };
      to: { column: number; row: number };
      feet: number;
    } | null;
    return drawn && { from: drawn.from, to: drawn.to, feet: drawn.feet };
  };
  const rulerButton = (view: HTMLElement) => button(view, t('canvas.ruler'))!;
  const distance = (feet: number) => t('ruler.distance', { feet: String(feet) });

  /** Turns the ruler on, starts at the centre of the view and moves the end by the given arrows. */
  async function measureByKeys(view: HTMLElement, ...keys: string[]) {
    await click(rulerButton(view));
    press(viewport(view), 'Enter');
    for (const key of keys) press(viewport(view), key);
    await settle();
  }

  it('in prep mode shows the distance in the DM view by the PHB rule and sends nothing (Q-086)', async () => {
    server.liveSceneId = hall.id;
    const view = await open();
    await selectScene(view, cave);
    expect(mode(view)).toBe('prep');
    await measureByKeys(view, 'ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowDown');
    // Two diagonals: 10 ft by the PHB rule.
    expect(shown(view)?.feet).toBe(10);
    expect(status(view)).toBe(distance(10));
    expect(rulers()).toEqual([]);
    expect(server.ruler).toBeNull();
    // Escape clears it, still without a word to the server.
    press(viewport(view), 'Escape');
    await settle();
    expect(shown(view)).toBeNull();
    expect(status(view)).toBe(t('ruler.cleared'));
    expect(rulers()).toEqual([]);
  });

  it('measures by the server-wide DMG rule when that is the setting (Q-037)', async () => {
    server.rulerRule = 'dmg';
    const view = await open();
    await selectScene(view, cave);
    await measureByKeys(view, 'ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowDown');
    expect(shown(view)?.feet).toBe(15);
    expect(status(view)).toBe(distance(15));
  });

  it('measures by a rule another browser saved while this view was open, read again when the ruler is turned on (G-036)', async () => {
    const view = await open();
    await selectScene(view, cave);
    // Saved from another DM browser: this view learns it when measuring starts.
    server.rulerRule = 'dmg';
    const reads = server.calls.filter((call) => call.path === '/api/settings').length;
    await measureByKeys(view, 'ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowDown');
    expect(server.calls.filter((call) => call.path === '/api/settings')).toHaveLength(reads + 1);
    expect(shown(view)?.feet).toBe(15);
    expect(status(view)).toBe(distance(15));
  });

  it('counts the measurement shown again by a rule saved in this view’s Settings, without a reload', async () => {
    const view = await open();
    await selectScene(view, cave);
    await measureByKeys(view, 'ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowDown');
    expect(shown(view)?.feet).toBe(10);
    await click(button(view, t('settings.open')));
    const dialog = view.querySelector('dialog')!;
    await click(dialog.querySelector<HTMLInputElement>('input[value="dmg"]'));
    await submit(dialog.querySelector('form'));
    expect(server.rulerRule).toBe('dmg');
    await click(button(dialog, t('settings.close')));
    expect(shown(view)?.feet).toBe(15);
  });

  it('in live mode sends ruler.update for each measurement and ruler.clear to end it; the canvas shows what the TV shows', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    expect(mode(view)).toBe('live');
    expect(document.getElementById(viewport(view).getAttribute('aria-describedby')!)!.textContent).toBe(
      t('canvas.helpLive'),
    );
    await click(rulerButton(view));
    expect(document.getElementById(viewport(view).getAttribute('aria-describedby')!)!.textContent).toBe(
      t('canvas.helpRulerLive'),
    );
    press(viewport(view), 'Enter');
    await settle();
    const start = (rulers()[0]!.payload as { from: { column: number; row: number } }).from;
    press(viewport(view), 'ArrowRight');
    await settle();
    press(viewport(view), 'ArrowRight');
    await settle();
    const end = { column: start.column + 2, row: start.row };
    expect(rulers()).toEqual([
      { type: 'ruler.update', payload: { scene_id: cave.id, from: start, to: start } },
      { type: 'ruler.update', payload: { scene_id: cave.id, from: start, to: { ...end, column: end.column - 1 } } },
      { type: 'ruler.update', payload: { scene_id: cave.id, from: start, to: end } },
    ]);
    expect(server.ruler).toEqual({ from: start, to: end });
    expect(shown(view)).toEqual({ from: start, to: end, feet: 10 });
    expect(status(view)).toBe(distance(10));
    press(viewport(view), 'Escape');
    await settle();
    expect(rulers().at(-1)).toEqual({ type: 'ruler.clear', payload: { scene_id: cave.id } });
    expect(server.ruler).toBeNull();
    expect(shown(view)).toBeNull();
    // Turning the ruler off with a measurement shown takes it off the TV too.
    press(viewport(view), 'Enter');
    await settle();
    await click(rulerButton(view));
    expect(rulers().at(-1)).toEqual({ type: 'ruler.clear', payload: { scene_id: cave.id } });
    expect(server.ruler).toBeNull();
    expect(rulerButton(view).getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps one ruler command in flight, sending the latest measurement once it is answered', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    const answers: ((ack: CommandAck | undefined) => void)[] = [];
    server.beforeCommand = (command) =>
      command.type.startsWith('ruler.') ? new Promise((resolve) => answers.push(resolve)) : undefined;
    await measureByKeys(view, 'ArrowRight', 'ArrowRight', 'ArrowRight');
    expect(rulers()).toHaveLength(1);
    const { from } = rulers()[0]!.payload as { from: { column: number; row: number } };
    // Drawn at once where the DM put it, before any answer.
    expect(shown(view)).toMatchObject({ from, to: { column: from.column + 3, row: from.row }, feet: 15 });
    await act(async () => {
      answers[0]!(undefined);
      await Promise.resolve();
    });
    await settle();
    expect(rulers()).toHaveLength(2);
    expect(rulers()[1]!.payload).toEqual({ scene_id: cave.id, from, to: { column: from.column + 3, row: from.row } });
    await act(async () => {
      answers[1]!(undefined);
      await Promise.resolve();
    });
    await settle();
    expect(rulers()).toHaveLength(2);
    expect(shown(view)).toEqual({ from, to: { column: from.column + 3, row: from.row }, feet: 15 });
  });

  it("shows another DM browser's measurement and follows its clear", async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    const path = { from: { column: 1, row: 1 }, to: { column: 4, row: 5 } };
    act(() => server.measureElsewhere(path));
    await settle();
    expect(shown(view)).toEqual({ ...path, feet: 20 });
    act(() => server.measureElsewhere(null));
    await settle();
    expect(shown(view)).toBeNull();
  });

  it('says why when the server refuses a measurement, and draws what the TV shows', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    server.beforeCommand = (command) =>
      command.type === 'ruler.update' ? { error: { code: 'scene_not_live', message: 'test' } } : undefined;
    await measureByKeys(view);
    expect(view.querySelector('.eg-scene [role="alert"]')?.textContent).toContain(
      t('scene.rulerFailed', { reason: '' }).trim(),
    );
    expect(shown(view)).toBeNull();
  });

  it('sends nothing while not connected, and says so', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    act(() => server.sockets[0]!.drop());
    await settle();
    await measureByKeys(view, 'ArrowRight');
    expect(rulers()).toEqual([]);
    expect(shown(view)).toBeNull();
    expect(status(view)).toBe(t('scene.rulerOffline'));
  });

  it('turns off when steering the TV, choosing a token or calibrating starts, and turning it on ends steering', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    await click(rulerButton(view));
    expect(viewport(view).dataset.rulerTool).toBe('on');
    await click(button(view, t('canvas.steerTv')));
    expect(viewport(view).dataset.rulerTool).toBe('off');
    expect(viewport(view).dataset.tvSteering).toBe('on');
    await click(rulerButton(view));
    expect(viewport(view).dataset.tvSteering).toBe('off');
    // Choosing a token ends measuring and takes the measurement off the TV (review C-M1).
    press(viewport(view), 'Enter');
    await settle();
    expect(server.ruler).not.toBeNull();
    await selectToken(view, caveGoblin.id);
    expect(viewport(view).dataset.rulerTool).toBe('off');
    expect(server.ruler).toBeNull();
    expect(rulers().at(-1)?.type).toBe('ruler.clear');
    expect(shown(view)).toBeNull();
    await click(rulerButton(view));
    press(viewport(view), 'Enter');
    await settle();
    await click(button(view, t('calibration.open')));
    expect(server.ruler).toBeNull();
    expect(rulers().at(-1)?.type).toBe('ruler.clear');
  });

  it('leaving the live scene takes its measurement off the TV, unless another browser measured over it (review T-M1, C-L2)', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    await measureByKeys(view, 'ArrowRight');
    expect(server.ruler).not.toBeNull();
    await selectScene(view, hall);
    await settle();
    expect(rulers().at(-1)).toEqual({ type: 'ruler.clear', payload: { scene_id: cave.id } });
    expect(server.ruler).toBeNull();

    await selectScene(view, cave);
    await measureByKeys(view, 'ArrowRight');
    const theirs = { from: { column: 0, row: 0 }, to: { column: 1, row: 1 } };
    act(() => server.measureElsewhere(theirs));
    await settle();
    const sent = rulers().length;
    await selectScene(view, hall);
    await settle();
    expect(rulers()).toHaveLength(sent);
    expect(server.ruler).toEqual(theirs);
  });

  it('drops the measurement waiting behind one refused, and announces a distance only once shown (review T-M3, U-L2)', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    let answer: ((ack: CommandAck | undefined) => void) | undefined;
    server.beforeCommand = (command) =>
      command.type === 'ruler.update' && !answer ? new Promise((resolve) => (answer = resolve)) : undefined;
    await click(rulerButton(view));
    press(viewport(view), 'Enter');
    press(viewport(view), 'ArrowRight');
    await settle();
    expect(rulers()).toHaveLength(1);
    // Not yet shown on the TV, so not yet announced.
    expect(status(view)).not.toBe(distance(5));
    await act(async () => {
      answer!({ error: { code: 'scene_not_live', message: 'test' } });
      await Promise.resolve();
    });
    await settle();
    expect(rulers()).toHaveLength(1);
    expect(shown(view)).toBeNull();
    // Refused: the alert says why, and no distance is announced.
    expect(status(view) ?? '').not.toMatch(/^Distance/);
    expect(view.querySelector('.eg-scene [role="alert"]')).not.toBeNull();
    // Accepted: a new measurement from the centre, announced once the answer is in.
    press(viewport(view), 'ArrowRight');
    await settle();
    expect(rulers()).toHaveLength(2);
    expect(status(view)).toBe(distance(5));
  });

  it('sends nothing more, and shows no refusal, once another browser has blanked the TV (review C-L1)', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    let answer: ((ack: CommandAck | undefined) => void) | undefined;
    server.beforeCommand = (command) =>
      command.type === 'ruler.update' && !answer ? new Promise((resolve) => (answer = resolve)) : undefined;
    await measureByKeys(view, 'ArrowRight', 'ArrowRight');
    expect(rulers()).toHaveLength(1);
    // Another browser's Blank TV: the scene is no longer live when the first answer comes.
    act(() => {
      server.liveSceneId = null;
      server.ruler = null;
      server.deliver('scene.cleared', {});
    });
    await settle();
    expect(mode(view)).toBe('prep');
    await act(async () => {
      answer!({ error: { code: 'scene_not_live', message: 'test' } });
      await Promise.resolve();
    });
    await settle();
    expect(rulers()).toHaveLength(1);
    expect(view.querySelector('.eg-scene [role="alert"]')).toBeNull();
  });

  it('with the ruler off, Escape on the map takes a shown measurement off; with nothing shown it sends nothing (review U-L4, T-L2)', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    await click(rulerButton(view));
    press(viewport(view), 'Escape');
    await settle();
    expect(rulers()).toEqual([]);
    expect(viewport(view).dataset.rulerTool).toBe('off');
    act(() => server.measureElsewhere({ from: { column: 0, row: 0 }, to: { column: 2, row: 0 } }));
    await settle();
    press(viewport(view), 'Escape');
    await settle();
    expect(rulers()).toEqual([{ type: 'ruler.clear', payload: { scene_id: cave.id } }]);
    expect(server.ruler).toBeNull();
    expect(status(view)).toBe(t('ruler.cleared'));
  });

  it('the DM socket going takes its measurement off, and the canvas follows the snapshot on reconnection (review T-M6)', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    await measureByKeys(view, 'ArrowRight');
    expect(server.ruler).not.toBeNull();
    act(() => server.sockets[0]!.drop());
    await settle();
    expect(server.ruler).toBeNull();
    act(() => server.sockets[0]!.open(server.dmSnapshot(), 99));
    await settle();
    expect(shown(view)).toBeNull();
  });

  it('going live or back to prep drops a measurement made in the other mode', async () => {
    const view = await open();
    await selectScene(view, cave);
    await measureByKeys(view, 'ArrowRight');
    expect(shown(view)).not.toBeNull();
    await goLive(view);
    expect(mode(view)).toBe('live');
    // Nothing measured in preparation reaches the TV, nor stays drawn as if it did (Q-086).
    expect(shown(view)).toBeNull();
    expect(rulers()).toEqual([]);
    expect(viewport(view).dataset.rulerTool).toBe('off');
  });

  it('sets feet per square in prep mode, refusing a value out of bounds before sending, and recounts the distance', async () => {
    const view = await open();
    await selectScene(view, cave);
    await measureByKeys(view, 'ArrowRight', 'ArrowRight', 'ArrowRight');
    expect(shown(view)?.feet).toBe(15);
    const field = [...view.querySelectorAll('input')].find(
      (each) => each.labels?.[0]?.textContent === t('sceneGrid.feet'),
    )!;
    const typeInto = (value: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const patches = () => server.calls.filter((call) => call.method === 'PATCH');
    // Enter in the field saves it (the form's submission); a value out of bounds is refused first.
    for (const wrong of ['0', '', '100001', 'abc']) {
      typeInto(wrong);
      await submit(field.form);
      expect(field.getAttribute('aria-invalid'), wrong).toBe('true');
      expect(view.textContent).toContain(t('sceneGrid.feetInvalid', { min: '0.5', max: '100,000' }));
    }
    expect(patches()).toEqual([]);
    typeInto('2.5');
    expect(field.getAttribute('aria-invalid')).toBeNull();
    await submit(field.form);
    await settle();
    expect(patches().map((call) => call.body)).toEqual([{ grid: { feet_per_square: 2.5 } }]);
    expect(server.scenes.find((each) => each.id === cave.id)!.grid.feet_per_square).toBe(2.5);
    expect(shown(view)?.feet).toBe(7.5);
    // Nothing of it reached the TV: the scene is not live.
    expect(rulers()).toEqual([]);
    // Leaving the field unchanged saves nothing more.
    act(() => {
      field.dispatchEvent(new FocusEvent('blur'));
    });
    await settle();
    expect(patches()).toHaveLength(1);
  });

  describe('saving feet per square (review U-L1, C-L4)', () => {
    const feetField = (view: HTMLElement) =>
      [...view.querySelectorAll('input')].find((each) => each.labels?.[0]?.textContent === t('sceneGrid.feet'))!;
    const typeInto = (field: HTMLInputElement, value: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const patches = () => server.calls.filter((call) => call.method === 'PATCH');

    it('puts a value out of bounds back when focus leaves the field, and says so in the status line', async () => {
      const view = await open();
      await selectScene(view, cave);
      const field = feetField(view);
      typeInto(field, '0');
      act(() => {
        field.focus();
        field.blur();
      });
      await settle();
      expect(field.value).toBe('5');
      expect(field.getAttribute('aria-invalid')).toBeNull();
      expect(status(view)).toBe(t('sceneGrid.feetRestored', { min: '0.5', max: '100,000', feet: '5' }));
      expect(patches()).toEqual([]);
    });

    it('sends one save for Enter then leaving the field', async () => {
      const view = await open();
      await selectScene(view, cave);
      const field = feetField(view);
      typeInto(field, '10');
      act(() => {
        field.focus();
        field.form!.requestSubmit();
        field.blur();
      });
      await settle();
      expect(patches().map((call) => call.body)).toEqual([{ grid: { feet_per_square: 10 } }]);
    });

    it('keeps what is typed while a save runs, and leaves Calibrate usable meanwhile', async () => {
      const view = await open();
      await selectScene(view, cave);
      const field = feetField(view);
      let release: (() => void) | undefined;
      server.before = (call) =>
        call.method === 'PATCH' && !release
          ? new Promise<undefined>((resolve) => (release = () => resolve(undefined)))
          : undefined;
      typeInto(field, '10');
      await submit(field.form);
      expect(release).toBeDefined();
      typeInto(field, '20');
      await click(button(view, t('calibration.open')));
      expect(view.querySelector('.eg-calibration')).not.toBeNull();
      await act(async () => {
        release!();
        await Promise.resolve();
      });
      await settle();
      expect(server.scenes.find((each) => each.id === cave.id)!.grid.feet_per_square).toBe(10);
    });

    it('keeps the value typed during a save in the field once the save lands', async () => {
      const view = await open();
      await selectScene(view, cave);
      const field = feetField(view);
      let release: (() => void) | undefined;
      server.before = (call) =>
        call.method === 'PATCH' && !release
          ? new Promise<undefined>((resolve) => (release = () => resolve(undefined)))
          : undefined;
      typeInto(field, '10');
      await submit(field.form);
      typeInto(field, '20');
      await act(async () => {
        release!();
        await Promise.resolve();
      });
      await settle();
      expect(field.value).toBe('20');
      await submit(field.form);
      expect(server.scenes.find((each) => each.id === cave.id)!.grid.feet_per_square).toBe(20);
    });
  });

  it('follows the feet per square set in the scene’s setup, which the snapshot recounts on the live scene', async () => {
    server.liveSceneId = cave.id;
    const view = await open();
    await selectScene(view, cave);
    await measureByKeys(view, 'ArrowRight', 'ArrowRight');
    expect(shown(view)?.feet).toBe(10);
    const field = [...view.querySelectorAll('input')].find(
      (each) => each.labels?.[0]?.textContent === t('sceneGrid.feet'),
    )!;
    expect(field.value).toBe('5');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '10');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Leaving the field saves it.
    act(() => {
      field.focus();
      field.blur();
    });
    await settle();
    expect(server.calls.filter((call) => call.method === 'PATCH').at(-1)?.body).toEqual({
      grid: { feet_per_square: 10 },
    });
    expect(shown(view)?.feet).toBe(20);
    expect(field.value).toBe('10');
    expect(status(view)).toBe(t('sceneGrid.feetSaved', { feet: '10' }));
  });
});
