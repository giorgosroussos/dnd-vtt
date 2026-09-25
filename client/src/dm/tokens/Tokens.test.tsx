// @vitest-environment jsdom
import { act, createElement } from 'react';
import Konva from 'konva';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LibraryAsset, Scene } from '@emberglass/shared';
import { t } from '../../ui/messages.js';
import { installCanvas2d, installImageLoading, installResizeObserver } from '../../ui/testing/canvas2d.js';
import { button, click, FakeServer, installDialog, settle, submit, type } from '../../ui/testing/fakeServer.js';
import { render, type Rendered } from '../../ui/testing/render.js';
import { SEARCH_DELAY_MS } from '../library/useAssetSearch.js';
import { ScenePanel } from '../ScenePanel.js';

// Tokens in preparation, in the scene panel (PRP-04, specs/05-assets-and-images.md §2–§5,
// specs/06-grid-and-measurement.md §4, specs/04-live-sync.md §2, specs/08-ux-journeys.md §8, §9,
// D-019, D-100), against a scripted server behind fetch.

let server: FakeServer;
let rendered: Rendered | undefined;
let scene: Scene;
let goblin: LibraryAsset;
let hero: LibraryAsset;

beforeEach(() => {
  installCanvas2d();
  installResizeObserver({ width: 800, height: 600 });
  installImageLoading();
  installDialog();
  server = new FakeServer().install();
  const campaign = server.addCampaign('Lost Mine');
  const session = server.addSession(campaign.id, 'One');
  scene = server.addScene(session.id, 'Cave');
  // A calibrated map: 100 original px squares from 30, 250, shown at half size.
  const map = server.addImage({ width: 4000, height: 3000, variants: { display: { width: 2000, height: 1500 } } });
  server.scenes[0]!.map_image_id = map.id;
  server.scenes[0]!.grid = { ...server.scenes[0]!.grid, size: 100, offset_x: 30, offset_y: 250, columns: 40, rows: 30 };
  goblin = server.addAsset({ name: 'Goblin', category: 'monster', tags: ['cave'] });
  hero = server.addAsset({ name: 'Hero', category: 'pc', size: 'large', default_hidden: false });
});

afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  server.uninstall();
});

async function open(target: Scene = scene): Promise<HTMLElement> {
  rendered = render(createElement(ScenePanel, { sceneId: target.id, name: target.name, uploadLimit: 1 << 30 }));
  await settle();
  return rendered.container;
}

// The map's stage; while calibrating, the magnifier has one of its own.
const stage = () => Konva.stages.filter((each) => each.findOne('.tokens')).at(-1)!;
const viewport = (view: HTMLElement) => view.querySelector<HTMLElement>('[role="application"]')!;
const picker = () => document.querySelector<HTMLDialogElement>('dialog[open]')!;
const status = (view: HTMLElement) => view.querySelector('[role="status"]')!.textContent;
const labels = () =>
  stage()
    .find<Konva.Label>('.token-label')
    .map((label) => label.findOne<Konva.Text>('Text')!.text());
const tokenSelect = (view: HTMLElement) =>
  [...view.querySelectorAll('select')].find((each) => each.labels?.[0]?.textContent === t('tokens.selected'))!;

function press(element: HTMLElement, key: string) {
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

/** A click on the map at grid position (gx, gy), through the fitted camera. */
async function clickMap(gx: number, gy: number, altKey = false) {
  const s = stage();
  const evt = new MouseEvent('click', {
    clientX: s.x() + (15 + gx * 50) * s.scaleX(),
    clientY: s.y() + (125 + gy * 50) * s.scaleY(),
    altKey,
    bubbles: true,
  });
  act(() => {
    s.setPointersPositions(evt);
    s.fire('click', { evt, target: s });
  });
  await settle();
}

async function addThroughPicker(view: HTMLElement, asset: LibraryAsset) {
  await click(button(view, t('tokens.add')));
  await click(button(picker(), t('tokens.picker.chooseOf', { name: asset.name })));
}

async function selectToken(view: HTMLElement, label: string) {
  const select = tokenSelect(view);
  const option = [...select.options].find((each) => each.textContent?.startsWith(label))!;
  act(() => {
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}

describe('the add flow: button, picker, click on the map (specs/05-assets-and-images.md §5)', () => {
  it('places the chosen asset where the map is clicked, in grid units, numbered and hidden from its asset', async () => {
    const view = await open();
    await addThroughPicker(view, goblin);
    expect(picker()).toBeNull();
    expect(view.textContent).toContain(t('tokens.placing', { name: 'Goblin' }));
    // Focus waits on the map, where Enter would place it too.
    expect(document.activeElement).toBe(viewport(view));
    await clickMap(5.5, 7.5);
    const post = server.calls.find((call) => call.method === 'POST' && call.path.endsWith('/tokens'))!;
    expect(post).toEqual({
      method: 'POST',
      path: `/api/scenes/${scene.id}/tokens`,
      body: { asset_id: goblin.id, x: 5, y: 7 },
    });
    expect(labels()).toEqual(['Goblin']);
    expect(stage().findOne('.token-hidden-marker')).toBeDefined();
    expect(status(view)).toBe(t('tokens.placed', { label: 'Goblin' }));
    // The new token is selected; a second hidden one takes the bare name too, numbered only when
    // it is shown to players (Q-092).
    expect(tokenSelect(view).value).toBe(server.sceneTokens[0]!.id);
    await addThroughPicker(view, goblin);
    await clickMap(1.2, 1.2, true);
    expect(labels()).toEqual(['Goblin', 'Goblin']);
    const free = server.sceneTokens[1]!;
    expect(free.x).toBeCloseTo(0.7, 3);
    expect(free.y).toBeCloseTo(0.7, 3);
  });

  it('searches and filters in the picker as the library does', async () => {
    const view = await open();
    await click(button(view, t('tokens.add')));
    const names = () => [...picker().querySelectorAll('.eg-library__name')].map((each) => each.textContent);
    expect(names()).toEqual(['Goblin', 'Hero']);
    await type(picker().querySelector('input[type="search"]'), 'her');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SEARCH_DELAY_MS + 20));
    });
    await settle();
    expect(names()).toEqual(['Hero']);
    await type(picker().querySelector('input[type="search"]'), '');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SEARCH_DELAY_MS + 20));
    });
    await click(button(picker(), t('library.tagOf', { tag: 'cave' })));
    expect(names()).toEqual(['Goblin']);
    expect(server.calls.some((call) => call.path === '/api/assets?tag=cave')).toBe(true);
    await click(button(picker(), t('tokens.picker.cancel')));
    expect(picker()).toBeNull();
    expect(document.activeElement).toBe(button(view, t('tokens.add')));
  });

  it('places at the centre of the view by Enter, and Escape cancels placing', async () => {
    const view = await open();
    await addThroughPicker(view, hero);
    press(viewport(view), 'Escape');
    await settle();
    expect(view.textContent).not.toContain(t('tokens.placing', { name: 'Hero' }));
    expect(server.writes()).toEqual([]);
    expect(document.activeElement).toBe(button(view, t('tokens.add')));
    await addThroughPicker(view, hero);
    press(viewport(view), 'Enter');
    await settle();
    expect(server.sceneTokens).toHaveLength(1);
    expect(server.sceneTokens[0]).toMatchObject({ label: 'Hero', hidden: false });
    expect(Number.isInteger(server.sceneTokens[0]!.x)).toBe(true);
    expect(stage().findOne('.token-hidden-marker')).toBeUndefined();
  });
});

describe('the test server (review)', () => {
  it('refuses the bodies the contract refuses, as the server does', async () => {
    const placed = server.addToken(scene.id, goblin, { x: 1, y: 1 });
    for (const body of [{}, { x: 1, z_order: 2 }, { label: '   ' }, { stack: 'up' }]) {
      expect((await server.reply({ method: 'PATCH', path: `/api/tokens/${placed.id}`, body })).status).toBe(400);
    }
    for (const body of [
      { asset_id: goblin.id, x: 0 },
      { asset_id: goblin.id, x: 0, y: 0, hidden: false },
    ]) {
      expect((await server.reply({ method: 'POST', path: `/api/scenes/${scene.id}/tokens`, body })).status).toBe(400);
    }
    expect(server.sceneTokens).toEqual([placed]);
  });
});

describe('changing tokens (specs/04-live-sync.md §2, D-100)', () => {
  it('hides and reveals, renames, restacks and deletes the selected token', async () => {
    // Numbered before they were hidden again, so a reveal keeps their labels.
    server.addToken(scene.id, goblin, { x: 1, y: 1, label: 'Goblin 1' });
    server.addToken(scene.id, goblin, { x: 3, y: 1, label: 'Goblin 2' });
    const view = await open();
    expect(labels()).toEqual(['Goblin 1', 'Goblin 2']);
    await selectToken(view, 'Goblin 1');
    // Each action is named after the token it acts on, apart from the tree's own Delete buttons.
    for (const key of [
      'tokens.revealOf',
      'tokens.renameOf',
      'tokens.frontOf',
      'tokens.backOf',
      'tokens.deleteOf',
    ] as const) {
      expect(button(view, t(key, { label: 'Goblin 1' })), key).toBeDefined();
    }
    await click(button(view, t('tokens.reveal')));
    expect(server.calls.at(-1)).toMatchObject({ method: 'PATCH', body: { hidden: false } });
    expect(button(view, t('tokens.hide'))).toBeDefined();
    expect(tokenSelect(view).selectedOptions[0]!.textContent).toBe('Goblin 1');

    await click(button(view, t('tokens.front')));
    expect(server.calls.at(-1)).toMatchObject({ method: 'PATCH', body: { stack: 'front' } });
    expect(labels()).toEqual(['Goblin 2', 'Goblin 1']);
    await click(button(view, t('tokens.back')));
    expect(labels()).toEqual(['Goblin 1', 'Goblin 2']);

    // Focused first, as a click or the keyboard leaves it in a browser.
    button(view, t('tokens.rename'))!.focus();
    await click(button(view, t('tokens.rename')));
    const field = document.querySelector<HTMLInputElement>('dialog[open] input')!;
    await type(field, '   ');
    await submit(document.querySelector('dialog[open] form'));
    expect(document.querySelector('dialog[open]')!.textContent).toContain(t('tokens.renameDialog.required'));
    await type(field, 'Chief');
    await submit(document.querySelector('dialog[open] form'));
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(labels()).toContain('Chief');
    expect(document.activeElement).toBe(button(view, t('tokens.rename')));

    await click(button(view, t('tokens.delete')));
    expect(document.querySelector('dialog[open]')!.textContent).toContain(t('tokens.deleteDialog.body'));
    await click(button(document.querySelector('dialog[open]')!, t('tokens.deleteDialog.cancel')));
    expect(server.sceneTokens).toHaveLength(2);
    await click(button(view, t('tokens.delete')));
    await click(button(document.querySelector('dialog[open]')!, t('tokens.deleteDialog.confirm')));
    expect(server.sceneTokens.map((each) => each.label)).toEqual(['Goblin 2']);
    expect(labels()).toEqual(['Goblin 2']);
    expect(status(view)).toBe(t('tokens.deleted', { label: 'Chief' }));
  });

  it('numbers hidden tokens as they are revealed, redrawing the one renamed beside them (Q-092)', async () => {
    server.addToken(scene.id, goblin, { x: 1, y: 1 });
    server.addToken(scene.id, goblin, { x: 3, y: 1 });
    const view = await open();
    expect(labels()).toEqual(['Goblin', 'Goblin']);
    expect([...tokenSelect(view).options].map((option) => option.textContent)).toEqual([
      t('tokens.none'),
      t('tokens.optionHidden', { label: 'Goblin' }),
      t('tokens.optionHidden', { label: 'Goblin' }),
    ]);
    act(() => {
      tokenSelect(view).value = server.sceneTokens[0]!.id;
      tokenSelect(view).dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click(button(view, t('tokens.reveal')));
    expect(labels()).toEqual(['Goblin', 'Goblin']);
    act(() => {
      tokenSelect(view).value = server.sceneTokens[1]!.id;
      tokenSelect(view).dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click(button(view, t('tokens.reveal')));
    expect(labels()).toEqual(['Goblin 1', 'Goblin 2']);
    expect(server.calls.filter((call) => call.method === 'GET' && call.path.endsWith('/tokens'))).toHaveLength(1);
  });

  it('moves a token dropped on the map, snapped, and by the arrow keys, keeping the latest answer', async () => {
    const placed = server.addToken(scene.id, goblin, { x: 1, y: 1 });
    const view = await open();
    const group = stage().findOne<Konva.Group>(`#token-${placed.id}`)!;
    act(() => {
      group.fire('dragstart', { target: group, evt: new MouseEvent('mousedown') });
      group.position({ x: 15 + 4.3 * 50, y: 125 + 2.8 * 50 });
      group.fire('dragend', { target: group, evt: new MouseEvent('mouseup') });
    });
    await settle();
    expect(server.sceneTokens[0]).toMatchObject({ x: 4, y: 3 });
    expect(tokenSelect(view).value).toBe(placed.id);
    // Two keys in quick succession while the first move is unanswered: each moves a square at once,
    // and the second is sent only once the first is answered, so the server ends where the view does.
    let release: (() => void) | undefined;
    server.before = (call) => {
      if (call.method !== 'PATCH' || release) return undefined;
      return new Promise((resolve) => {
        release = () => resolve(undefined);
      });
    };
    press(viewport(view), 'ArrowRight');
    press(viewport(view), 'ArrowRight');
    await settle();
    expect(stage().findOne<Konva.Group>(`#token-${placed.id}`)!.x()).toBe(15 + 6 * 50);
    expect(server.calls.filter((call) => call.method === 'PATCH')).toHaveLength(2);
    expect(server.sceneTokens[0]).toMatchObject({ x: 4, y: 3 });
    release!();
    await settle();
    expect(server.calls.filter((call) => call.method === 'PATCH').map((call) => call.body)).toEqual([
      { x: 4, y: 3 },
      { x: 5, y: 3 },
      { x: 6, y: 3 },
    ]);
    expect(server.sceneTokens[0]).toMatchObject({ x: 6, y: 3 });
    expect(stage().findOne<Konva.Group>(`#token-${placed.id}`)!.x()).toBe(15 + 6 * 50);
  });

  it("shows why the live scene's tokens are refused and draws what the server has", async () => {
    server.addToken(scene.id, goblin, { x: 1, y: 1 });
    server.liveSceneId = scene.id;
    const view = await open();
    await selectToken(view, 'Goblin');
    await click(button(view, t('tokens.reveal')));
    expect(view.querySelector('[role="alert"]')!.textContent).toBe(t('error.code.scene_live'));
    expect(stage().findOne('.token-hidden-marker')).toBeDefined();
    expect(server.sceneTokens[0]!.hidden).toBe(true);
  });

  it('shows a refused placement and a refused deletion, drawing what the server has (review)', async () => {
    const placed = server.addToken(scene.id, goblin, { x: 1, y: 1 });
    const view = await open();
    server.liveSceneId = scene.id;
    await addThroughPicker(view, hero);
    await clickMap(5.5, 5.5);
    expect(view.querySelector('[role="alert"]')!.textContent).toBe(t('error.code.scene_live'));
    expect(labels()).toEqual(['Goblin']);
    expect(document.activeElement).toBe(viewport(view));
    await selectToken(view, 'Goblin');
    await click(button(view, t('tokens.delete')));
    await click(button(document.querySelector('dialog[open]')!, t('tokens.deleteDialog.confirm')));
    expect(view.querySelector('[role="alert"]')!.textContent).toBe(t('error.code.scene_live'));
    expect(labels()).toEqual(['Goblin']);
    expect(server.sceneTokens).toEqual([placed]);
  });

  it('shows a refused rename beside its field, keeping the dialog open (review)', async () => {
    server.addToken(scene.id, goblin, { x: 1, y: 1 });
    const view = await open();
    server.liveSceneId = scene.id;
    await selectToken(view, 'Goblin');
    await click(button(view, t('tokens.rename')));
    await type(document.querySelector('dialog[open] input'), 'Chief');
    await submit(document.querySelector('dialog[open] form'));
    const dialog = document.querySelector('dialog[open]')!;
    expect(dialog.querySelector('.eg-field__error')!.textContent).toBe(t('error.code.scene_live'));
    expect(view.querySelector('[role="alert"]')).toBeNull();
    expect(labels()).toEqual(['Goblin']);
  });

  it("applies only the latest of a token's changes, showing no refusal of one it superseded (review)", async () => {
    const placed = server.addToken(scene.id, goblin, { x: 1, y: 1 });
    const view = await open();
    await selectToken(view, 'Goblin');
    let release: (() => void) | undefined;
    server.before = (call) => {
      if (call.method !== 'PATCH' || release) return undefined;
      return new Promise((resolve) => {
        release = () => resolve({ status: 409, body: { error: { code: 'scene_live', message: 'test' } } });
      });
    };
    press(viewport(view), 'ArrowRight');
    press(viewport(view), 'ArrowRight');
    await settle();
    release!();
    await settle();
    expect(view.querySelector('[role="alert"]')).toBeNull();
    expect(server.sceneTokens[0]).toMatchObject({ id: placed.id, x: 3, y: 1 });
    expect(server.calls.filter((call) => call.method === 'GET' && call.path.endsWith('/tokens'))).toHaveLength(1);
  });

  it('returns focus where the DM was: the map after placing, the Delete button after keeping, Add token after deleting (review)', async () => {
    const view = await open();
    await addThroughPicker(view, goblin);
    await clickMap(2.5, 2.5);
    expect(document.activeElement).toBe(viewport(view));
    const remove = button(view, t('tokens.deleteOf', { label: 'Goblin' }))!;
    remove.focus();
    await click(remove);
    // The dialog opens on the button that keeps the token.
    expect(document.activeElement).toBe(
      button(document.querySelector('dialog[open]')!, t('tokens.deleteDialog.cancel')),
    );
    await click(button(document.querySelector('dialog[open]')!, t('tokens.deleteDialog.cancel')));
    expect(document.activeElement).toBe(button(view, t('tokens.deleteOf', { label: 'Goblin' })));
    await click(button(view, t('tokens.deleteOf', { label: 'Goblin' })));
    await click(button(document.querySelector('dialog[open]')!, t('tokens.deleteDialog.confirm')));
    expect(document.activeElement).toBe(button(view, t('tokens.add')));
  });

  it("sends a deletion only after the token's pending move has been answered (review)", async () => {
    server.addToken(scene.id, goblin, { x: 1, y: 1 });
    const view = await open();
    await selectToken(view, 'Goblin');
    let release: (() => void) | undefined;
    server.before = (call) => {
      if (call.method !== 'PATCH' || release) return undefined;
      return new Promise((resolve) => {
        release = () => resolve(undefined);
      });
    };
    press(viewport(view), 'ArrowRight');
    await settle();
    await click(button(view, t('tokens.delete')));
    await click(button(document.querySelector('dialog[open]')!, t('tokens.deleteDialog.confirm')));
    expect(server.writes().filter((write) => write.startsWith('DELETE'))).toEqual([]);
    release!();
    await settle();
    expect(server.writes().map((write) => write.split(' ')[0])).toEqual(['PATCH', 'DELETE']);
    expect(server.sceneTokens).toEqual([]);
    expect(view.querySelector('[role="alert"]')).toBeNull();
  });

  it('says what each change did in the status region (review)', async () => {
    server.addToken(scene.id, goblin, { x: 1, y: 1 });
    const view = await open();
    await selectToken(view, 'Goblin');
    await click(button(view, t('tokens.reveal')));
    expect(status(view)).toBe(t('tokens.revealed', { label: 'Goblin' }));
    await click(button(view, t('tokens.front')));
    expect(status(view)).toBe(t('tokens.toFront', { label: 'Goblin' }));
    press(viewport(view), 'ArrowDown');
    await settle();
    expect(status(view)).toBe(t('tokens.moved', { label: 'Goblin', column: '2', row: '3' }));
  });

  it('says when the tokens cannot be loaded, offers no token control, and loads them again on Retry (review)', async () => {
    server.addToken(scene.id, goblin, { x: 1, y: 1 });
    let fail = true;
    server.before = (call) =>
      fail && call.method === 'GET' && call.path.endsWith('/tokens')
        ? { status: 500, body: { error: { code: 'internal_error', message: 'test' } } }
        : undefined;
    const view = await open();
    expect(view.textContent).toContain(t('tokens.loadFailed', { reason: t('error.code.internal_error') }));
    expect(button(view, t('tokens.add'))).toBeUndefined();
    fail = false;
    await click(button(view, t('tokens.retry')));
    expect(labels()).toEqual(['Goblin']);
    expect(button(view, t('tokens.add'))).toBeDefined();
    expect(button(view, t('tokens.retry'))).toBeUndefined();
  });

  it('keeps a placement on the map, marks where Enter places, and cancels on Escape from the placing bar (review)', async () => {
    const view = await open();
    await addThroughPicker(view, goblin);
    expect(stage().findOne('.place-target')).toBeDefined();
    // Far left of the map, in the void: the token goes to the map's first column.
    await clickMap(-6, 3.5);
    expect(server.sceneTokens[0]).toMatchObject({ x: 0, y: 3 });
    await addThroughPicker(view, goblin);
    const bar = view.querySelector<HTMLElement>('.eg-tokens')!;
    press(bar, 'Escape');
    await settle();
    expect(view.textContent).not.toContain(t('tokens.placing', { name: 'Goblin' }));
    expect(stage().findOne('.place-target')).toBeUndefined();
  });

  it('draws the tokens but offers no token control while calibrating', async () => {
    server.addToken(scene.id, goblin, { x: 1, y: 1 });
    const view = await open();
    await click(button(view, t('calibration.open')));
    expect(button(view, t('tokens.add'))).toBeUndefined();
    expect(labels()).toEqual(['Goblin']);
    expect(stage().findOne<Konva.Group>('.token')!.draggable()).toBe(false);
  });

  it('draws tokens on a map-less scene too', async () => {
    const open2 = server.addScene(server.sessions[0]!.id, 'Open ground');
    server.addToken(open2.id, hero, { x: 2, y: 2 });
    const view = await open(open2);
    expect(labels()).toEqual(['Hero']);
    expect(button(view, t('tokens.add'))).toBeDefined();
  });
});
