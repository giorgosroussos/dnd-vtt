// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FogMask, LibraryAsset, Scene, SceneToken } from '@emberglass/shared';
import { t } from '../ui/messages.js';
import { installCanvas2d, installImageLoading, installResizeObserver } from '../ui/testing/canvas2d.js';
import { button, click, FakeServer, installDialog, selectScene, settle } from '../ui/testing/fakeServer.js';
import { render, type Rendered } from '../ui/testing/render.js';
import { underFog } from './fog/FogPanel.js';
import { Workspace } from './Workspace.js';

// Painted fog in the DM view (TBL-04, specs/04-live-sync.md §2, §13, specs/08-ux-journeys.md §11, Q-101),
// against a scripted server: the brush paints and erases, its size on a slider and by [ and ]; Fog all and
// Clear all, each asked first; the panel says how many tokens the fog keeps from players. On the live scene
// each change is a fog command that undo takes back, in preparation a REST write.

let server: FakeServer;
let rendered: Rendered | undefined;
let tavern: Scene;
let cellar: Scene;
let bandit: LibraryAsset;
let hero: LibraryAsset;

// Grid (4, 0) to (8, 4), over the bandit's centre (5.5, 1.5) and away from the hero's (1.5, 1.5).
const BACK_ROOM: FogMask = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((y) => ({ y, runs: [16, 32] }));

beforeEach(() => {
  installCanvas2d();
  installResizeObserver({ width: 800, height: 600 });
  installImageLoading();
  installDialog();
  server = new FakeServer().install();
  const session = server.addSession(server.addCampaign('Campaine Test').id, 'Session 1');
  tavern = server.addScene(session.id, 'Tavern');
  cellar = server.addScene(session.id, 'Cellar');
  bandit = server.addAsset({ name: 'Bandit', category: 'monster', default_hidden: false });
  hero = server.addAsset({ name: 'Hero', category: 'pc', default_hidden: false });
  server.addToken(tavern.id, hero, { x: 1, y: 1 });
  server.addToken(tavern.id, bandit, { x: 5, y: 1 });
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

const commands = () => server.sockets.flatMap((socket) => socket.commands());
const canvas = (view: HTMLElement) => view.querySelector<HTMLElement>('[role="application"]')!;
const press = async (target: EventTarget, key: string) => {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
  await settle();
};
const fogStatus = (view: HTMLElement) => view.querySelector('.eg-fog-row .eg-token-row__status')?.textContent;
const statusOfToken = (view: HTMLElement, label: string) =>
  [...view.querySelectorAll('.eg-token-row')]
    .find((row) => row.querySelector('.eg-token-row__name')?.textContent === label)!
    .querySelector('.eg-token-row__status')!.textContent;
const status = (view: HTMLElement) => view.querySelector('[role="status"].eg-scene__progress')?.textContent;
const bar = (view: HTMLElement) => view.querySelector<HTMLElement>(`[role="group"][aria-label="${t('fog.bar')}"]`);
const slider = (view: HTMLElement) => bar(view)!.querySelector<HTMLInputElement>('input[type="range"]')!;
const dialog = () => document.querySelector<HTMLElement>('dialog[open]');

describe('the fog brush on the live scene', () => {
  it('paints with the keys and sends fog.paint; the panel and the token rows say what the fog hides', async () => {
    server.liveSceneId = tavern.id;
    const view = await open();
    expect(fogStatus(view)).toBe(t('fog.status.none'));
    expect(button(view, t('canvas.toolFog'))!.getAttribute('aria-disabled')).toBeNull();
    await press(document.body, 'f');
    expect(canvas(view).dataset.fogTool).toBe('on');
    expect(bar(view)).not.toBeNull();
    await press(canvas(view), 'Enter');
    const sent = commands().at(-1)!;
    expect(sent).toMatchObject({ type: 'fog.paint', payload: { scene_id: tavern.id, stroke: { mode: 'paint' } } });
    expect(status(view)).toBe(t('fog.painted'));
    expect(server.fogOf(tavern.id).length).toBeGreaterThan(0);
    expect(JSON.parse(canvas(view).dataset.fog!)).toEqual(server.fogOf(tavern.id));
  });

  it('counts the tokens under the fog, and names it in their rows', async () => {
    server.liveSceneId = tavern.id;
    server.fogs[tavern.id] = BACK_ROOM;
    const view = await open();
    expect(fogStatus(view)).toBe(t('fog.status.one', { count: 1 }));
    expect(statusOfToken(view, 'Bandit')).toBe(t('sceneTokens.inFog', { status: t('asset.category.monster') }));
    expect(statusOfToken(view, 'Hero')).toBe(t('asset.category.pc'));
  });

  it('erases, sizes the brush on its slider and by the keys, and turns off with Done or V', async () => {
    server.liveSceneId = tavern.id;
    server.fogs[tavern.id] = BACK_ROOM;
    const view = await open();
    await click(button(view, t('fog.paintFog')));
    expect(canvas(view).dataset.fogTool).toBe('on');
    await click(button(bar(view)!, t('fog.erase')));
    expect(button(bar(view)!, t('fog.erase'))!.getAttribute('aria-pressed')).toBe('true');
    expect(canvas(view).dataset.fogBrush).toBe('erase 1');
    act(() => {
      Reflect.set(HTMLInputElement.prototype, 'value', '2.5', slider(view));
      slider(view).dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();
    expect(canvas(view).dataset.fogBrush).toBe('erase 2.5');
    expect(slider(view).getAttribute('aria-valuetext')).toBe(t('fog.radiusValue.other', { radius: '2.5' }));
    await press(document.body, ']');
    expect(canvas(view).dataset.fogBrush).toBe('erase 2.75');
    await press(document.body, 'e');
    expect(canvas(view).dataset.fogBrush).toBe('paint 2.75');
    await press(document.body, 'e');
    await press(canvas(view), 'Enter');
    expect(commands().at(-1)).toMatchObject({
      type: 'fog.paint',
      payload: { stroke: { mode: 'erase', radius: 2.75 } },
    });
    expect(status(view)).toBe(t('fog.erased'));
    await click(button(bar(view)!, t('fog.done')));
    expect(canvas(view).dataset.fogTool).toBe('off');
    expect(bar(view)).toBeNull();
    await press(document.body, 'f');
    await press(document.body, 'v');
    expect(canvas(view).dataset.fogTool).toBe('off');
  });

  it('fogs the whole map and clears it, each asked first, and undo takes a change back', async () => {
    server.liveSceneId = tavern.id;
    const view = await open();
    await press(document.body, 'f');
    await click(button(bar(view)!, t('fog.fillAll')));
    expect(dialog()!.textContent).toContain(t('fog.fillHeading'));
    expect(dialog()!.textContent).toContain(t('fog.fillBody'));
    await click(button(dialog()!, t('fog.cancel')));
    expect(commands().filter((each) => each.type === 'fog.fill')).toEqual([]);
    await click(button(bar(view)!, t('fog.fillAll')));
    await click(button(dialog()!, t('fog.fillConfirm')));
    expect(commands().at(-1)).toEqual({ type: 'fog.fill', payload: { scene_id: tavern.id, fogged: true } });
    expect(status(view)).toBe(t('fog.filled'));
    expect(fogStatus(view)).toBe(t('fog.status.other', { count: 2 }));
    await click(button(bar(view)!, t('fog.clearAll')));
    expect(dialog()!.textContent).toContain(t('fog.clearBody'));
    await click(button(dialog()!, t('fog.clearConfirm')));
    expect(commands().at(-1)).toEqual({ type: 'fog.fill', payload: { scene_id: tavern.id, fogged: false } });
    expect(fogStatus(view)).toBe(t('fog.status.none'));
    await click(button(view, t('canvas.undo')));
    expect(commands().at(-1)).toEqual({ type: 'undo', payload: {} });
    expect(fogStatus(view)).toBe(t('fog.status.other', { count: 2 }));
  });
});

describe('the fog brush in preparation', () => {
  it('paints and fills over REST on a scene that is not live, reading the tokens again after each', async () => {
    server.liveSceneId = cellar.id;
    const view = await open();
    await selectScene(view, 'Tavern');
    const tokenReads = () =>
      server.calls.filter((call) => call.method === 'GET' && call.path.endsWith('/tokens')).length;
    const before = tokenReads();
    await press(document.body, 'f');
    await press(canvas(view), 'Enter');
    expect(server.writes().at(-1)).toBe(`POST /api/scenes/${tavern.id}/fog`);
    expect(server.fogOf(tavern.id).length).toBeGreaterThan(0);
    expect(tokenReads()).toBeGreaterThan(before);
    await click(button(bar(view)!, t('fog.clearAll')));
    // In preparation there is no undo, and the dialog says so.
    expect(dialog()!.textContent).toContain(t('fog.clearBodyPrep'));
    await click(button(dialog()!, t('fog.clearConfirm')));
    expect(server.fogOf(tavern.id)).toEqual([]);
    expect(commands()).toEqual([]);
  });

  it('says why the server refused a write, and keeps the fog as it was', async () => {
    server.liveSceneId = cellar.id;
    const view = await open();
    await selectScene(view, 'Tavern');
    await press(document.body, 'f');
    // The scene goes live elsewhere: the server refuses preparation writes to it.
    server.liveSceneId = tavern.id;
    await press(canvas(view), 'Enter');
    expect(view.textContent).toContain(t('fog.failed', { reason: '' }).trim());
    expect(JSON.parse(canvas(view).dataset.fog!)).toEqual([]);
  });
});

describe('what the fog hides (specs/04-live-sync.md §4)', () => {
  const token = (fields: Partial<SceneToken>): SceneToken =>
    ({ id: 't', x: 0, y: 0, hidden: false, asset: { size: 'medium' }, ...fields }) as SceneToken;

  it('takes a token as under the fog by its centre', () => {
    expect(underFog(token({ x: 5, y: 1 }), BACK_ROOM)).toBe(true);
    // Its footprint overlaps the fog, its centre (8.5, 1.5) does not lie under it.
    expect(underFog(token({ x: 8, y: 1 }), BACK_ROOM)).toBe(false);
    expect(underFog(token({ x: 1, y: 1 }), BACK_ROOM)).toBe(false);
  });
});
