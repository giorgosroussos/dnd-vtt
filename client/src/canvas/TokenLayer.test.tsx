// @vitest-environment jsdom
import { act, createElement } from 'react';
import Konva from 'konva';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageFileUrl, type Grid, type Image } from '@emberglass/shared';
import { t } from '../ui/messages.js';
import { images, installCanvas2d, installImageLoading, installResizeObserver } from '../ui/testing/canvas2d.js';
import { settle } from '../ui/testing/fakeServer.js';
import { render, type Rendered } from '../ui/testing/render.js';
import { CELL_PX } from './geometry.js';
import { MapCanvas, type CanvasTokenControls, type Placing } from './MapCanvas.js';
import { HIDDEN_OPACITY, HIDDEN_UNDERLAY_OPACITY } from './TokenLayer.js';
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
    expect(listed.every((box) => !('hidden' in box))).toBe(true);
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
