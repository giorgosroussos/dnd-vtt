// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LibraryAsset, Region, Scene, SceneToken } from '@emberglass/shared';
import { t } from '../ui/messages.js';
import { installCanvas2d, installImageLoading, installResizeObserver } from '../ui/testing/canvas2d.js';
import {
  button,
  click,
  FakeServer,
  installDialog,
  openSwitcher,
  selectScene,
  settle,
  type,
} from '../ui/testing/fakeServer.js';
import { render, type Rendered } from '../ui/testing/render.js';
import { fogOver, hiddenInside } from './regions/RegionList.js';
import { Workspace } from './Workspace.js';

// Fog regions in the DM view (TBL-03, specs/04-live-sync.md §2, §13, specs/08-ux-journeys.md §11, Q-099),
// against a scripted server: the fog tool draws a region, which is named and listed with its state and the
// tokens it hides; Reveal and Fog, rename and delete, live as region commands that undo takes back, in
// preparation over REST.

let server: FakeServer;
let rendered: Rendered | undefined;
let tavern: Scene;
let cellar: Scene;
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
  bandit = server.addAsset({ name: 'Bandit', category: 'monster' });
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
const press = (target: EventTarget, key: string) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
const regionRow = (view: HTMLElement, name: string) =>
  [...view.querySelectorAll<HTMLElement>('.eg-region-row')].find(
    (row) => row.querySelector('.eg-token-row__name')?.textContent === name,
  );
const statusOfToken = (view: HTMLElement, label: string) =>
  [...view.querySelectorAll('.eg-token-row')]
    .find((row) => row.querySelector('.eg-token-row__name')?.textContent === label)!
    .querySelector('.eg-token-row__status')!.textContent;
const status = (view: HTMLElement) => view.querySelector('[role="status"].eg-scene__progress')?.textContent;

/** Draws a triangle by the keys: a corner at the centre, then two more after panning, the last twice. */
async function drawByKeys(view: HTMLElement) {
  press(document.body, 'f');
  await settle();
  const map = canvas(view);
  press(map, 'Enter');
  for (let i = 0; i < 4; i++) press(map, 'ArrowRight');
  press(map, 'Enter');
  for (let i = 0; i < 4; i++) press(map, 'ArrowDown');
  press(map, 'Enter');
  press(map, 'Enter');
  await settle();
}

const BACK_ROOM = { kind: 'rect', x: 4, y: 0, width: 4, height: 4 } as const;

describe('the fog tool and the region list on the live scene', () => {
  it('draws a region with the keys, names it, and sends region.add; the list shows it fogged', async () => {
    server.liveSceneId = tavern.id;
    const view = await open();
    expect(button(view, t('canvas.toolFog'))!.getAttribute('aria-disabled')).toBeNull();
    await drawByKeys(view);
    const dialog = document.querySelector('dialog[open]')!;
    expect(dialog.textContent).toContain(t('fog.newHeading'));
    expect(dialog.querySelector('input')!.value).toBe(t('fog.defaultName', { count: 1 }));
    await click(button(dialog, t('fog.newSave')));
    const sent = commands().at(-1)!;
    expect(sent).toMatchObject({ type: 'region.add', payload: { scene_id: tavern.id, name: 'Region 1' } });
    const shape = (sent.payload as { shape: { kind: string; points: { x: number; y: number }[] } }).shape;
    expect(shape.kind).toBe('polygon');
    expect(shape.points).toHaveLength(3);
    for (const point of shape.points) expect(Number.isInteger(point.x) && Number.isInteger(point.y)).toBe(true);
    expect(regionRow(view, 'Region 1')).toBeDefined();
    expect(regionRow(view, 'Region 1')!.dataset.hidden).toBe('true');
    expect(status(view)).toBe(t('fog.drawn', { name: 'Region 1' }));
    expect(JSON.parse(canvas(view).dataset.fog!)).toEqual([
      expect.objectContaining({ name: 'Region 1', hidden: true, shape }),
    ]);
  });

  it('reveals and fogs a region from its row, counts the tokens it hides, and undo takes the reveal back', async () => {
    server.liveSceneId = tavern.id;
    server.addRegion(tavern.id, { name: 'Back room', shape: BACK_ROOM });
    const view = await open();
    // The bandit stands in the back room: players see neither it nor, while fogged, anything under it.
    expect(regionRow(view, 'Back room')!.querySelector('.eg-token-row__status')!.textContent).toBe(
      t('fog.statusFogged.one', { count: 1 }),
    );
    expect(statusOfToken(view, 'Bandit')).toBe(
      t('sceneTokens.inFog', { status: t('sceneTokens.hidden'), name: 'Back room' }),
    );
    expect(statusOfToken(view, 'Hero')).toBe(t('asset.category.pc'));
    await click(button(view, t('fog.revealOf', { name: 'Back room' })));
    expect(commands().at(-1)).toMatchObject({ type: 'region.setHidden', payload: { hidden: false } });
    expect(regionRow(view, 'Back room')!.dataset.hidden).toBeUndefined();
    // Revealed, the bandit is still hidden by its own flag.
    expect(regionRow(view, 'Back room')!.querySelector('.eg-token-row__status')!.textContent).toBe(
      t('fog.statusRevealed.one', { count: 1 }),
    );
    expect(status(view)).toBe(t('fog.revealed', { name: 'Back room' }));
    await click(button(view, t('canvas.undo')));
    expect(commands().at(-1)).toEqual({ type: 'undo', payload: {} });
    expect(regionRow(view, 'Back room')!.dataset.hidden).toBe('true');
  });

  it('renames and deletes a region from its menu, the deletion asked first', async () => {
    server.liveSceneId = tavern.id;
    const region = server.addRegion(tavern.id, { name: 'Back room', shape: BACK_ROOM });
    const view = await open();
    const menu = async (item: string) => {
      await click(button(view, t('fog.moreOf', { name: region.name })));
      const entry = [...view.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
        (each) => each.textContent === item,
      )!;
      await click(entry);
    };
    await menu(t('fog.rename'));
    const dialog = document.querySelector('dialog[open]')!;
    const input = dialog.querySelector('input')!;
    await type(input, 'Study');
    await click(button(dialog, t('fog.renameSave')));
    expect(commands().at(-1)).toEqual({ type: 'region.rename', payload: { region_id: region.id, name: 'Study' } });
    expect(regionRow(view, 'Study')).toBeDefined();
    region.name = 'Study';
    await menu(t('fog.delete'));
    expect(document.querySelector('dialog[open]')!.textContent).toContain(t('fog.deleteBodyFogged'));
    await click(button(document.querySelector('dialog[open]') as HTMLElement, t('fog.deleteConfirm')));
    expect(commands().at(-1)).toEqual({ type: 'region.delete', payload: { region_id: region.id } });
    expect(regionRow(view, 'Study')).toBeUndefined();
    expect(server.regions).toEqual([]);
  });

  it('turns the fog tool on from the rail and the list’s +, and leaves it for another tool', async () => {
    server.liveSceneId = tavern.id;
    const view = await open();
    const tool = button(view, t('canvas.toolFog'))!;
    await click(tool);
    expect(canvas(view).dataset.fogTool).toBe('on');
    expect(tool.getAttribute('aria-pressed')).toBe('true');
    press(document.body, 'm');
    await settle();
    expect(canvas(view).dataset.fogTool).toBe('off');
    expect(canvas(view).dataset.rulerTool).toBe('on');
    await click(button(view, t('fog.draw')));
    expect(canvas(view).dataset.fogTool).toBe('on');
    expect(canvas(view).dataset.rulerTool).toBe('off');
    press(document.body, 'v');
    await settle();
    expect(canvas(view).dataset.fogTool).toBe('off');
  });
});

describe('fog regions in preparation', () => {
  it('draws, reveals and deletes a region over REST on a scene that is not live, reading the tokens again after each', async () => {
    server.liveSceneId = cellar.id;
    const view = await open();
    await selectScene(view, 'Tavern');
    const tokenReads = () =>
      server.calls.filter((call) => call.method === 'GET' && call.path.endsWith('/tokens')).length;
    const before = tokenReads();
    await drawByKeys(view);
    await click(button(document.querySelector('dialog[open]') as HTMLElement, t('fog.newSave')));
    expect(server.writes().at(-1)).toBe(`POST /api/scenes/${tavern.id}/regions`);
    expect(server.regions).toHaveLength(1);
    expect(tokenReads()).toBeGreaterThan(before);
    await click(button(view, t('fog.revealOf', { name: 'Region 1' })));
    expect(server.writes().at(-1)).toBe(`PATCH /api/regions/${server.regions[0]!.id}`);
    expect(server.regions[0]!.hidden).toBe(false);
    expect(commands()).toEqual([]);
  });

  it('says why the server refused a write, and keeps the region as it was', async () => {
    const view = await open();
    await openSwitcher(view);
    await click(button(view, 'Campaine Test'));
    await click(button(view, t('tree.openOf', { name: 'Session 1' })));
    await selectScene(view, 'Tavern');
    const region = server.addRegion(tavern.id, { name: 'Back room', shape: BACK_ROOM });
    // Read again, as a reselection would.
    await selectScene(view, 'Cellar');
    await selectScene(view, 'Tavern');
    server.regions = [];
    await click(button(view, t('fog.revealOf', { name: region.name })));
    expect(view.textContent).toContain(t('fog.failed', { reason: '' }).trim());
  });
});

describe('what a region hides (specs/04-live-sync.md §4)', () => {
  const token = (fields: Partial<SceneToken>): SceneToken =>
    ({ id: 't', x: 0, y: 0, hidden: false, asset: { size: 'medium' }, ...fields }) as SceneToken;
  const region = (hidden: boolean): Region => ({
    id: 'r',
    scene_id: 's',
    name: 'Back room',
    order: 1,
    shape: BACK_ROOM,
    hidden,
  });

  it('counts the tokens whose centre it covers: all while fogged, the hidden ones once revealed', () => {
    const tokens = [
      token({ id: 'in', x: 5, y: 1 }),
      token({ id: 'in-hidden', x: 6, y: 2, hidden: true }),
      // Its footprint overlaps the region, its centre (8.5, 1.5) does not lie in it.
      token({ id: 'edge', x: 8, y: 1 }),
      token({ id: 'out', x: 1, y: 1, hidden: true }),
    ];
    expect(hiddenInside(region(true), tokens)).toBe(2);
    expect(hiddenInside(region(false), tokens)).toBe(1);
    expect(fogOver(tokens[0]!, [region(true)])?.name).toBe('Back room');
    expect(fogOver(tokens[0]!, [region(false)])).toBeUndefined();
    expect(fogOver(tokens[2]!, [region(true)])).toBeUndefined();
  });
});
