// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LibraryAsset, Scene } from '@emberglass/shared';
import { t } from '../ui/messages.js';
import { installCanvas2d, installImageLoading, installResizeObserver } from '../ui/testing/canvas2d.js';
import {
  button,
  click,
  FakeServer,
  installDialog,
  listedTokens,
  liveText,
  openSwitcher,
  popover,
  selectScene,
  selectTokenRow,
  settle,
} from '../ui/testing/fakeServer.js';
import { render, type Rendered } from '../ui/testing/render.js';
import { isRedoKey } from './ScenePanel.js';
import { nextScene } from './scenes/SceneList.js';
import { Workspace } from './Workspace.js';

// The redesigned workspace (UIX-01, specs/08-ux-journeys.md §1, §2, §11, specs/04-live-sync.md §8, Q-100):
// the header's switcher and screens counter, the scene list with its counts, its actions and NEXT UP,
// the "In this scene" panel, the shortcuts and redo, against a scripted server.

let server: FakeServer;
let rendered: Rendered | undefined;
let cellar: Scene;
let road: Scene;
let tavern: Scene;
let bandit: LibraryAsset;
let hero: LibraryAsset;

beforeEach(() => {
  installCanvas2d();
  installResizeObserver({ width: 800, height: 600 });
  installImageLoading();
  installDialog();
  server = new FakeServer().install();
  const session = server.addSession(server.addCampaign('Campaine Test').id, 'Session 1');
  tavern = server.addScene(session.id, 'Tavern');
  cellar = server.addScene(session.id, 'Cellar');
  road = server.addScene(session.id, 'Road');
  bandit = server.addAsset({ name: 'Bandit', category: 'monster' });
  hero = server.addAsset({ name: 'Hero', category: 'pc', default_hidden: false });
  server.addToken(tavern.id, hero, { x: 1, y: 1 });
  server.addToken(tavern.id, bandit, { x: 3, y: 1 });
  for (let n = 0; n < 5; n++) server.addToken(cellar.id, bandit, { x: n, y: 2 });
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
  await settle();
  return rendered.container;
}

async function openSession(view: HTMLElement) {
  await openSwitcher(view);
  await click(button(view, 'Campaine Test'));
  await click(button(view, t('tree.openOf', { name: 'Session 1' })));
}

const row = (view: HTMLElement, scene: Scene) => view.querySelector<HTMLElement>(`[data-scene="${scene.id}"]`)!;
const commands = () => server.sockets.flatMap((socket) => socket.commands());
const press = (target: EventTarget, key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
const menuItem = (view: HTMLElement, text: string) =>
  [...view.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (item) => item.querySelector('span')?.textContent === text,
  );

describe('the header (specs/08-ux-journeys.md §11)', () => {
  it('names the campaign and the session in the breadcrumb, whose switcher opens and closes on Escape', async () => {
    const view = await open();
    expect(view.querySelector('.eg-header__crumbs')!.textContent).toBe(t('header.chooseSession'));
    await openSession(view);
    const crumbs = view.querySelector<HTMLButtonElement>('.eg-header__crumbs')!;
    expect(crumbs.getAttribute('aria-label')).toBe(
      t('header.switcherOf', { campaign: 'Campaine Test', session: 'Session 1' }),
    );
    expect(view.querySelector('.eg-switcher')).toBeNull();
    await click(crumbs);
    press(view.querySelector('.eg-switcher')!, 'Escape');
    await settle();
    expect(view.querySelector('.eg-switcher')).toBeNull();
    expect(document.activeElement).toBe(crumbs);
  });

  it('names the session anew once it is renamed in the switcher and the switcher closes', async () => {
    const view = await open();
    await openSession(view);
    await openSwitcher(view);
    await click(button(view, 'Campaine Test'));
    await click(button(view, t('tree.renameOf', { name: 'Session 1' })));
    const field = view.querySelector<HTMLInputElement>('.eg-switcher input')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'Night one');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => field.form!.requestSubmit());
    await settle();
    press(view.querySelector('.eg-switcher')!, 'Escape');
    await settle();
    expect(view.querySelector('.eg-header__crumbs')!.getAttribute('aria-label')).toBe(
      t('header.switcherOf', { campaign: 'Campaine Test', session: 'Night one' }),
    );
  });

  it('counts the connected player views, 0 in the warning style, from the server', async () => {
    const view = await open();
    const counter = button(view, t('connect.open'))!;
    expect(document.getElementById(counter.getAttribute('aria-describedby')!)!.textContent).toBe(
      t('header.screens.other', { count: 0 }),
    );
    expect(counter.classList.contains('eg-screens--none')).toBe(true);
    expect(server.calls.some((call) => call.path === '/api/screens')).toBe(true);
  });

  it('offers Go live on the scene shown while nothing is live, and Go idle once it is', async () => {
    const view = await open();
    await openSession(view);
    await selectScene(view, 'Tavern');
    expect(liveText(view)).toBe(t('liveBar.none'));
    await click(button(view, t('liveBar.goLiveWith', { name: 'Tavern' })));
    expect(commands().at(-1)).toEqual({ type: 'scene.activate', payload: { scene_id: tavern.id } });
    expect(liveText(view)).toBe(`${t('liveBar.playersSee')} Tavern`);
    expect(button(view, t('liveBar.blank'))).toBeDefined();
  });
});

describe('the scene list (specs/08-ux-journeys.md §1, §11)', () => {
  it('lists the session’s scenes with their token counts, the live one on the TV and the others with a button to put them there', async () => {
    server.liveSceneId = tavern.id;
    const view = await open();
    // The live scene and its session are shown at once.
    expect(view.querySelector('.eg-scenes__session')!.textContent).toBe('Session 1');
    expect(view.querySelector('.eg-scenes__count')!.textContent).toBe(t('scenes.countDrag', { count: 3 }));
    expect(row(view, tavern).textContent).toContain(t('scenes.onTv'));
    expect(button(row(view, tavern), t('scenes.putOnTv', { name: 'Tavern' }))).toBeUndefined();
    expect(row(view, cellar).textContent).toContain(
      t('scenes.tokensHidden', { tokens: t('scenes.tokens.other', { count: 5 }), hidden: 5 }),
    );
    expect(row(view, road).textContent).toContain(t('scenes.noTokens'));
    await click(button(row(view, cellar), t('scenes.putOnTv', { name: 'Cellar' })));
    expect(commands().at(-1)).toEqual({ type: 'scene.activate', payload: { scene_id: cellar.id } });
    expect(view.querySelector('.eg-scene__name')!.textContent).toBe('Cellar');
    expect(row(view, cellar).textContent).toContain(t('scenes.onTv'));
  });

  it('reorders by Move down in a scene’s menu, which says why Move up refuses on the first', async () => {
    const view = await open();
    await openSession(view);
    await click(button(row(view, tavern), t('scenes.actionsOf', { name: 'Tavern' })));
    expect(menuItem(view, t('tree.moveUp'))!.getAttribute('aria-disabled')).toBe('true');
    expect(menuItem(view, t('tree.moveUp'))!.textContent).toContain(t('scenes.alreadyFirst'));
    await click(menuItem(view, t('tree.moveDown')));
    expect(server.calls.find((call) => call.method === 'PUT')).toMatchObject({
      path: `/api/sessions/${tavern.session_id}/scenes/order`,
      body: { ids: [cellar.id, tavern.id, road.id] },
    });
    await settle();
    expect([...view.querySelectorAll('.eg-scenes__name')].map((each) => each.textContent)).toEqual([
      'Cellar',
      'Tavern',
      'Road',
    ]);
  });

  it('duplicates, renames and deletes a scene from its menu', async () => {
    const view = await open();
    await openSession(view);
    await click(button(row(view, road), t('scenes.actionsOf', { name: 'Road' })));
    await click(menuItem(view, t('scenes.duplicate')));
    expect(server.calls.find((call) => call.method === 'POST' && call.path.endsWith('/duplicate'))).toMatchObject({
      path: `/api/scenes/${road.id}/duplicate`,
      body: { name: t('scenes.copyName', { name: 'Road' }) },
    });
    await click(button(row(view, road), t('scenes.actionsOf', { name: 'Road' })));
    await click(menuItem(view, t('tree.rename')));
    const field = row(view, road).querySelector('input')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'Old road');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => row(view, road).querySelector('form')!.requestSubmit());
    await settle();
    expect(server.scenes.find((each) => each.id === road.id)!.name).toBe('Old road');
    await click(button(row(view, road), t('scenes.actionsOf', { name: 'Old road' })));
    await click(menuItem(view, t('tree.delete')));
    await click(button(document.querySelector('dialog[open]')!, t('delete.confirm')));
    expect(view.querySelector(`[data-scene="${road.id}"]`)).toBeNull();
  });

  it('names the scene after the live one NEXT UP, puts it live by its button or Shift+N, and not while typing', async () => {
    server.liveSceneId = tavern.id;
    const view = await open();
    const next = view.querySelector('.eg-next')!;
    expect(next.querySelector('.eg-next__name')!.textContent).toBe('Cellar');
    const field = document.createElement('input');
    view.appendChild(field);
    press(field, 'N', { shiftKey: true });
    await settle();
    expect(commands()).toEqual([]);
    press(document.body, 'N', { shiftKey: true });
    await settle();
    expect(commands().at(-1)).toEqual({ type: 'scene.activate', payload: { scene_id: cellar.id } });
    expect(next.querySelector('.eg-next__name')!.textContent).toBe('Road');
    await click(button(next, t('next.goLiveOf', { name: 'Road' })));
    expect(commands().at(-1)).toEqual({ type: 'scene.activate', payload: { scene_id: road.id } });
    expect(view.querySelector('.eg-next__none')!.textContent).toBe(t('next.none'));
  });
});

describe('“In this scene” (specs/08-ux-journeys.md §11)', () => {
  it('groups the party and the monsters, marks hidden rows, and reveals all hidden monsters', async () => {
    server.liveSceneId = tavern.id;
    server.addToken(tavern.id, bandit, { x: 5, y: 1 });
    const view = await open();
    const groups = [...view.querySelectorAll('.eg-token-list__heading')].map((each) => each.textContent);
    // The scene's fog follows the tokens (TBL-04): none here.
    expect(groups).toEqual([
      t('sceneTokens.party', { count: 1 }),
      t('sceneTokens.monsters', { count: 2 }),
      t('fog.heading'),
    ]);
    expect(view.querySelectorAll('.eg-token-row[data-hidden]')).toHaveLength(2);
    expect(button(view, t('sceneTokens.revealOf', { label: 'Bandit' }))).toBeDefined();
    await click(button(view, t('sceneTokens.revealAll')));
    const reveals = commands().filter((command) => command.type === 'token.setVisibility');
    expect(reveals).toHaveLength(2);
    expect(view.querySelectorAll('.eg-token-row[data-hidden]')).toHaveLength(0);
    expect(button(view, t('sceneTokens.revealAll'))).toBeUndefined();
  });

  it('selects a token from its row, showing its popover on the map', async () => {
    server.liveSceneId = tavern.id;
    const view = await open();
    expect(listedTokens(view)).toEqual(['Hero', 'Bandit']);
    await selectTokenRow(view, 'Hero');
    expect(view.querySelector('.eg-popover__name')!.textContent).toBe('Hero');
    expect(view.querySelector('.eg-token-row--selected .eg-token-row__name')!.textContent).toBe('Hero');
  });
});

describe('condition markers in the popover (TBL-02, specs/08-ux-journeys.md §11)', () => {
  const chip = (view: HTMLElement, name: string) =>
    [...popover(view)!.querySelectorAll<HTMLButtonElement>('.eg-chip')].find((each) => each.textContent === name)!;
  const status = (view: HTMLElement, label: string) =>
    [...view.querySelectorAll('.eg-token-row')]
      .find((row) => row.querySelector('.eg-token-row__name')?.textContent === label)!
      .querySelector('.eg-token-row__status')!.textContent;

  it('toggles each marker on the live scene with token.setMarkers, the whole set each time', async () => {
    server.liveSceneId = tavern.id;
    const view = await open();
    await selectTokenRow(view, 'Hero');
    const group = popover(view)!.querySelector('[role="group"]')!;
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)!.textContent).toBe(t('tokens.conditions'));
    expect([...group.querySelectorAll('.eg-chip')].map((each) => each.textContent)).toEqual([
      t('tokens.markerBloodied'),
      t('tokens.markerUnconscious'),
      t('tokens.markerDead'),
      t('tokens.markerConcentrating'),
    ]);
    for (const each of group.querySelectorAll('.eg-chip')) expect(each.getAttribute('aria-pressed')).toBe('false');
    const hero = server.sceneTokens.find((each) => each.label === 'Hero')!;
    await click(chip(view, t('tokens.markerConcentrating')));
    expect(commands().at(-1)).toEqual({
      type: 'token.setMarkers',
      payload: { token_id: hero.id, markers: ['concentrating'] },
    });
    await click(chip(view, t('tokens.markerBloodied')));
    expect(commands().at(-1)).toMatchObject({ payload: { markers: ['concentrating', 'bloodied'] } });
    expect(chip(view, t('tokens.markerBloodied')).getAttribute('aria-pressed')).toBe('true');
    expect(status(view, 'Hero')).toBe(
      t('sceneTokens.withMarkers', {
        status: t('asset.category.pc'),
        markers: [t('tokens.markerBloodied'), t('tokens.markerConcentrating')].join(t('sceneTokens.markerSeparator')),
      }),
    );
    expect(view.querySelector('[role="status"].eg-scene__progress')!.textContent).toBe(
      t('tokens.markerOn', { label: 'Hero', marker: t('tokens.markerBloodied') }),
    );
    // Off again, and undone like any live change.
    await click(chip(view, t('tokens.markerConcentrating')));
    expect(commands().at(-1)).toMatchObject({ payload: { markers: ['bloodied'] } });
    expect(chip(view, t('tokens.markerConcentrating')).getAttribute('aria-pressed')).toBe('false');
    await click(button(view, t('canvas.undo')));
    expect(server.sceneTokens.find((each) => each.id === hero.id)!.markers).toEqual(['bloodied', 'concentrating']);
  });

  it('sets them over REST on a scene that is not live', async () => {
    const view = await open();
    await openSession(view);
    await selectScene(view, 'Tavern');
    await selectTokenRow(view, 'Bandit');
    await click(chip(view, t('tokens.markerDead')));
    expect(server.writes().at(-1)).toMatch(/^PATCH \/api\/tokens\//);
    expect(server.sceneTokens.find((each) => each.label === 'Bandit')!.markers).toEqual(['dead']);
    expect(chip(view, t('tokens.markerDead')).getAttribute('aria-pressed')).toBe('true');
    expect(commands()).toEqual([]);
  });
});

describe('shortcuts (specs/08-ux-journeys.md §11)', () => {
  it('hides the selected token with H, measures with M, selects with V and adds with T, none while typing', async () => {
    server.liveSceneId = tavern.id;
    const view = await open();
    await selectTokenRow(view, 'Hero');
    const field = document.createElement('input');
    view.appendChild(field);
    press(field, 'h');
    await settle();
    expect(commands()).toEqual([]);
    press(document.body, 'h');
    await settle();
    expect(commands().at(-1)).toMatchObject({ type: 'token.setVisibility', payload: { hidden: true } });
    press(document.body, 'm');
    await settle();
    expect(view.querySelector<HTMLElement>('[role="application"]')!.dataset.rulerTool).toBe('on');
    press(document.body, 'v');
    await settle();
    expect(view.querySelector<HTMLElement>('[role="application"]')!.dataset.rulerTool).toBe('off');
    press(document.body, 't');
    await settle();
    expect(document.querySelector('dialog[open]')!.textContent).toContain(t('tokens.picker.heading'));
  });

  it('reads redo as Ctrl+Shift+Z, Cmd+Shift+Z or Ctrl+Y, on a Greek keyboard too, and nothing else', () => {
    const key = (init: Partial<KeyboardEvent>) =>
      isRedoKey({ key: 'z', code: 'KeyZ', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...init });
    expect(key({ ctrlKey: true, shiftKey: true })).toBe(true);
    expect(key({ metaKey: true, shiftKey: true, key: 'Z' })).toBe(true);
    expect(key({ ctrlKey: true, key: 'y', code: 'KeyY' })).toBe(true);
    expect(key({ ctrlKey: true, shiftKey: true, key: 'ζ' })).toBe(true);
    expect(key({ ctrlKey: true })).toBe(false);
    expect(key({ shiftKey: true })).toBe(false);
    expect(key({ ctrlKey: true, shiftKey: true, altKey: true })).toBe(false);
    expect(key({ ctrlKey: true, shiftKey: true, key: 'y', code: 'KeyY' })).toBe(false);
  });
});

describe('undo and redo on the rail (specs/04-live-sync.md §8)', () => {
  it('greys each while the server says it would do nothing, and sends redo by the rail and by Ctrl+Shift+Z', async () => {
    server.liveSceneId = tavern.id;
    const view = await open();
    const undo = () => button(view, t('canvas.undo'))!;
    const redo = () => button(view, t('canvas.redo'))!;
    expect(undo().getAttribute('aria-disabled')).toBe('true');
    expect(redo().getAttribute('aria-disabled')).toBe('true');
    await selectTokenRow(view, 'Hero');
    press(document.body, 'h');
    await settle();
    expect(undo().getAttribute('aria-disabled')).toBeNull();
    await click(undo());
    expect(commands().at(-1)).toEqual({ type: 'undo', payload: {} });
    expect(undo().getAttribute('aria-disabled')).toBe('true');
    expect(redo().getAttribute('aria-disabled')).toBeNull();
    press(document.body, 'z', { ctrlKey: true, shiftKey: true });
    await settle();
    expect(commands().at(-1)).toEqual({ type: 'redo', payload: {} });
    expect(server.sceneTokens.find((each) => each.label === 'Hero')!.hidden).toBe(true);
    expect(redo().getAttribute('aria-disabled')).toBe('true');
    expect(view.querySelector('[role="status"].eg-scene__progress')!.textContent).toBe(t('scene.redone'));
  });
});

describe('ping (TBL-01, specs/04-live-sync.md §12)', () => {
  const canvas = (view: HTMLElement) => view.querySelector<HTMLElement>('[role="application"]')!;
  const pings = (view: HTMLElement) => JSON.parse(canvas(view).dataset.pings ?? '[]') as { x: number; y: number }[];

  it('pings the centre of the view with Enter on the live scene, drawn here once the server says so', async () => {
    server.liveSceneId = tavern.id;
    const view = await open();
    const tool = button(view, t('canvas.toolPing'))!;
    expect(tool.getAttribute('aria-disabled')).toBeNull();
    expect(tool.getAttribute('aria-pressed')).toBe('false');
    press(document.body, 'p');
    await settle();
    expect(canvas(view).dataset.pingTool).toBe('on');
    expect(tool.getAttribute('aria-pressed')).toBe('true');
    expect(button(view, t('canvas.toolSelect'))!.getAttribute('aria-pressed')).toBe('false');
    press(canvas(view), 'Enter');
    await settle();
    const sent = commands().at(-1)!;
    expect(sent).toMatchObject({ type: 'ping', payload: { scene_id: tavern.id } });
    const { x, y } = sent.payload as { x: number; y: number };
    expect([typeof x, typeof y]).toEqual(['number', 'number']);
    expect(pings(view)).toEqual([expect.objectContaining({ x, y })]);
    // Nothing of it is kept: no undo, no snapshot.
    expect(button(view, t('canvas.undo'))!.getAttribute('aria-disabled')).toBe('true');
  });

  it('gives way to the ruler and to Select, and stops with P or Escape on the map', async () => {
    server.liveSceneId = tavern.id;
    const view = await open();
    press(document.body, 'p');
    await settle();
    press(document.body, 'm');
    await settle();
    expect(canvas(view).dataset.rulerTool).toBe('on');
    expect(canvas(view).dataset.pingTool).toBe('off');
    await click(button(view, t('canvas.toolPing')));
    expect(canvas(view).dataset.pingTool).toBe('on');
    expect(canvas(view).dataset.rulerTool).toBe('off');
    press(document.body, 'v');
    await settle();
    expect(canvas(view).dataset.pingTool).toBe('off');
    press(canvas(view), 'p');
    await settle();
    expect(canvas(view).dataset.pingTool).toBe('on');
    press(canvas(view), 'Escape');
    await settle();
    expect(canvas(view).dataset.pingTool).toBe('off');
    expect(commands().filter((each) => each.type === 'ping')).toEqual([]);
  });

  it('is not offered on a scene that is not live, where P does nothing', async () => {
    server.liveSceneId = cellar.id;
    const view = await open();
    await selectScene(view, 'Tavern');
    const tool = button(view, t('canvas.toolPing'))!;
    expect(tool.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(tool.getAttribute('aria-describedby')!)!.textContent).toBe(t('canvas.pingLiveOnly'));
    press(document.body, 'p');
    await settle();
    expect(canvas(view).dataset.pingTool).toBeUndefined();
    press(canvas(view), 'Enter');
    await settle();
    expect(commands().filter((each) => each.type === 'ping')).toEqual([]);
  });
});

describe('NEXT UP (UIX-01)', () => {
  const scenes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as Scene[];
  it('is the scene after the live one in this session, else after the one shown, and none after the last', () => {
    expect(nextScene(scenes, 'a', 'c')?.id).toBe('b');
    expect(nextScene(scenes, 'elsewhere', 'b')?.id).toBe('c');
    expect(nextScene(scenes, undefined, undefined)?.id).toBe('a');
    expect(nextScene(scenes, 'c', undefined)).toBeUndefined();
  });
});
