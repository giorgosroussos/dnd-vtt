// @vitest-environment jsdom
import { act, createElement } from 'react';
import Konva from 'konva';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryAsset, MapNote, Scene } from '@emberglass/shared';
import { PREVIEW_DELAY_MS } from '../../canvas/hoverIntent.js';
import { MAP_NOTE_RADIUS_PX, noteDropPoint } from '../../canvas/MapNoteLayer.js';
import { t } from '../../ui/messages.js';
import { installCanvas2d, installImageLoading, installResizeObserver } from '../../ui/testing/canvas2d.js';
import {
  button,
  click,
  FakeServer,
  installDialog,
  openSwitcher,
  popover,
  settle,
  type,
} from '../../ui/testing/fakeServer.js';
import { render, type Rendered } from '../../ui/testing/render.js';
import { ScenePanel } from '../ScenePanel.js';
import { Workspace } from '../Workspace.js';
import { clearDrafts, unsavedDrafts } from './NotesEditor.js';

// Map notes in the DM view (UXR-08, specs/08-ux-journeys.md §14, specs/04-live-sync.md §16, Q-128), against the
// scripted server: drawn as icons of a constant size, a click opening the note's popover and a second click closing
// it, the text saved over REST, Delete asked first, O and a click placing one with the cursor in it, one left empty
// removed when it closes, the token's popover and a note's never open together, a drag moving it snapped, the whole
// text previewed when the mouse rests on it, and the live scene's kept current by `mapNotes.updated`. One removed for
// being empty is removed only if the server holds it empty too (`if_empty`); the keys never act on a token while a
// note is open or placed; focus goes back to the map; a deleted note's unsaved text is forgotten.

let server: FakeServer;
let rendered: Rendered | undefined;
let scene: Scene;
let goblin: LibraryAsset;

beforeEach(() => {
  installCanvas2d();
  installResizeObserver({ width: 800, height: 600 });
  installImageLoading();
  installDialog();
  clearDrafts();
  server = new FakeServer().install();
  const session = server.addSession(server.addCampaign('Lost Mine').id, 'One');
  scene = server.addScene(session.id, 'Cave');
  // A calibrated map: 100 original px squares from 30, 250, shown at half size, as Tokens.test's.
  const map = server.addImage({ width: 4000, height: 3000, variants: { display: { width: 2000, height: 1500 } } });
  server.scenes[0]!.map_image_id = map.id;
  server.scenes[0]!.grid = { ...server.scenes[0]!.grid, size: 100, offset_x: 30, offset_y: 250, columns: 40, rows: 30 };
  goblin = server.addAsset({ name: 'Goblin', category: 'monster', default_hidden: false });
});

afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  vi.useRealTimers();
  server.uninstall();
});

async function open(): Promise<HTMLElement> {
  rendered = render(createElement(ScenePanel, { sceneId: scene.id, name: scene.name, uploadLimit: 1 << 30 }));
  await settle();
  return rendered.container;
}

const stage = () => Konva.stages.filter((each) => each.findOne('.tokens')).at(-1)!;
const icon = (id: string) => stage().findOne<Konva.Group>(`#map-note-${id}`);
const notePopover = (view: HTMLElement) => view.querySelector<HTMLElement>('.eg-note-popover');
const notePreview = (view: HTMLElement) => view.querySelector<HTMLElement>('.eg-preview');
const field = (view: HTMLElement) => notePopover(view)!.querySelector('textarea')!;
const fire = (id: string, type: string, x = 200, y = 200, fields: { pointerType?: string; buttons?: number } = {}) =>
  act(() => {
    const evt = new MouseEvent(type, { clientX: x, clientY: y, buttons: fields.buttons ?? 0 });
    Object.defineProperty(evt, 'pointerType', { value: fields.pointerType ?? 'mouse' });
    icon(id)!.fire(type, { target: icon(id)!, evt }, true);
  });
const clickIcon = async (id: string) => {
  fire(id, 'pointerdown', 200, 200, { buttons: 1 });
  fire(id, 'pointerup');
  await settle();
};
/** A click on the map at grid position (gx, gy), through the fitted camera; with Alt held when `altKey`. */
async function clickMap(gx: number, gy: number, altKey = false) {
  const s = stage();
  const evt = new MouseEvent('click', {
    clientX: s.x() + (15 + gx * 50) * s.scaleX(),
    clientY: s.y() + (125 + gy * 50) * s.scaleY(),
    bubbles: true,
    altKey,
  });
  act(() => {
    s.setPointersPositions(evt);
    s.fire('click', { evt, target: s });
  });
  await settle();
}
const key = (letter: string) =>
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: letter, bubbles: true, cancelable: true }));
  });
const blur = (element: HTMLElement) =>
  act(() => {
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    element.blur();
  });
const writes = () => server.calls.filter((call) => call.method !== 'GET' && call.path.includes('map-notes'));
const reads = () => server.calls.filter((call) => call.method === 'GET' && call.path.includes('map-notes'));
const tokenWrites = () => server.calls.filter((call) => call.method !== 'GET' && call.path.startsWith('/api/tokens'));
const map = (view: HTMLElement) => view.querySelector<HTMLElement>('[role="application"]')!;
const mapKey = (view: HTMLElement, name: string) =>
  act(() => {
    map(view).dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  });
const escape = (element: HTMLElement) =>
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
async function clickToken(id: string) {
  const group = stage().findOne<Konva.Group>(`#token-${id}`)!;
  act(() => {
    group.fire(
      'pointerdown',
      { target: group, evt: new MouseEvent('pointerdown', { clientX: 50, clientY: 50 }) },
      true,
    );
    group.fire('pointerup', { target: group, evt: new MouseEvent('pointerup', { clientX: 50, clientY: 50 }) }, true);
  });
  await settle();
}
/** The whole DM view with the scene live, its live connection bringing the scene and its map notes. */
async function openLive(): Promise<HTMLElement> {
  server.liveSceneId = scene.id;
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

describe('map notes on the DM map (UXR-08)', () => {
  it('draws each note as an icon of a constant size at its point, and nothing for a scene without any', async () => {
    const note = server.addMapNote(scene.id, { x: 4.5, y: 2.5, notes: 'Pit trap.' });
    const view = await open();
    const drawn = icon(note.id)!;
    expect(drawn).toBeDefined();
    // At its point: the grid's origin, then 50 world px a square.
    expect([drawn.x(), drawn.y()]).toEqual([15 + 4.5 * 50, 125 + 2.5 * 50]);
    // The same size on screen at every zoom.
    expect(drawn.scaleX() * stage().scaleX()).toBeCloseTo(1);
    expect(MAP_NOTE_RADIUS_PX * 2).toBeLessThanOrEqual(16);
    // Only an icon: no text is drawn beside it.
    expect(drawn.find('Text')).toHaveLength(0);
    const boxes = JSON.parse(view.querySelector('[role="application"]')!.getAttribute('data-map-notes')!) as {
      id: string;
    }[];
    expect(boxes.map((box) => box.id)).toEqual([note.id]);
  });

  it('opens a note on a click, saves its text as typed, and closes it on a second click', async () => {
    const note = server.addMapNote(scene.id, { notes: 'Pit trap.' });
    const view = await open();
    await clickIcon(note.id);
    expect(notePopover(view)).not.toBeNull();
    expect(field(view).value).toBe('Pit trap.');
    expect(notePopover(view)!.textContent).toContain(t('mapNotes.onlyYou'));
    await type(field(view), 'Pit trap, DC 13.\nSpikes at the bottom.');
    blur(field(view));
    await settle();
    expect(server.mapNotes[0]!.notes).toBe('Pit trap, DC 13.\nSpikes at the bottom.');
    await clickIcon(note.id);
    expect(notePopover(view)).toBeNull();
    // A note with text is kept when it closes.
    expect(server.mapNotes).toHaveLength(1);
  });

  it('asks before deleting a note, and Keep keeps it', async () => {
    const note = server.addMapNote(scene.id, { notes: 'Secret door.' });
    const view = await open();
    await clickIcon(note.id);
    await click(button(notePopover(view)!, t('mapNotes.deleteNote')));
    expect(notePopover(view)!.textContent).toContain(t('mapNotes.confirmDelete'));
    await click(button(notePopover(view)!, t('mapNotes.keep')));
    expect(server.mapNotes).toHaveLength(1);
    await click(button(notePopover(view)!, t('mapNotes.deleteNote')));
    await click(button(notePopover(view)!, t('mapNotes.delete')));
    expect(server.mapNotes).toEqual([]);
    expect(notePopover(view)).toBeNull();
    expect(icon(note.id)).toBeUndefined();
  });

  it('places a note with O and a click at the square’s centre, its text focused; one left empty goes on closing', async () => {
    const view = await open();
    key('o');
    await settle();
    expect(view.textContent).toContain(t('mapNotes.placing'));
    expect(button(view, t('canvas.toolAddNote'))!.getAttribute('aria-pressed')).toBe('true');
    await clickMap(5.3, 7.8);
    expect(server.mapNotes).toHaveLength(1);
    expect(server.mapNotes[0]).toMatchObject({ scene_id: scene.id, x: 5.5, y: 7.5, notes: '' });
    expect(notePopover(view)).not.toBeNull();
    expect(document.activeElement).toBe(field(view));
    // Closed with nothing written: nothing is left behind.
    act(() => {
      notePopover(view)!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    await settle();
    expect(notePopover(view)).toBeNull();
    expect(server.mapNotes).toEqual([]);
  });

  it('keeps a new note whose text is still waiting to be saved when its popover closes', async () => {
    const view = await open();
    key('o');
    await settle();
    await clickMap(2, 2);
    await type(field(view), 'Ambush here.');
    // Closed by a click on the empty map before the save's delay.
    await clickMap(10, 10);
    expect(notePopover(view)).toBeNull();
    await settle();
    expect(server.mapNotes).toEqual([expect.objectContaining({ notes: 'Ambush here.' })]);
    expect(writes().filter((call) => call.method === 'DELETE')).toEqual([]);
  });

  it('never opens a token’s popover and a note’s together', async () => {
    const note = server.addMapNote(scene.id, { x: 8.5, y: 8.5, notes: 'Altar.' });
    const token = server.addToken(scene.id, goblin, { x: 1, y: 1 });
    const view = await open();
    await clickIcon(note.id);
    const group = stage().findOne<Konva.Group>(`#token-${token.id}`)!;
    act(() => {
      group.fire(
        'pointerdown',
        { target: group, evt: new MouseEvent('pointerdown', { clientX: 50, clientY: 50 }) },
        true,
      );
      group.fire('pointerup', { target: group, evt: new MouseEvent('pointerup', { clientX: 50, clientY: 50 }) }, true);
    });
    await settle();
    expect(popover(view)).not.toBeNull();
    expect(notePopover(view)).toBeNull();
    await clickIcon(note.id);
    expect(notePopover(view)).not.toBeNull();
    expect(popover(view)).toBeNull();
  });

  it('moves a note by a drag, snapped to a square’s centre, or exactly there with Alt', async () => {
    const note = server.addMapNote(scene.id, { x: 1.5, y: 1.5, notes: 'Lever.' });
    await open();
    const drop = (worldX: number, worldY: number, altKey: boolean) =>
      act(() => {
        const node = icon(note.id)!;
        node.fire('dragstart', { target: node, evt: new MouseEvent('mousedown') });
        node.position({ x: worldX, y: worldY });
        node.fire('dragend', { target: node, evt: new MouseEvent('mouseup', { altKey }) });
      });
    drop(15 + 6.2 * 50, 125 + 3.9 * 50, false);
    await settle();
    expect(server.mapNotes[0]).toMatchObject({ x: 6.5, y: 3.5 });
    expect(icon(note.id)!.x()).toBe(15 + 6.5 * 50);
    drop(15 + 6.2 * 50, 125 + 3.9 * 50, true);
    await settle();
    expect(server.mapNotes[0]).toMatchObject({ x: 6.2, y: 3.9 });
    expect(noteDropPoint({ x: -0.2, y: 2 }, false)).toEqual({ x: -0.5, y: 2.5 });
  });

  it('previews the whole note when the mouse rests on it, and nothing for a sweep, a touch or the open note', async () => {
    const text = ['Statue says:', ...Array.from({ length: 9 }, (_, n) => `Riddle line ${n + 1}.`)].join('\n');
    const note = server.addMapNote(scene.id, { notes: text });
    const empty = server.addMapNote(scene.id, { x: 9.5, y: 9.5 });
    const view = await open();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const rest = () =>
      act(() => {
        vi.advanceTimersByTime(PREVIEW_DELAY_MS);
      });
    fire(note.id, 'pointerenter');
    act(() => {
      vi.advanceTimersByTime(PREVIEW_DELAY_MS - 1);
    });
    expect(notePreview(view)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const card = notePreview(view)!;
    expect(card.getAttribute('role')).toBe('tooltip');
    expect(card.querySelector('.eg-preview__text')!.textContent).toBe(text);
    expect(card.querySelector('textarea, button, input')).toBeNull();
    fire(note.id, 'pointerleave');
    expect(notePreview(view)).toBeNull();
    fire(empty.id, 'pointerenter');
    rest();
    expect(notePreview(view)!.textContent).toContain(t('mapNotes.empty'));
    fire(empty.id, 'pointerleave');
    fire(note.id, 'pointerenter', 200, 200, { pointerType: 'touch' });
    rest();
    expect(notePreview(view)).toBeNull();
    vi.useRealTimers();
    await clickIcon(note.id);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fire(note.id, 'pointermove', 230, 230);
    rest();
    expect(notePreview(view)).toBeNull();
  });

  it('keeps the live scene’s notes current from mapNotes.updated, another window’s included', async () => {
    const note = server.addMapNote(scene.id, { x: 2.5, y: 2.5, notes: 'Pit.' });
    const view = await openLive();
    expect(icon(note.id)).toBeDefined();
    // Another DM window adds one and moves the first.
    const added: MapNote = server.addMapNote(scene.id, { x: 7.5, y: 1.5, notes: 'Ford.' });
    server.mapNotes[0]!.x = 3.5;
    act(() => {
      server.deliver('mapNotes.updated', { scene_id: scene.id, map_notes: server.mapNotesOf(scene.id) });
    });
    await settle();
    expect(icon(added.id)).toBeDefined();
    expect(icon(note.id)!.x()).toBe(15 + 3.5 * 50);
    // One placed here on the live scene reaches the server and stays drawn.
    key('o');
    await settle();
    await clickMap(4, 4);
    await type(field(view), 'Collapsing floor.');
    blur(field(view));
    await settle();
    expect(server.mapNotes.map((each) => each.notes)).toContain('Collapsing floor.');
    expect(stage().find('.map-note')).toHaveLength(3);
  });
  it('lets a selected token go when a note opens or one is placed, so the keys move and hide nothing', async () => {
    const note = server.addMapNote(scene.id, { x: 8.5, y: 8.5, notes: 'Altar.' });
    const token = server.addToken(scene.id, goblin, { x: 1, y: 1 });
    const view = await open();
    await clickToken(token.id);
    expect(popover(view)).not.toBeNull();
    await clickIcon(note.id);
    expect(notePopover(view)).not.toBeNull();
    mapKey(view, 'ArrowRight');
    key('h');
    await settle();
    expect(tokenWrites()).toEqual([]);
    expect(server.sceneTokens[0]).toMatchObject({ x: 1, y: 1, hidden: token.hidden });

    // Placing a note, from a token selected again.
    await clickToken(token.id);
    key('o');
    await settle();
    expect(view.textContent).toContain(t('mapNotes.placing'));
    mapKey(view, 'ArrowRight');
    key('h');
    await settle();
    expect(tokenWrites()).toEqual([]);
  });

  it('places a note with Enter at the centre of the view, and with Alt exactly where the click is', async () => {
    const view = await open();
    key('o');
    await settle();
    // The world point at the centre of the 800 by 600 view, in grid units.
    const s = stage();
    const centre = { x: ((400 - s.x()) / s.scaleX() - 15) / 50, y: ((300 - s.y()) / s.scaleY() - 125) / 50 };
    mapKey(view, 'Enter');
    await settle();
    expect(server.mapNotes).toHaveLength(1);
    expect(server.mapNotes[0]).toMatchObject({ x: Math.floor(centre.x) + 0.5, y: Math.floor(centre.y) + 0.5 });
    await type(field(view), 'Centre.');
    blur(field(view));
    await settle();
    escape(notePopover(view)!);
    await settle();

    key('o');
    await settle();
    await clickMap(5.3, 7.8, true);
    expect(server.mapNotes).toHaveLength(2);
    expect(server.mapNotes[1]!.x).toBeCloseTo(5.3);
    expect(server.mapNotes[1]!.y).toBeCloseTo(7.8);
  });

  it('says why a placement or a move was refused, and shows what the server holds', async () => {
    const note = server.addMapNote(scene.id, { x: 1.5, y: 1.5, notes: 'Lever.' });
    const view = await open();
    const refusal = { status: 400, body: { error: { code: 'validation_failed', message: 'test' } } };
    server.before = (call) => (call.method !== 'GET' && call.path.includes('map-notes') ? refusal : undefined);
    key('o');
    await settle();
    await clickMap(3, 3);
    const said = t('mapNotes.failed', { reason: t('error.code.validation_failed') });
    expect(view.textContent).toContain(said);
    expect(notePopover(view)).toBeNull();
    expect(stage().find('.map-note')).toHaveLength(1);

    const readsBefore = reads().length;
    act(() => {
      const node = icon(note.id)!;
      node.fire('dragstart', { target: node, evt: new MouseEvent('mousedown') });
      node.position({ x: 15 + 6.2 * 50, y: 125 + 3.9 * 50 });
      node.fire('dragend', { target: node, evt: new MouseEvent('mouseup') });
    });
    await settle();
    expect(server.mapNotes[0]).toMatchObject({ x: 1.5, y: 1.5 });
    // Read again, and drawn where the server holds it.
    expect(reads().length).toBeGreaterThan(readsBefore);
    expect(icon(note.id)!.x()).toBe(15 + 1.5 * 50);
    expect(view.textContent).toContain(said);
  });

  it('keeps a note another window wrote into when it closes here empty, and reads the notes again', async () => {
    const note = server.addMapNote(scene.id, { x: 2.5, y: 2.5 });
    const view = await open();
    await clickIcon(note.id);
    // Another DM window writes into it; this one still holds it empty.
    server.mapNotes[0]!.notes = 'Written elsewhere.';
    const readsBefore = reads().length;
    escape(field(view));
    await settle();
    expect(notePopover(view)).toBeNull();
    expect(writes().map((call) => `${call.method} ${call.path}`)).toEqual([
      `DELETE /api/map-notes/${note.id}?if_empty=true`,
    ]);
    expect(server.mapNotes).toEqual([expect.objectContaining({ id: note.id, notes: 'Written elsewhere.' })]);
    expect(reads().length).toBeGreaterThan(readsBefore);
    expect(icon(note.id)).toBeDefined();
    // Nothing went wrong that the DM must read about.
    expect(view.querySelector('.eg-notice')).toBeNull();
    await clickIcon(note.id);
    expect(field(view).value).toBe('Written elsewhere.');
  });

  it('removes an empty note when it closes by a click on a token, and by a pan', async () => {
    const token = server.addToken(scene.id, goblin, { x: 1, y: 1 });
    const first = server.addMapNote(scene.id, { x: 8.5, y: 8.5 });
    const second = server.addMapNote(scene.id, { x: 9.5, y: 9.5 });
    const view = await open();
    await clickIcon(first.id);
    await clickToken(token.id);
    expect(notePopover(view)).toBeNull();
    expect(server.mapNotes.map((each) => each.id)).toEqual([second.id]);
    await clickIcon(second.id);
    act(() => {
      stage().fire('dragstart', { target: stage(), evt: new MouseEvent('mousedown') });
    });
    await settle();
    expect(notePopover(view)).toBeNull();
    expect(server.mapNotes).toEqual([]);
  });

  it('removes an empty note left open when the panel goes, another scene chosen, and keeps one with text', async () => {
    const empty = server.addMapNote(scene.id, { x: 2.5, y: 2.5 });
    const kept = server.addMapNote(scene.id, { x: 4.5, y: 4.5, notes: 'Keep me.' });
    await open();
    await clickIcon(empty.id);
    rendered!.unmount();
    rendered = undefined;
    await settle();
    expect(server.mapNotes.map((each) => each.id)).toEqual([kept.id]);
    await open();
    await clickIcon(kept.id);
    rendered!.unmount();
    rendered = undefined;
    await settle();
    expect(server.mapNotes.map((each) => each.id)).toEqual([kept.id]);
  });

  it('gives focus back to the map when Escape closes a note or its deletion is confirmed', async () => {
    const note = server.addMapNote(scene.id, { notes: 'Pit trap.' });
    const view = await open();
    await clickIcon(note.id);
    act(() => field(view).focus());
    escape(field(view));
    await settle();
    expect(notePopover(view)).toBeNull();
    expect(document.activeElement).toBe(map(view));
    await clickIcon(note.id);
    await click(button(notePopover(view)!, t('mapNotes.deleteNote')));
    await click(button(notePopover(view)!, t('mapNotes.delete')));
    expect(server.mapNotes).toEqual([]);
    expect(document.activeElement).toBe(map(view));
  });

  it('forgets the unsaved text of a note once it is deleted', async () => {
    const note = server.addMapNote(scene.id, { notes: 'Old text.' });
    const view = await open();
    await clickIcon(note.id);
    // Typed and, its save refused, still unsaved when the note is deleted.
    server.before = (call) =>
      call.method === 'PATCH'
        ? { status: 500, body: { error: { code: 'internal_error', message: 'test' } } }
        : undefined;
    await type(field(view), 'Never saved.');
    blur(field(view));
    await settle();
    expect(unsavedDrafts()).toBe(1);
    server.before = undefined;
    await click(button(notePopover(view)!, t('mapNotes.deleteNote')));
    await click(button(notePopover(view)!, t('mapNotes.delete')));
    expect(server.mapNotes).toEqual([]);
    expect(unsavedDrafts()).toBe(0);
  });

  it('closes the popover of a note another window deleted on the live scene, forgetting its unsaved text', async () => {
    const note = server.addMapNote(scene.id, { x: 2.5, y: 2.5, notes: 'Pit.' });
    const view = await openLive();
    await clickIcon(note.id);
    // Typed here, not yet saved, when another window deletes it.
    await type(field(view), 'Pit, DC 15.');
    expect(unsavedDrafts()).toBe(1);
    server.mapNotes = [];
    act(() => {
      server.deliver('mapNotes.updated', { scene_id: scene.id, map_notes: [] });
    });
    await settle();
    expect(notePopover(view)).toBeNull();
    expect(icon(note.id)).toBeUndefined();
    // The save its closing sent finds nothing; nothing is kept for it, and nothing put back.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settle();
    expect(unsavedDrafts()).toBe(0);
    expect(server.mapNotes).toEqual([]);
  });

  it('says when a scene’s notes could not be read, and reads them again on request', async () => {
    const note = server.addMapNote(scene.id, { notes: 'Pit.' });
    server.before = (call) =>
      call.method === 'GET' && call.path.includes('map-notes')
        ? { status: 500, body: { error: { code: 'internal_error', message: 'test' } } }
        : undefined;
    const view = await open();
    const said = t('mapNotes.loadFailed', { reason: t('error.code.internal_error') });
    expect(view.textContent).toContain(said);
    expect(view.textContent).not.toContain(t('mapNotes.failed', { reason: t('error.code.internal_error') }));
    expect(button(view, t('canvas.toolAddNote'))!.getAttribute('aria-disabled')).toBe('true');
    server.before = undefined;
    await click(button(view, t('mapNotes.retry')));
    expect(view.textContent).not.toContain(said);
    expect(icon(note.id)).toBeDefined();
    expect(button(view, t('canvas.toolAddNote'))!.hasAttribute('aria-disabled')).toBe(false);
  });
});
