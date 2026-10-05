// @vitest-environment jsdom
import { act, createElement } from 'react';
import Konva from 'konva';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LibraryAsset, Scene, SceneToken } from '@emberglass/shared';
import { t } from '../../ui/messages.js';
import { installCanvas2d, installImageLoading, installResizeObserver } from '../../ui/testing/canvas2d.js';
import {
  button,
  click,
  FakeServer,
  installDialog,
  openSwitcher,
  popover,
  selectTokenRow,
  settle,
  type,
} from '../../ui/testing/fakeServer.js';
import { render, type Rendered } from '../../ui/testing/render.js';
import { Workspace } from '../Workspace.js';
import { clearDrafts, NOTES_SAVE_DELAY_MS } from './NotesEditor.js';

// DM notes in the DM view (DMT-04, specs/08-ux-journeys.md §13, specs/04-live-sync.md §16, Q-114), against the
// scripted server: the Notes tab and N, a token's notes in its popover with its asset's read-only beside them, the
// marks on "In this scene" rows, on the scene list and on the map, the turn's row of the initiative order opening
// them, saving over REST on a prepared and on the live scene, and another window's `notes.updated`.

let server: FakeServer;
let rendered: Rendered | undefined;
let crypt: Scene;
let bridge: Scene;
let banditAsset: LibraryAsset;
let bandit: SceneToken;
let hero: SceneToken;

beforeEach(() => {
  installCanvas2d();
  installResizeObserver({ width: 800, height: 600 });
  installImageLoading();
  installDialog();
  clearDrafts();
  server = new FakeServer().install();
  const session = server.addSession(server.addCampaign('Lost Mine').id, 'One');
  crypt = server.addScene(session.id, 'Crypt');
  bridge = server.addScene(session.id, 'Bridge');
  const map = server.addImage({ width: 4000, height: 3000, variants: { display: { width: 2000, height: 1500 } } });
  for (const scene of server.scenes) {
    scene.map_image_id = map.id;
    scene.grid = { ...scene.grid, size: 100, offset_x: 0, offset_y: 0, columns: 40, rows: 30 };
  }
  banditAsset = server.addAsset({
    name: 'Bandit',
    category: 'monster',
    default_hidden: false,
    notes: 'Bandits flee when the leader falls.\nThey fight dirty.',
  });
  bandit = server.addToken(crypt.id, banditAsset, { x: 4, y: 4 });
  hero = server.addToken(crypt.id, server.addAsset({ name: 'Wren', category: 'pc', default_hidden: false }), {
    x: 1,
    y: 1,
  });
});

afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  server.uninstall();
});

async function open(scene: Scene = crypt): Promise<HTMLElement> {
  rendered = render(createElement(Workspace, { mainId: 'main' }));
  await settle();
  await server.openSockets();
  const view = rendered.container;
  await openSwitcher(view);
  await click(button(view, 'Lost Mine'));
  await click(button(view, t('tree.openOf', { name: 'One' })));
  await click(view.querySelector(`[data-scene="${scene.id}"] .eg-scenes__select`));
  await settle();
  return view;
}

const tab = (view: HTMLElement, label: string) =>
  [...view.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((each) => each.textContent?.startsWith(label));
const sceneField = (view: HTMLElement, name = 'Crypt') =>
  view.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${t('notes.sceneLabel', { name })}"]`);
const tokenField = (view: HTMLElement, label: string) =>
  view.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${t('notes.tokenLabel', { label })}"]`);
const puts = (path: string) => server.calls.filter((call) => call.method === 'PUT' && call.path === path);
const press = (key: string, target: EventTarget = document.body) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
/** Lets the save that typing schedules go out and be answered. */
async function saved() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, NOTES_SAVE_DELAY_MS + 50));
  });
  await settle();
}
const stage = () => Konva.stages.filter((each) => each.findOne('.tokens')).at(-1)!;
/** Another DM window's write, as the server would make it: REST, and `notes.updated` on the live scene. */
const elsewhere = (path: string, notes: string) => server.reply({ method: 'PUT', path, body: { notes } });

describe('the scene’s notes (specs/08-ux-journeys.md §13)', () => {
  it('sits in a Notes tab beside In this scene and Library, saved as typed, with no Save button', async () => {
    const view = await open();
    const tabs = [...view.querySelectorAll('[role="tab"]')].map((each) => each.textContent);
    expect(tabs).toEqual([t('side.scene'), t('side.initiative'), t('side.notes'), t('side.library')]);
    await click(tab(view, t('side.notes')));
    const field = sceneField(view)!;
    expect(field.value).toBe('');
    await type(field, 'Trap on the stairs.\nThe priest lies.');
    await saved();
    expect(puts(`/api/scenes/${crypt.id}/notes`).map((call) => call.body)).toEqual([
      { notes: 'Trap on the stairs.\nThe priest lies.' },
    ]);
    expect(crypt.notes).toBe('Trap on the stairs.\nThe priest lies.');
    expect(view.textContent).toContain(t('notes.saved'));
    expect(view.querySelector('.eg-scene-notes button')).toBeNull();
    // The scene list marks a scene with notes, their first lines on hover.
    const mark = view.querySelector<HTMLElement>(`[data-scene="${crypt.id}"] [data-note-mark]`)!;
    expect(mark.title).toBe('Trap on the stairs.\nThe priest lies.');
    expect(view.querySelector(`[data-scene="${bridge.id}"] [data-note-mark]`)).toBeNull();
  });

  it('opens with N, the cursor in the field, from anywhere but a text field, and N is on the shortcut bar', async () => {
    const view = await open();
    expect(view.querySelector('.eg-shortcuts')!.textContent).toContain(`${t('shortcuts.keyN')}${t('shortcuts.notes')}`);
    press('n');
    expect(tab(view, t('side.notes'))!.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(sceneField(view));
    // Typing an n in the notes types it.
    await click(tab(view, t('side.scene')));
    const search = document.createElement('input');
    view.append(search);
    press('n', search);
    expect(tab(view, t('side.scene'))!.getAttribute('aria-selected')).toBe('true');
    search.remove();
    // Shift+N stays Go live next (UIX-01): it does not open the notes.
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'N', shiftKey: true, bubbles: true }));
    });
    expect(tab(view, t('side.scene'))!.getAttribute('aria-selected')).toBe('true');
  });

  it('shows another window’s change on the live scene, unless the field is focused, then says so instead', async () => {
    server.liveSceneId = crypt.id;
    const view = await open();
    await click(tab(view, t('side.notes')));
    await act(() => elsewhere(`/api/scenes/${crypt.id}/notes`, 'From the laptop'));
    await settle();
    expect(sceneField(view)!.value).toBe('From the laptop');
    // Saved on the live scene too, over REST; no snapshot.
    const field = sceneField(view)!;
    act(() => field.focus());
    await act(() => elsewhere(`/api/scenes/${crypt.id}/notes`, 'From the tablet'));
    await settle();
    expect(field.value).toBe('From the laptop');
    expect(view.textContent).toContain(t('notes.changedElsewhere'));
    act(() => field.blur());
    expect(field.value).toBe('From the tablet');
    expect(view.textContent).not.toContain(t('notes.changedElsewhere'));
  });

  it('saves the live scene’s notes over REST, the TV untouched', async () => {
    server.liveSceneId = crypt.id;
    const view = await open();
    await click(tab(view, t('side.notes')));
    await type(sceneField(view), 'Round 3: reinforcements.');
    await saved();
    expect(puts(`/api/scenes/${crypt.id}/notes`)).toHaveLength(1);
    expect(server.sockets.flatMap((socket) => socket.commands())).toEqual([]);
    expect(sceneField(view)!.value).toBe('Round 3: reinforcements.');
  });
});

describe('a token’s notes (specs/03-domain-model.md §10)', () => {
  it('sit in its popover with its asset’s under them, read-only and named as the library’s, saved as typed', async () => {
    const view = await open();
    await selectTokenRow(view, 'Bandit');
    const box = popover(view)!;
    const field = tokenField(box, 'Bandit')!;
    expect(field.value).toBe('');
    const from = box.querySelector('.eg-notes__readonly')!;
    expect(from.textContent).toContain(t('notes.fromAsset', { name: 'Bandit' }));
    expect(from.querySelector('p')!.textContent).toBe('Bandits flee when the leader falls.\nThey fight dirty.');
    expect(from.querySelector('textarea, input')).toBeNull();
    // The scene keeps its one status line: the notes say Saving… and Saved in a live region of their own.
    expect(view.querySelectorAll('main [role="status"]')).toHaveLength(1);

    await type(field, 'Leader: flees at half HP');
    await saved();
    expect(puts(`/api/tokens/${bandit.id}/notes`).map((call) => call.body)).toEqual([
      { notes: 'Leader: flees at half HP' },
    ]);
    // The row marks it, its own notes first in the hover text.
    const mark = view.querySelector<HTMLElement>(`[data-token="${bandit.id}"] [data-note-mark]`)!;
    expect(mark.title.split('\n')[0]).toBe('Leader: flees at half HP');
    expect(mark.title).toContain(t('notes.fromAsset', { name: 'Bandit' }));
    // A token without notes of its own or from its asset has no mark.
    expect(view.querySelector(`[data-token="${hero.id}"] [data-note-mark]`)).toBeNull();
  });

  it('marks a token with notes on the DM’s map, its first lines the hover text', async () => {
    server.sceneTokens.find((each) => each.id === hero.id)!.notes = 'Owes the bandits money';
    await open();
    const badges = stage()
      .find('.token-note-marker')
      .map((badge) => badge.getParent()!.id());
    expect(badges.sort()).toEqual([`token-${bandit.id}`, `token-${hero.id}`].sort());
    const badge = stage().findOne<Konva.Group>(`#token-${hero.id}`)!.findOne('.token-note-marker')!;
    act(() => {
      badge.fire('mouseenter', { evt: new MouseEvent('mouseenter') });
    });
    expect(stage().container().title).toBe('Owes the bandits money');
    act(() => {
      badge.fire('mouseleave', { evt: new MouseEvent('mouseleave') });
    });
    expect(stage().container().hasAttribute('title')).toBe(false);
  });

  it('opens from the turn’s row of the initiative order when its token has notes', async () => {
    server.liveSceneId = crypt.id;
    server.sceneTokens.find((each) => each.id === bandit.id)!.notes = 'Leader: flees at half HP';
    const view = await open();
    await click(tab(view, t('side.initiative')));
    await click(button(view, t('initiative.start')));
    // Pass turns until the bandit's: only the turn's row offers its notes.
    for (let turn = 0; turn < 3; turn++) {
      const current = view.querySelector<HTMLElement>('.eg-initiative__row--current')!;
      if (current.textContent?.includes('Bandit')) break;
      expect(current.querySelector('.eg-note-button')).toBeNull();
      await click(button(view, t('initiative.nextTurn')));
    }
    const current = view.querySelector<HTMLElement>('.eg-initiative__row--current')!;
    expect(current.textContent).toContain('Bandit');
    const notesButton = current.querySelector<HTMLButtonElement>('.eg-note-button')!;
    expect(notesButton.getAttribute('aria-label')).toBe(t('notes.openOf', { name: 'Bandit' }));
    await click(notesButton);
    await settle();
    const field = tokenField(popover(view)!, 'Bandit')!;
    expect(field.value).toBe('Leader: flees at half HP');
    expect(document.activeElement).toBe(field);
  });

  it('gives focus once: not to another token’s notes, nor to the same token’s opened again', async () => {
    server.liveSceneId = crypt.id;
    server.sceneTokens.find((each) => each.id === bandit.id)!.notes = 'Leader: flees at half HP';
    const view = await open();
    await click(tab(view, t('side.initiative')));
    await click(button(view, t('initiative.start')));
    while (!view.querySelector('.eg-initiative__row--current')!.textContent?.includes('Bandit')) {
      await click(button(view, t('initiative.nextTurn')));
    }
    await click(view.querySelector('.eg-initiative__row--current .eg-note-button'));
    await settle();
    expect(document.activeElement).toBe(tokenField(view, 'Bandit'));
    await click(tab(view, t('side.scene')));
    await selectTokenRow(view, 'Wren');
    expect(tokenField(view, 'Wren')).not.toBeNull();
    expect(document.activeElement).not.toBe(tokenField(view, 'Wren'));
    await selectTokenRow(view, 'Bandit');
    expect(document.activeElement).not.toBe(tokenField(view, 'Bandit'));
  });

  it('shows another window’s change of a live token’s notes in its popover', async () => {
    server.liveSceneId = crypt.id;
    const view = await open();
    await selectTokenRow(view, 'Bandit');
    await act(() => elsewhere(`/api/tokens/${bandit.id}/notes`, 'Seen by the tablet'));
    await settle();
    expect(tokenField(popover(view)!, 'Bandit')!.value).toBe('Seen by the tablet');
  });

  it('shows notes as text: an HTML string reads as written', async () => {
    const token = server.sceneTokens.find((each) => each.id === bandit.id)!;
    token.notes = '<b>bold</b><img src=x onerror="alert(1)">';
    token.asset.notes = '<script>alert(2)</script>';
    const view = await open();
    await selectTokenRow(view, 'Bandit');
    const box = popover(view)!;
    expect(tokenField(box, 'Bandit')!.value).toBe('<b>bold</b><img src=x onerror="alert(1)">');
    expect(box.querySelector('.eg-notes__readonly p')!.textContent).toBe('<script>alert(2)</script>');
    expect(view.querySelector('b, img[src="x"], .eg-notes script')).toBeNull();
  });
});
