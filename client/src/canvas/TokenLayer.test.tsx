// @vitest-environment jsdom
import { act, createElement } from 'react';
import Konva from 'konva';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONDITION_IDS, imageFileUrl, type Grid, type Image, type TokenMarker } from '@emberglass/shared';
import { t } from '../ui/messages.js';
import { images, installCanvas2d, installImageLoading, installResizeObserver } from '../ui/testing/canvas2d.js';
import { settle } from '../ui/testing/fakeServer.js';
import { render, type Rendered } from '../ui/testing/render.js';
import { CELL_PX } from './geometry.js';
import { MapCanvas, type CanvasTokenControls, type Placing } from './MapCanvas.js';
import { THEME } from '../ui/theme.js';
import {
  CATEGORY_COLOURS,
  HIDDEN_OPACITY,
  HIDDEN_UNDERLAY_OPACITY,
  INVISIBLE_OPACITY,
  initialsOf,
  TOKEN_COLOURS,
} from './TokenLayer.js';
import type { CanvasToken } from './tokens.js';

// Tokens on the map canvas (PRP-04, specs/05-assets-and-images.md §2, specs/06-grid-and-measurement.md
// §4, specs/08-ux-journeys.md §3, §9, specs/07-security-and-access.md §5, Q-032, Q-054, D-023, D-100),
// with the real react-konva tree read back from the stage.

const VIEWPORT = { width: 800, height: 600 };
// 100 original px squares from 30, 250; the display version is half the original, so 50 world px
// squares from 15, 125.
const GRID: Grid = {
  type: 'square',
  size: 100,
  offset_x: 30,
  offset_y: 250,
  visible: true,
  feet_per_square: 5,
  columns: 40,
  rows: 30,
};
const MAP: Image = {
  id: 'c'.repeat(64),
  mime: 'image/png',
  width: 4000,
  height: 3000,
  variants: { display: { width: 2000, height: 1500 }, thumbnail: { width: 256, height: 192 } },
  grid_preset: null,
};

const token = (fields: Partial<CanvasToken> & { id: string }): CanvasToken => ({
  label: 'Goblin',
  x: 0,
  y: 0,
  hidden: false,
  z_order: 0,
  size: 'medium',
  image_id: 'a'.repeat(64),
  category: 'monster',
  ...fields,
});
const GOBLIN = token({ id: 'g1', label: 'Goblin 1', x: 2, y: 3 });
const HIDDEN = token({
  id: 'g2',
  label: 'Goblin 2',
  x: 4.5,
  y: 1.25,
  hidden: true,
  z_order: 1,
  image_id: 'b'.repeat(64),
});
const GIANT = token({ id: 'h1', label: 'Hill giant', x: 6, y: 6, size: 'huge', z_order: 2 });

let rendered: Rendered | undefined;

beforeEach(() => {
  installCanvas2d();
  installResizeObserver(VIEWPORT);
  installImageLoading();
});

afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
});

type Props = Parameters<typeof MapCanvas>[0];
async function draw(props: Props): Promise<{ view: HTMLElement; stage: Konva.Stage }> {
  rendered = render(createElement(MapCanvas, props));
  await settle();
  return { view: rendered.container, stage: Konva.stages.at(-1)! };
}

const groups = (stage: Konva.Stage) => stage.find<Konva.Group>('.token');
const groupOf = (stage: Konva.Stage, id: string) => stage.findOne<Konva.Group>(`#token-${id}`);
const viewport = (view: HTMLElement) => view.querySelector<HTMLElement>('[role="application"]')!;

function controls(fields: Partial<CanvasTokenControls> = {}): CanvasTokenControls {
  return {
    selectedId: undefined,
    onSelect: vi.fn(),
    onDeselect: vi.fn(),
    onMove: vi.fn(),
    onDelete: vi.fn(),
    onOpenPopover: vi.fn(),
    onClosePopover: vi.fn(),
    ...fields,
  };
}

function press(element: HTMLElement, key: string) {
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

/** Drags a token's group so its corner lands at world (x, y), then drops it. */
function dragTo(stage: Konva.Stage, id: string, x: number, y: number, altKey = false) {
  const group = groupOf(stage, id)!;
  act(() => {
    group.fire('dragstart', { target: group, evt: new MouseEvent('mousedown') });
    group.position({ x, y });
    group.fire('dragend', { target: group, evt: new MouseEvent('mouseup', { altKey }) });
  });
}

function clickAt(stage: Konva.Stage, x: number, y: number, altKey = false) {
  const evt = new MouseEvent('click', { clientX: x, clientY: y, altKey, bubbles: true });
  act(() => {
    stage.setPointersPositions(evt);
    stage.fire('click', { evt, target: stage });
  });
}

describe('drawing tokens (specs/05-assets-and-images.md §2, specs/03-domain-model.md §4)', () => {
  it('draws each token at its grid position through the calibration, covering its size, bottom first', async () => {
    const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', tokens: [GIANT, HIDDEN, GOBLIN] });
    expect(groups(stage).map((group) => group.id())).toEqual(['token-g1', 'token-g2', 'token-h1']);
    // Corner = origin + grid units × square, in world (display) pixels.
    expect(groupOf(stage, 'g1')!.position()).toEqual({ x: 15 + 2 * 50, y: 125 + 3 * 50 });
    expect(groupOf(stage, 'g2')!.position()).toEqual({ x: 15 + 4.5 * 50, y: 125 + 1.25 * 50 });
    const side = (id: string) => groupOf(stage, id)!.findOne<Konva.Shape>('.token-image, .token-placeholder')!.width();
    expect(side('g1')).toBe(50);
    expect(side('h1')).toBe(150);
  });

  it('draws a map-less scene at CELL_PX a square from its corner', async () => {
    const { stage } = await draw({ grid: GRID, map: null, mode: 'dm', tokens: [GOBLIN] });
    expect(groupOf(stage, 'g1')!.position()).toEqual({ x: 2 * CELL_PX, y: 3 * CELL_PX });
  });

  it("requests only each image's display version, once per image (specs/07-security-and-access.md §5)", async () => {
    const twin = token({ id: 'g3', x: 8, y: 8 });
    await draw({ grid: GRID, map: MAP, mode: 'dm', tokens: [GOBLIN, HIDDEN, twin] });
    const tokenImages = images.requested.filter((url) => !url.startsWith(`/images/${MAP.id}/`));
    expect(tokenImages.sort()).toEqual([
      imageFileUrl('a'.repeat(64), 'display'),
      imageFileUrl('b'.repeat(64), 'display'),
    ]);
  });

  it('labels every token below it, at a readable size whatever the zoom (Q-032)', async () => {
    const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', tokens: [GOBLIN] });
    const label = groupOf(stage, 'g1')!.findOne<Konva.Label>('.token-label')!;
    expect(label.findOne<Konva.Text>('Text')!.text()).toBe('Goblin 1');
    expect(label.y()).toBe(50);
    expect(label.scaleX()).toBeCloseTo(1 / stage.scaleX(), 9);
  });

  it('draws a hidden token semi-transparent with a marker in the DM mode (Q-054)', async () => {
    const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', tokens: [GOBLIN, HIDDEN] });
    const hidden = groupOf(stage, 'g2')!;
    expect(hidden.findOne('.token-body')!.opacity()).toBe(HIDDEN_OPACITY);
    const marker = hidden.findOne<Konva.Group>('.token-hidden-marker')!;
    expect(marker.findOne('Circle')).toBeDefined();
    // The same size on screen at every zoom.
    expect(marker.scaleX()).toBeCloseTo(1 / stage.scaleX(), 9);
    expect(hidden.findOne('.token-hidden-outline')).toBeDefined();
    expect(hidden.findOne('.token-hidden-underlay')!.opacity()).toBe(HIDDEN_UNDERLAY_OPACITY);
    const shown = groupOf(stage, 'g1')!;
    expect(shown.findOne('.token-body')!.opacity()).toBe(1);
    expect(shown.findOne('.token-hidden-marker')).toBeUndefined();
    expect(shown.findOne('.token-hidden-underlay')).toBeUndefined();
  });

  it('draws no hidden token at all in the player mode, and nothing there listens or drags', async () => {
    const { view, stage } = await draw({
      grid: GRID,
      map: MAP,
      mode: 'player',
      tokens: [GOBLIN, HIDDEN, GIANT],
      tokenControls: controls(),
    });
    expect(groups(stage).map((group) => group.id())).toEqual(['token-g1', 'token-h1']);
    expect(stage.find('.token-hidden-marker')).toHaveLength(0);
    expect(stage.findOne('.tokens')!.listening()).toBe(false);
    expect(groups(stage).every((group) => !group.draggable())).toBe(true);
    // Nothing of the hidden token reaches the page: no image request, no label, no attribute.
    expect(images.requested).not.toContain(imageFileUrl('b'.repeat(64), 'display'));
    expect(stage.find<Konva.Text>('Text').map((text) => text.text())).not.toContain('Goblin 2');
    expect(view.innerHTML).not.toContain('g2');
    // What the end-to-end tests read (LIV-03): the visible tokens drawn, with no hidden flag.
    const listed = JSON.parse(view.querySelector<HTMLElement>('[data-tokens]')!.dataset.tokens!) as object[];
    expect(listed.map((box) => (box as { id: string }).id)).toEqual(['g1', 'h1']);
    expect(listed.every((box) => !('hidden' in box) && !('note' in box))).toBe(true);
  });
});

describe('moving tokens in the DM mode (specs/06-grid-and-measurement.md §4, D-023)', () => {
  it('selects a token when it is pressed and outlines the selected one', async () => {
    const onSelect = vi.fn();
    const { stage } = await draw({
      grid: GRID,
      map: MAP,
      mode: 'dm',
      tokens: [GOBLIN, HIDDEN],
      tokenControls: controls({ onSelect, selectedId: 'g2' }),
    });
    expect(groupOf(stage, 'g2')!.findOne('.token-selected')).toBeDefined();
    expect(groupOf(stage, 'g1')!.findOne('.token-selected')).toBeUndefined();
    const group = groupOf(stage, 'g1')!;
    act(() => {
      group.fire('pointerdown', { target: group, evt: new MouseEvent('pointerdown') }, true);
    });
    expect(onSelect).toHaveBeenCalledWith('g1');
  });

  // The click-vs-drag threshold (D-156): a press released within 4 px opens the popover, one that moves
  // past it is a drag, which closes the popover and never opens it.
  describe('a click opens the popover, a drag closes it', () => {
    const press = (stage: Konva.Stage, id: string, type: 'pointerdown' | 'pointerup', x: number, y: number) => {
      const group = groupOf(stage, id)!;
      act(() => {
        group.fire(type, { target: group, evt: new MouseEvent(type, { clientX: x, clientY: y }) }, true);
      });
    };

    it('starts no drag before the pointer has moved 4 px', async () => {
      const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', tokens: [GOBLIN], tokenControls: controls() });
      expect(groupOf(stage, 'g1')!.dragDistance()).toBe(4);
    });

    it('opens the popover on a release within 3 px of the press, on either axis', async () => {
      const tokenControls = controls();
      const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', tokens: [GOBLIN], tokenControls });
      press(stage, 'g1', 'pointerdown', 100, 100);
      press(stage, 'g1', 'pointerup', 103, 97);
      expect(tokenControls.onSelect).toHaveBeenCalledWith('g1');
      expect(tokenControls.onOpenPopover).toHaveBeenCalledWith('g1');
    });

    it('does not open the popover on a release 4 px or more from the press', async () => {
      const tokenControls = controls();
      const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', tokens: [GOBLIN], tokenControls });
      press(stage, 'g1', 'pointerdown', 100, 100);
      press(stage, 'g1', 'pointerup', 100, 104);
      expect(tokenControls.onOpenPopover).not.toHaveBeenCalled();
    });

    it('closes the popover when a drag starts, keeps the token selected and opens nothing on the drop', async () => {
      const tokenControls = controls({ selectedId: 'g1' });
      const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', tokens: [GOBLIN], tokenControls });
      press(stage, 'g1', 'pointerdown', 100, 100);
      dragTo(stage, 'g1', 15 + 4 * 50, 125 + 3 * 50);
      press(stage, 'g1', 'pointerup', 100, 101);
      expect(tokenControls.onClosePopover).toHaveBeenCalled();
      expect(tokenControls.onSelect).toHaveBeenLastCalledWith('g1');
      expect(tokenControls.onDeselect).not.toHaveBeenCalled();
      expect(tokenControls.onOpenPopover).not.toHaveBeenCalled();
    });

    it('closes the popover when another token is pressed, and keeps it when the selected one is', async () => {
      const tokenControls = controls({ selectedId: 'g1' });
      const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', tokens: [GOBLIN, HIDDEN], tokenControls });
      press(stage, 'g1', 'pointerdown', 100, 100);
      expect(tokenControls.onClosePopover).not.toHaveBeenCalled();
      press(stage, 'g2', 'pointerdown', 300, 100);
      expect(tokenControls.onClosePopover).toHaveBeenCalledTimes(1);
    });
  });

  it('snaps a dropped token to whole squares, and places it where it snapped at once', async () => {
    const onMove = vi.fn();
    const { stage } = await draw({
      grid: GRID,
      map: MAP,
      mode: 'dm',
      tokens: [GOBLIN],
      tokenControls: controls({ onMove }),
    });
    // World 15 + 4.4 × 50, 125 + 2.7 × 50: grid 4.4, 2.7, which snaps to 4, 3.
    dragTo(stage, 'g1', 15 + 4.4 * 50, 125 + 2.7 * 50);
    expect(onMove).toHaveBeenCalledWith('g1', { x: 4, y: 3 });
    expect(groupOf(stage, 'g1')!.position()).toEqual({ x: 15 + 4 * 50, y: 125 + 3 * 50 });
  });

  it('snaps a Tiny token to half squares', async () => {
    const onMove = vi.fn();
    const tiny = token({ id: 't1', size: 'tiny' });
    const { stage } = await draw({
      grid: GRID,
      map: MAP,
      mode: 'dm',
      tokens: [tiny],
      tokenControls: controls({ onMove }),
    });
    dragTo(stage, 't1', 15 + 1.3 * 50, 125 + 2.8 * 50);
    expect(onMove).toHaveBeenCalledWith('t1', { x: 1.5, y: 3 });
  });

  it('places a token dropped with Alt held where it is, in decimal grid units (Q-059)', async () => {
    const onMove = vi.fn();
    const { stage } = await draw({
      grid: GRID,
      map: MAP,
      mode: 'dm',
      tokens: [GOBLIN],
      tokenControls: controls({ onMove }),
    });
    dragTo(stage, 'g1', 15 + 4.4 * 50, 125 + 2.7 * 50, true);
    const [, at] = onMove.mock.calls[0]! as [string, { x: number; y: number }];
    expect(at.x).toBeCloseTo(4.4, 9);
    expect(at.y).toBeCloseTo(2.7, 9);
  });

  it('moves the selected token a square by the arrow keys, lets it go on Escape and asks to delete it on Delete', async () => {
    const tokenControls = controls({ selectedId: 'g1' });
    const { view } = await draw({ grid: GRID, map: MAP, mode: 'dm', tokens: [GOBLIN], tokenControls });
    const before = viewport(view).dataset.cameraX;
    press(viewport(view), 'ArrowRight');
    expect(tokenControls.onMove).toHaveBeenLastCalledWith('g1', { x: 3, y: 3 });
    press(viewport(view), 'ArrowUp');
    expect(tokenControls.onMove).toHaveBeenLastCalledWith('g1', { x: 2, y: 2 });
    // The arrows moved the token, not the view.
    expect(viewport(view).dataset.cameraX).toBe(before);
    press(viewport(view), 'Delete');
    expect(tokenControls.onDelete).toHaveBeenCalledWith('g1');
    press(viewport(view), 'Backspace');
    expect(tokenControls.onDelete).toHaveBeenCalledTimes(2);
    press(viewport(view), 'Escape');
    expect(tokenControls.onDeselect).toHaveBeenCalled();
    expect(document.getElementById(viewport(view).getAttribute('aria-describedby')!)!.textContent).toBe(
      t('canvas.helpToken', { label: 'Goblin 1' }),
    );
  });

  it('pans with the arrow keys again when no token is selected', async () => {
    const tokenControls = controls();
    const { view } = await draw({ grid: GRID, map: MAP, mode: 'dm', tokens: [GOBLIN], tokenControls });
    const before = Number(viewport(view).dataset.cameraX);
    press(viewport(view), 'ArrowLeft');
    expect(Number(viewport(view).dataset.cameraX)).toBe(before + 64);
    expect(tokenControls.onMove).not.toHaveBeenCalled();
  });

  it('lets the selection go on a click on the map', async () => {
    const tokenControls = controls({ selectedId: 'g1' });
    const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', tokens: [GOBLIN], tokenControls });
    clickAt(stage, 10, 10);
    expect(tokenControls.onDeselect).toHaveBeenCalled();
  });

  it('exposes where each token is drawn for the end-to-end tests, in the DM mode only', async () => {
    const { view, stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', tokens: [GOBLIN, HIDDEN] });
    const boxes = JSON.parse(viewport(view).dataset.tokens!) as { id: string; left: number; side: number }[];
    expect(boxes.map((box) => box.id)).toEqual(['g1', 'g2']);
    expect(boxes[0]!.left).toBeCloseTo(stage.x() + (15 + 2 * 50) * stage.scaleX(), 9);
    expect(boxes[0]!.side).toBeCloseTo(50 * stage.scaleX(), 9);
  });
});

describe('placing a token (specs/05-assets-and-images.md §5)', () => {
  const placing = (fields: Partial<Placing> = {}): Placing => ({
    size: 'medium',
    onPlace: vi.fn(),
    onCancel: vi.fn(),
    ...fields,
  });

  it('places it where the map is clicked, converting screen to grid units through the calibration', async () => {
    const place = placing();
    const { stage } = await draw({
      grid: GRID,
      map: MAP,
      mode: 'dm',
      tokens: [],
      placing: place,
      tokenControls: controls(),
    });
    // Screen = world × scale + stage position; world 15 + 5.5 × 50 is the middle of square 5.
    const screen = (gx: number, gy: number) =>
      [stage.x() + (15 + gx * 50) * stage.scaleX(), stage.y() + (125 + gy * 50) * stage.scaleY()] as const;
    clickAt(stage, ...screen(5.5, 7.5));
    expect(place.onPlace).toHaveBeenCalledWith({ x: 5, y: 7 });
    clickAt(stage, ...screen(5.3, 7.8), true);
    const [at] = (place.onPlace as ReturnType<typeof vi.fn>).mock.calls[1]! as [{ x: number; y: number }];
    expect(at.x).toBeCloseTo(4.8, 2);
    expect(at.y).toBeCloseTo(7.3, 2);
  });

  it('places a Large token centred on the click, over the four squares around it', async () => {
    const place = placing({ size: 'large' });
    const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', placing: place });
    clickAt(stage, stage.x() + (15 + 5 * 50) * stage.scaleX(), stage.y() + (125 + 7 * 50) * stage.scaleY());
    expect(place.onPlace).toHaveBeenCalledWith({ x: 4, y: 6 });
  });

  it('places it at the centre of the view on Enter, cancels on Escape, and says so in the help', async () => {
    const place = placing();
    const { view, stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', placing: place });
    press(viewport(view), 'Enter');
    const centre = {
      x: (VIEWPORT.width / 2 - stage.x()) / stage.scaleX(),
      y: (VIEWPORT.height / 2 - stage.y()) / stage.scaleY(),
    };
    const expected = { x: Math.round((centre.x - 15) / 50 - 0.5), y: Math.round((centre.y - 125) / 50 - 0.5) };
    expect(place.onPlace).toHaveBeenCalledWith(expected);
    press(viewport(view), 'Escape');
    expect(place.onCancel).toHaveBeenCalled();
    expect(document.getElementById(viewport(view).getAttribute('aria-describedby')!)!.textContent).toBe(
      t('canvas.helpPlace'),
    );
  });

  it('neither selects nor drags a token while placing or measuring', async () => {
    const { stage } = await draw({
      grid: GRID,
      map: MAP,
      mode: 'dm',
      tokens: [GOBLIN],
      placing: placing(),
      tokenControls: controls(),
    });
    expect(groupOf(stage, 'g1')!.draggable()).toBe(false);
    expect(stage.findOne('.tokens')!.listening()).toBe(false);
    rendered!.unmount();
    rendered = undefined;
    const measuring = await draw({
      grid: GRID,
      map: MAP,
      mode: 'dm',
      tokens: [GOBLIN],
      tokenControls: controls(),
      measure: { rect: undefined, onDraw: vi.fn() },
    });
    expect(groupOf(measuring.stage, 'g1')!.draggable()).toBe(false);
  });
});

describe('the redesign’s token visuals (UIX-01, specs/08-ux-journeys.md §11)', () => {
  const ring = (stage: Konva.Stage, id: string) => groupOf(stage, id)!.findOne<Konva.Circle>('.token-ring')!;
  const labelText = (stage: Konva.Stage, id: string) =>
    groupOf(stage, id)!.findOne<Konva.Label>('.token-label')!.findOne<Konva.Text>('Text')!;

  it('draws each token as a circle ringed by its category: player characters gold, monsters red, others a neutral', async () => {
    const pc = token({ id: 'p1', label: 'Deadeye', category: 'pc' });
    const npc = token({ id: 'n1', label: 'Innkeeper', x: 3, category: 'npc' });
    const object = token({ id: 'o1', label: 'Chest', x: 5, category: 'object' });
    const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', tokens: [GOBLIN, pc, npc, object] });
    expect(ring(stage, 'g1').stroke()).toBe(CATEGORY_COLOURS.monster.ring);
    expect(ring(stage, 'p1').stroke()).toBe(CATEGORY_COLOURS.pc.ring);
    expect(ring(stage, 'n1').stroke()).toBe(CATEGORY_COLOURS.npc.ring);
    expect(ring(stage, 'o1').stroke()).toBe(CATEGORY_COLOURS.object.ring);
    expect(CATEGORY_COLOURS.npc.ring).not.toBe(CATEGORY_COLOURS.pc.ring);
    expect(CATEGORY_COLOURS.npc.ring).not.toBe(CATEGORY_COLOURS.monster.ring);
    // A circle inside the footprint's square, its radius short of half the square.
    expect(ring(stage, 'g1').radius()).toBeLessThan(25);
    expect(ring(stage, 'g1').dash() ?? []).toEqual([]);
  });

  it('never lets a hidden token pass for a visible one: dashed blue ring, crossed-eye badge, italic blue label', async () => {
    const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', tokens: [GOBLIN, HIDDEN] });
    expect(ring(stage, 'g2').stroke()).toBe(TOKEN_COLOURS.hidden);
    expect(ring(stage, 'g2').dash().length).toBeGreaterThan(0);
    expect(groupOf(stage, 'g2')!.findOne<Konva.Group>('.token-hidden-marker')!.findOne('Path')).toBeDefined();
    expect(labelText(stage, 'g2').fontStyle()).toContain('italic');
    expect(labelText(stage, 'g2').fill()).toBe(TOKEN_COLOURS.hiddenText);
    expect(labelText(stage, 'g1').fontStyle()).not.toContain('italic');
    expect(labelText(stage, 'g1').fill()).toBe(TOKEN_COLOURS.text);
  });

  it('shows the label’s initials while the image is on its way, and draws the label on a dark pill', async () => {
    images.held.add(imageFileUrl(GOBLIN.image_id, 'display'));
    const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', tokens: [GOBLIN] });
    expect(groupOf(stage, 'g1')!.findOne<Konva.Text>('.token-initials')!.text()).toBe('G1');
    expect(groupOf(stage, 'g1')!.findOne<Konva.Label>('.token-label')!.findOne('Tag')).toBeDefined();
  });

  it('marks the selected token with a dark and an ember ring', async () => {
    const { stage } = await draw({
      grid: GRID,
      map: MAP,
      mode: 'dm',
      tokens: [GOBLIN],
      tokenControls: controls({ selectedId: 'g1' }),
    });
    expect(groupOf(stage, 'g1')!.findOne<Konva.Circle>('.token-selected')!.stroke()).toBe(TOKEN_COLOURS.accent);
    expect(groupOf(stage, 'g1')!.findOne('.token-selected-halo')).toBeDefined();
  });

  it('draws labels larger on the TV by the scale it is given', async () => {
    const { stage } = await draw({ grid: GRID, map: MAP, mode: 'player', tokens: [GOBLIN], labelScale: 2.5 });
    const label = groupOf(stage, 'g1')!.findOne<Konva.Label>('.token-label')!;
    expect(label.scaleX()).toBeCloseTo(2.5 / stage.scaleX(), 9);
  });
});

describe('condition markers (TBL-02, TBL-05, specs/08-ux-journeys.md §11, D-157)', () => {
  const marked = (markers: CanvasToken['markers'], fields: Partial<CanvasToken> = {}) =>
    token({ id: 'm1', label: 'Goblin 1', x: 2, y: 3, markers, ...fields });
  const labelText = (stage: Konva.Stage) =>
    groupOf(stage, 'm1')!.findOne<Konva.Label>('.token-label')!.findOne<Konva.Text>('Text')!;
  const of = (...ids: string[]): TokenMarker[] => ids.map((id) => (id === 'exhaustion' ? { id, level: 3 } : { id }));
  const badgeIds = (stage: Konva.Stage) =>
    groupOf(stage, 'm1')!
      .find('.token-marker')
      .map((badge) => badge.name().split(' ')[1]!.replace('token-marker-', ''));
  const body = (stage: Konva.Stage) => groupOf(stage, 'm1')!.findOne<Konva.Group>('.token-body')!;

  it('draws none on a token without markers', async () => {
    const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', tokens: [marked(undefined), GIANT] });
    for (const name of [
      '.token-marker',
      '.token-marker-more',
      '.token-marker-bloodied-ring',
      '.token-marker-concentrating-ring',
      '.token-marker-desaturated',
    ]) {
      expect(stage.find(name), name).toHaveLength(0);
    }
    expect(labelText(stage).textDecoration()).toBe('');
    expect(body(stage).opacity()).toBe(1);
  });

  it('gives each of the eighteen conditions a badge with an icon of its own', async () => {
    const icons = new Set<string>();
    for (const id of CONDITION_IDS) {
      const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', tokens: [marked(of(id))] });
      const badge = groupOf(stage, 'm1')!.findOne<Konva.Group>(`.token-marker-${id}`)!;
      expect(badge, id).toBeDefined();
      icons.add(badge.findOne<Konva.Path>('.token-marker-icon')!.data());
      // 14 px across on the DM's screen.
      expect(badge.findOne<Konva.Circle>('Circle')!.radius() * 2 * badge.scaleX() * stage.scaleX()).toBeCloseTo(14, 6);
    }
    expect(icons.size).toBe(CONDITION_IDS.length);
  });

  it('keeps the rings and shading of the four first markers beside their badges', async () => {
    const { stage } = await draw({
      grid: GRID,
      map: MAP,
      mode: 'dm',
      tokens: [marked(of('bloodied', 'unconscious', 'dead', 'concentrating'))],
    });
    const group = groupOf(stage, 'm1')!;
    const ring = group.findOne<Konva.Circle>('.token-ring')!;
    // Bloodied: a red ring outside the token.
    const bloodied = group.findOne<Konva.Circle>('.token-marker-bloodied-ring')!;
    expect(bloodied.stroke()).toBe(THEME.bloodied);
    expect(bloodied.radius()).toBeGreaterThan(ring.radius());
    // Concentrating: a dotted purple ring further out still.
    const concentrating = group.findOne<Konva.Circle>('.token-marker-concentrating-ring')!;
    expect(concentrating.stroke()).toBe(THEME.concentrating);
    expect(concentrating.dash().length).toBe(2);
    expect(concentrating.radius()).toBeGreaterThan(bloodied.radius());
    // Unconscious and Dead: desaturated; Dead darkened too, its label struck through.
    expect(group.findOne<Konva.Rect>('.token-marker-desaturated')!.globalCompositeOperation()).toBe('saturation');
    expect(group.findOne('.token-marker-dead-shade')).toBeDefined();
    expect(labelText(stage).textDecoration()).toBe('line-through');
    // Three badges in a row along the top edge, by priority, then +1 last, a badge and a pixel apart on screen
    // so none overlaps another, centred on the token.
    expect(badgeIds(stage)).toEqual(['dead', 'unconscious', 'bloodied']);
    const more = group.findOne<Konva.Group>('.token-marker-more')!;
    expect(more.findOne<Konva.Text>('Text')!.text()).toBe(t('tokens.moreBadges', { count: 1 }));
    const row = [...group.find('.token-marker'), more];
    for (const badge of row) expect(badge.y()).toBeCloseTo(ring.y() - ring.radius(), 9);
    const xs = row.map((badge) => badge.x() * stage.scaleX());
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(15, 6);
    expect((xs[0]! + xs.at(-1)!) / 2).toBeCloseTo(ring.x() * stage.scaleX(), 6);
  });

  it('orders badges Dead, Unconscious, Bloodied, then as applied, and counts the rest in +N', async () => {
    const { stage } = await draw({
      grid: GRID,
      map: MAP,
      mode: 'dm',
      tokens: [marked(of('poisoned', 'prone', 'bloodied', 'blinded', 'stunned'))],
    });
    expect(badgeIds(stage)).toEqual(['bloodied', 'poisoned', 'prone']);
    const more = groupOf(stage, 'm1')!.findOne<Konva.Group>('.token-marker-more')!;
    expect(more.findOne<Konva.Text>('Text')!.text()).toBe(t('tokens.moreBadges', { count: 2 }));
  });

  it('draws no +N badge for three markers or fewer', async () => {
    const { stage } = await draw({
      grid: GRID,
      map: MAP,
      mode: 'dm',
      tokens: [marked(of('prone', 'poisoned', 'charmed'))],
    });
    expect(badgeIds(stage)).toEqual(['prone', 'poisoned', 'charmed']);
    expect(stage.find('.token-marker-more')).toHaveLength(0);
  });

  it('writes exhaustion’s level on its badge', async () => {
    const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', tokens: [marked(of('exhaustion'))] });
    const level = groupOf(stage, 'm1')!.findOne<Konva.Group>('.token-marker-level')!;
    expect(level.findOne<Konva.Text>('Text')!.text()).toBe('3');
  });

  it('desaturates an unconscious token without darkening it or striking its label', async () => {
    const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', tokens: [marked(of('unconscious'))] });
    expect(stage.find('.token-marker-desaturated')).toHaveLength(1);
    expect(stage.find('.token-marker-dead-shade')).toHaveLength(0);
    expect(labelText(stage).textDecoration()).toBe('');
  });

  it('draws an invisible token semi-transparent on both views, unlike a hidden one', async () => {
    for (const mode of ['dm', 'player'] as const) {
      const { stage } = await draw({ grid: GRID, map: MAP, mode, tokens: [marked(of('invisible'))] });
      expect(body(stage).opacity(), mode).toBe(INVISIBLE_OPACITY);
      expect(groupOf(stage, 'm1')!.findOne('.token-hidden-marker'), mode).toBeUndefined();
      expect(groupOf(stage, 'm1')!.findOne('.token-marker-invisible'), mode).toBeDefined();
    }
  });

  it('greys a dead token and strikes its label on the TV too, its badges larger by the label scale', async () => {
    const { stage } = await draw({
      grid: GRID,
      map: MAP,
      mode: 'player',
      tokens: [marked(of('bloodied', 'dead', 'prone', 'poisoned'))],
      labelScale: 2.5,
    });
    const badge = groupOf(stage, 'm1')!.findOne<Konva.Group>('.token-marker-bloodied')!;
    expect(badge.scaleX()).toBeCloseTo(2.5 / stage.scaleX(), 9);
    expect(groupOf(stage, 'm1')!.findOne('.token-marker-bloodied-ring')).toBeDefined();
    expect(groupOf(stage, 'm1')!.findOne('.token-marker-desaturated')).toBeDefined();
    expect(groupOf(stage, 'm1')!.findOne('.token-marker-dead-shade')).toBeDefined();
    expect(labelText(stage).textDecoration()).toBe('line-through');
    expect(badgeIds(stage)).toEqual(['dead', 'bloodied', 'prone']);
    expect(groupOf(stage, 'm1')!.findOne('.token-marker-more')).toBeDefined();
  });
});

describe('initials (UIX-01)', () => {
  it('takes a numbered label’s first letter and number, two words’ first letters, or a word’s first two letters', () => {
    expect(initialsOf('Bandit 1')).toBe('B1');
    expect(initialsOf('Hill giant')).toBe('HG');
    expect(initialsOf('Deadeye')).toBe('DE');
    expect(initialsOf('Λύκος 12')).toBe('Λ12');
    expect(initialsOf('όφις')).toBe('ΌΦ');
    expect(initialsOf('Deadeye 1790780094125')).toBe('D1');
  });
});

describe('the notes badge (DMT-04, specs/08-ux-journeys.md §13)', () => {
  const NOTED = token({ id: 'n1', label: 'Bandit 1', x: 5, y: 5, note: 'Leader: flees at half HP' });

  it('marks a token with notes on the DM’s map only, on its left edge, its hover text the notes', async () => {
    const { stage } = await draw({
      grid: GRID,
      map: MAP,
      mode: 'dm',
      tokens: [NOTED, GOBLIN],
      tokenControls: controls(),
    });
    expect(stage.find('.token-note-marker').map((badge) => badge.getParent()!.id())).toEqual(['token-n1']);
    const badge = groupOf(stage, 'n1')!.findOne('.token-note-marker')!;
    expect(badge.x()).toBeLessThan(groupOf(stage, 'n1')!.findOne<Konva.Circle>('.token-ring')!.x());
    act(() => {
      badge.fire('mouseenter', { evt: new MouseEvent('mouseenter') });
    });
    expect(stage.container().title).toBe('Leader: flees at half HP');
    act(() => {
      badge.fire('mouseleave', { evt: new MouseEvent('mouseleave') });
    });
    expect(stage.container().hasAttribute('title')).toBe(false);
  });

  it('never draws it on the player view, whatever a token carries', async () => {
    const { stage } = await draw({ grid: GRID, map: MAP, mode: 'player', tokens: [NOTED, GOBLIN] });
    expect(groups(stage)).toHaveLength(2);
    expect(stage.find('.token-note-marker')).toHaveLength(0);
  });
});
