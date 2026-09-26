// @vitest-environment jsdom
import { act, createElement } from 'react';
import Konva from 'konva';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LibraryAsset, Scene, SceneToken } from '@emberglass/shared';
import { t } from '../ui/messages.js';
import { installCanvas2d, installImageLoading, installResizeObserver } from '../ui/testing/canvas2d.js';
import { button, click, FakeServer, installDialog, settle } from '../ui/testing/fakeServer.js';
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
