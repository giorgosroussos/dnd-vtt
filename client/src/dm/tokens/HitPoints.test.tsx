// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LibraryAsset, Scene, SceneToken } from '@emberglass/shared';
import { t } from '../../ui/messages.js';
import { installCanvas2d, installImageLoading, installResizeObserver } from '../../ui/testing/canvas2d.js';
import {
  button,
  click,
  FakeServer,
  installDialog,
  openLibrary,
  openSwitcher,
  popover,
  selectTokenRow,
  settle,
  submit,
  type,
} from '../../ui/testing/fakeServer.js';
import { render, type Rendered } from '../../ui/testing/render.js';
import { Workspace } from '../Workspace.js';

// Hit points and armour class in the DM view (DMT-01, specs/08-ux-journeys.md §13, specs/04-live-sync.md §2, §15,
// D-182), against a scripted server: the popover's hit points, bar, armour class and the one field that takes -7, +5
// or a bare number, reached with D; the maximum, temporary hit points and armour class edited in place; on the live
// scene `token.setStats` and `token.applyHp`, in preparation the same fields over REST; the compact hit points in
// the "In this scene" rows and the Initiative rows.

let server: FakeServer;
let rendered: Rendered | undefined;
let tavern: Scene;
let cellar: Scene;
let ogreAsset: LibraryAsset;
let ogre: SceneToken;

beforeEach(() => {
  installCanvas2d();
  installResizeObserver({ width: 800, height: 600 });
  installImageLoading();
  installDialog();
  server = new FakeServer().install();
  const session = server.addSession(server.addCampaign('Campaign').id, 'Session 1');
  tavern = server.addScene(session.id, 'Tavern');
  cellar = server.addScene(session.id, 'Cellar');
  ogreAsset = server.addAsset({ name: 'Ogre', category: 'monster', default_hidden: false, hp_max: 27, ac: 11 });
  ogre = server.addToken(tavern.id, ogreAsset, { x: 1, y: 1 });
  server.addToken(tavern.id, server.addAsset({ name: 'Hero', category: 'pc', default_hidden: false }), { x: 3, y: 1 });
  server.addToken(cellar.id, ogreAsset, { x: 2, y: 2 });
});

afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  server.uninstall();
});

async function open(scene: Scene = tavern): Promise<HTMLElement> {
  rendered = render(createElement(Workspace, { mainId: 'main' }));
  await settle();
  await server.openSockets();
  await settle();
  const view = rendered.container;
  await openSwitcher(view);
  await click(button(view, 'Campaign'));
  await click(button(view, t('tree.openOf', { name: 'Session 1' })));
  await click(view.querySelector(`[data-scene="${scene.id}"] .eg-scenes__select`));
  return view;
}

const commands = () => server.sockets.flatMap((socket) => socket.commands());
const hpField = (view: HTMLElement, label: string) =>
  popover(view)!.querySelector<HTMLInputElement>(`input[aria-label="${t('hp.entry', { label })}"]`)!;
const hpShown = (view: HTMLElement) => popover(view)!.querySelector('[data-hp]')!.textContent;
const acShown = (view: HTMLElement) => popover(view)!.querySelector('[data-ac]')!.textContent;
const markers = (token: SceneToken) => token.markers.map((marker) => marker.id);
const stored = (id: string) => server.sceneTokens.find((each) => each.id === id)!;
const rowStats = (view: HTMLElement, label: string) =>
  [...view.querySelectorAll('.eg-token-row')]
    .find((row) => row.querySelector('.eg-token-row__name')?.textContent === label)!
    .querySelector('.eg-stats')?.textContent;

async function enter(view: HTMLElement, label: string, value: string) {
  await type(hpField(view, label), value);
  await submit(hpField(view, label).form);
}

describe('the popover’s hit points on the live scene (specs/08-ux-journeys.md §13)', () => {
  it('shows current / maximum, the bar and the shield, and applies -7 and +5 as token.applyHp', async () => {
    server.liveSceneId = tavern.id;
    const view = await open();
    await selectTokenRow(view, 'Ogre');
    expect(hpShown(view)).toBe(t('hp.value', { current: 27, max: 27 }));
    expect(acShown(view)).toBe('11');
    expect(popover(view)!.querySelector('.eg-hp__fill')!.getAttribute('style')).toContain('width: 100%');
    await enter(view, 'Ogre', '-7');
    expect(commands().at(-1)).toEqual({ type: 'token.applyHp', payload: { token_id: ogre.id, delta: -7 } });
    expect(hpShown(view)).toBe(t('hp.value', { current: 20, max: 27 }));
    expect(hpField(view, 'Ogre').value).toBe('');
    await enter(view, 'Ogre', '+5');
    expect(commands().at(-1)).toEqual({ type: 'token.applyHp', payload: { token_id: ogre.id, delta: 5 } });
    expect(hpShown(view)).toBe(t('hp.value', { current: 25, max: 27 }));
  });

  it('sets the current hit points from a bare number, reaching Bloodied and Dead as the server sets them', async () => {
    server.liveSceneId = tavern.id;
    const view = await open();
    await selectTokenRow(view, 'Ogre');
    await enter(view, 'Ogre', '13');
    expect(commands().at(-1)).toEqual({ type: 'token.setStats', payload: { token_id: ogre.id, hp_current: 13 } });
    expect(markers(stored(ogre.id))).toEqual(['bloodied']);
    expect(popover(view)!.querySelector('.eg-hp__fill')!.hasAttribute('data-low')).toBe(true);
    await enter(view, 'Ogre', '-40');
    expect(markers(stored(ogre.id))).toEqual(['bloodied', 'dead']);
    expect(rowStats(view, 'Ogre')).toContain('0/27');
    // Healing from 0 removes neither Dead nor, while at half or less, Bloodied (Q-116).
    await enter(view, 'Ogre', '+20');
    expect(markers(stored(ogre.id))).toEqual(['dead']);
  });

  it('refuses what is not -7, +5 or a number, sending nothing', async () => {
    server.liveSceneId = tavern.id;
    const view = await open();
    await selectTokenRow(view, 'Ogre');
    const before = commands().length;
    for (const bad of ['ten', '+0', '1.5', '']) {
      await enter(view, 'Ogre', bad);
      expect(hpField(view, 'Ogre').getAttribute('aria-invalid'), bad).toBe('true');
    }
    expect(popover(view)!.textContent).toContain(t('hp.entryInvalid'));
    expect(commands()).toHaveLength(before);
  });

  it('says so, sending nothing, when damage meets a token without hit points', async () => {
    server.liveSceneId = tavern.id;
    const view = await open();
    await selectTokenRow(view, 'Hero');
    expect(hpShown(view)).toBe(t('hp.none'));
    const before = commands().length;
    await enter(view, 'Hero', '-3');
    expect(commands()).toHaveLength(before);
    expect([...view.querySelectorAll('[role="status"]')].map((each) => each.textContent)).toContain(
      t('hp.noCurrent', { label: 'Hero' }),
    );
  });

  it('focuses the field with D while a token is selected, opening its popover', async () => {
    server.liveSceneId = tavern.id;
    const view = await open();
    await selectTokenRow(view, 'Ogre');
    act(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true, cancelable: true }));
    });
    await settle();
    expect(document.activeElement).toBe(hpField(view, 'Ogre'));
    expect(hpField(view, 'Ogre').getAttribute('aria-keyshortcuts')).toBe('D');
  });

  it('edits the maximum, temporary hit points and armour class in place as token.setStats, empty clearing one', async () => {
    server.liveSceneId = tavern.id;
    const view = await open();
    await selectTokenRow(view, 'Ogre');
    await click(button(popover(view)!, t('hp.editOf', { label: 'Ogre' })));
    const fields = [...popover(view)!.querySelectorAll<HTMLInputElement>('.eg-hp__edit input')];
    expect(fields.map((field) => field.value)).toEqual(['27', '', '11']);
    expect(document.activeElement).toBe(fields[0]);
    await type(fields[1], '5');
    await type(fields[2], '');
    await submit(popover(view)!.querySelector('.eg-hp__edit'));
    expect(commands().at(-1)).toEqual({ type: 'token.setStats', payload: { token_id: ogre.id, hp_temp: 5, ac: null } });
    expect(popover(view)!.querySelector('.eg-hp__temp')!.textContent).toBe(t('hp.temp', { temp: 5 }));
    expect(acShown(view)).toBe(t('hp.unset'));
    // Out of bounds: refused in place.
    await click(button(popover(view)!, t('hp.editOf', { label: 'Ogre' })));
    await type(popover(view)!.querySelector('.eg-hp__edit input'), '0');
    const before = commands().length;
    await submit(popover(view)!.querySelector('.eg-hp__edit'));
    expect(popover(view)!.textContent).toContain(t('hp.fieldInvalid'));
    expect(commands()).toHaveLength(before);
  });

  it('undoes the hit points with the markers they set', async () => {
    server.liveSceneId = tavern.id;
    const view = await open();
    await selectTokenRow(view, 'Ogre');
    await enter(view, 'Ogre', '-27');
    expect(markers(stored(ogre.id))).toEqual(['bloodied', 'dead']);
    await click(button(view, t('canvas.undo')));
    expect(stored(ogre.id)).toMatchObject({ hp_current: 27 });
    expect(markers(stored(ogre.id))).toEqual([]);
  });
});

describe('preparation, lists and the asset editor (specs/08-ux-journeys.md §13)', () => {
  it('changes a prepared token’s hit points over REST', async () => {
    const view = await open(cellar);
    await selectTokenRow(view, 'Ogre');
    const cellarOgre = server.sceneTokens.find((each) => each.scene_id === cellar.id)!;
    await enter(view, 'Ogre', '-20');
    const patch = server.calls.filter((call) => call.method === 'PATCH').at(-1)!;
    expect(patch.path).toBe(`/api/tokens/${cellarOgre.id}`);
    expect(patch.body).toEqual({ hp_current: 7, hp_temp: null });
    expect(markers(stored(cellarOgre.id))).toEqual(['bloodied']);
    expect(hpShown(view)).toBe(t('hp.value', { current: 7, max: 27 }));
  });

  it('shows compact hit points and armour class in the "In this scene" rows, and nothing for a token without', async () => {
    server.liveSceneId = tavern.id;
    const view = await open();
    expect(rowStats(view, 'Ogre')).toBe(`${t('hp.compact', { hp: '27/27' })}27/27${t('hp.compactAc', { ac: 11 })}11`);
    expect(rowStats(view, 'Hero')).toBeUndefined();
  });

  it('shows compact hit points beside each Initiative row', async () => {
    server.liveSceneId = tavern.id;
    Object.assign(
      server.sceneTokens.find((each) => each.label === 'Hero')!,
      { hp_current: 9, hp_max: 12 },
    );
    const view = await open();
    await click(view.querySelector('[role="tab"]:nth-child(2)'));
    await click(button(view, t('initiative.start')));
    const hero = [...view.querySelectorAll('.eg-initiative__row')].find((row) => row.textContent.includes('Hero'))!;
    expect(hero.querySelector('.eg-stats')!.textContent).toContain('9/12');
    // A monster's row shows its own (DMT-02).
    const monster = view.querySelector('.eg-initiative__row[data-kind="monster"]')!;
    expect(monster.querySelector('.eg-stats')!.textContent).toContain('27/27');
  });

  it('saves an asset’s default maximum and armour class, refusing values out of bounds', async () => {
    const view = await open();
    await openLibrary(view);
    await click(button(view, t('library.editOf', { name: 'Ogre' })));
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')!;
    const field = (label: string) =>
      [...dialog.querySelectorAll<HTMLLabelElement>('label')].find((each) => each.textContent === label)!
        .control as HTMLInputElement;
    expect(field(t('assets.hpMax')).value).toBe('27');
    expect(field(t('assets.ac')).value).toBe('11');
    await type(field(t('assets.hpMax')), '0');
    await submit(dialog.querySelector('form'));
    expect(dialog.textContent).toContain(t('assets.statsInvalid'));
    await type(field(t('assets.hpMax')), '30');
    await type(field(t('assets.ac')), '');
    await submit(dialog.querySelector('form'));
    const patch = server.calls.filter((call) => call.method === 'PATCH').at(-1)!;
    expect(patch.body).toMatchObject({ hp_max: 30, ac: null });
    expect(server.assets.find((each) => each.id === ogreAsset.id)).toMatchObject({ hp_max: 30, ac: null });
  });
});
