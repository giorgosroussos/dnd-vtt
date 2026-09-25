// @vitest-environment jsdom
import { act, createElement } from 'react';
import Konva from 'konva';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageFileUrl, type Grid, type Image } from '@emberglass/shared';
import { t } from '../ui/messages.js';
import { images, installCanvas2d, installImageLoading, installResizeObserver } from '../ui/testing/canvas2d.js';
import { button, click, settle } from '../ui/testing/fakeServer.js';
import { FOCUSABLE, render, type Rendered } from '../ui/testing/render.js';
import { CELL_PX, fitCamera } from './geometry.js';
import { CANVAS_COLOURS, GRID_OPACITY, MapCanvas } from './MapCanvas.js';

// The map canvas of both views (PRP-02, specs/08-ux-journeys.md §3, specs/06-grid-and-measurement.md
// §2, specs/03-domain-model.md §6, specs/07-security-and-access.md §5, D-026, D-090), rendered
// with the real react-konva tree; its Konva nodes are read back from the stage.

const VIEWPORT = { width: 800, height: 600 };
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

async function draw(props: Parameters<typeof MapCanvas>[0]): Promise<{ view: HTMLElement; stage: Konva.Stage }> {
  rendered = render(createElement(MapCanvas, props));
  await settle();
  const stage = Konva.stages.at(-1)!;
  return { view: rendered.container, stage };
}

const lines = (stage: Konva.Stage, axis: 'x' | 'y') =>
  stage.find<Konva.Line>(`.grid-line-${axis}`).map((line) => line.points());
const gridOpacity = (stage: Konva.Stage) => stage.findOne('.grid')?.opacity();
const viewport = (view: HTMLElement) => view.querySelector<HTMLElement>('[role="application"]')!;
const camera = (element: HTMLElement) => ({
  x: Number(element.dataset.cameraX),
  y: Number(element.dataset.cameraY),
  scale: Number(element.dataset.cameraScale),
});

function press(element: HTMLElement, key: string, shiftKey = false) {
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
  });
}

describe('the map and the grid overlay (specs/06-grid-and-measurement.md §2)', () => {
  it('positions every line from grid.size and offsets times display ÷ original width, never from display pixels', async () => {
    const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm' });
    // 100 and 30 original px at half size: a line every 50 display px, starting at 15.
    const xs = lines(stage, 'x');
    expect(xs.slice(0, 2)).toEqual([
      [15, 0, 15, 1500],
      [65, 0, 65, 1500],
    ]);
    expect(xs).toHaveLength(40);
    expect(lines(stage, 'y')[0]).toEqual([0, 25, 2000, 25]);
    expect(lines(stage, 'y')).toHaveLength(30);
    // The stroke stays one screen pixel at every zoom.
    expect(stage.findOne<Konva.Line>('.grid-line')!.strokeScaleEnabled()).toBe(false);
  });

  it('loads only the display version of the map, never the original (specs/07-security-and-access.md §5)', async () => {
    const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm' });
    expect(images.requested).toEqual([imageFileUrl(MAP.id, 'display')]);
    const background = stage.findOne<Konva.Image>('.map')!;
    expect(background.image()).toBeInstanceOf(HTMLImageElement);
    expect((background.image() as HTMLImageElement).src).toBe(imageFileUrl(MAP.id, 'display'));
    expect([background.width(), background.height()]).toEqual([2000, 1500]);
  });

  it('requests the display version once, however often the map record is rebuilt (review C-5)', async () => {
    await draw({ grid: GRID, map: MAP, mode: 'player' });
    for (let each = 0; each < 3; each++) {
      act(() => rendered!.rerender(createElement(MapCanvas, { grid: GRID, map: { ...MAP }, mode: 'player' })));
    }
    await settle();
    expect(images.requested).toEqual([imageFileUrl(MAP.id, 'display')]);
  });

  it('loads only the display version in the player view too (review L-8)', async () => {
    const { stage } = await draw({ grid: GRID, map: MAP, mode: 'player' });
    expect(images.requested).toEqual([imageFileUrl(MAP.id, 'display')]);
    expect((stage.findOne<Konva.Image>('.map')!.image() as HTMLImageElement).src).toBe(imageFileUrl(MAP.id, 'display'));
  });

  it('draws each line light over a dark halo, so the grid shows on light maps too (review UX-6)', async () => {
    const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm' });
    const halos = stage.find<Konva.Line>('.grid-halo');
    const lines = stage.find<Konva.Line>('.grid-line');
    expect(halos.map((halo) => halo.points())).toEqual(lines.map((line) => line.points()));
    expect(halos.every((halo) => halo.stroke() === CANVAS_COLOURS.halo && halo.strokeWidth() > 1)).toBe(true);
    // Every halo is drawn before, so under, every light line.
    expect(Math.max(...halos.map((halo) => halo.zIndex()))).toBeLessThan(
      Math.min(...lines.map((line) => line.zIndex())),
    );
  });

  it('tells the DM view when the display version cannot be loaded', async () => {
    images.failing.add(imageFileUrl(MAP.id, 'display'));
    const onMapError = vi.fn();
    const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', onMapError });
    expect(onMapError).toHaveBeenCalledOnce();
    expect(stage.findOne('.map')).toBeUndefined();
  });

  it('draws the overlay faintly in the DM view when players do not see it, and fully when they do (D-026)', async () => {
    const hidden = await draw({ grid: { ...GRID, visible: false }, map: MAP, mode: 'dm' });
    expect(gridOpacity(hidden.stage)).toBe(GRID_OPACITY.faint);
    expect(lines(hidden.stage, 'x')).toHaveLength(40);
    expect(viewport(hidden.view).dataset.grid).toBe('faint');
    rendered!.unmount();
    const shown = await draw({ grid: GRID, map: MAP, mode: 'dm' });
    expect(gridOpacity(shown.stage)).toBe(GRID_OPACITY.shown);
    expect(GRID_OPACITY.faint).toBeLessThan(GRID_OPACITY.shown);
  });

  it('draws no overlay at all in the player view when the grid is hidden for players, and the same one when shown', async () => {
    const hidden = await draw({ grid: { ...GRID, visible: false }, map: MAP, mode: 'player' });
    expect(hidden.stage.find('.grid-line')).toHaveLength(0);
    expect(hidden.stage.findOne('.grid')).toBeUndefined();
    rendered!.unmount();
    const shown = await draw({ grid: GRID, map: MAP, mode: 'player' });
    expect(gridOpacity(shown.stage)).toBe(GRID_OPACITY.shown);
    expect(lines(shown.stage, 'x')).toHaveLength(40);
  });

  it('draws a map-less scene as its 30 × 20 default extent on a neutral dark background (specs/03-domain-model.md §6)', async () => {
    const grid = { ...GRID, size: null, offset_x: 0, offset_y: 0, columns: 30, rows: 20 };
    const { stage } = await draw({ grid, map: null, mode: 'dm' });
    const extent = stage.findOne<Konva.Rect>('.extent')!;
    expect([extent.width(), extent.height()]).toEqual([30 * CELL_PX, 20 * CELL_PX]);
    expect(extent.fill()).toBe(CANVAS_COLOURS.extent);
    expect(lines(stage, 'x')).toHaveLength(31);
    expect(lines(stage, 'y')).toHaveLength(21);
    expect(lines(stage, 'x').at(-1)).toEqual([30 * CELL_PX, 0, 30 * CELL_PX, 20 * CELL_PX]);
    expect(images.requested).toEqual([]);
  });
});

describe('the camera (specs/08-ux-journeys.md §3, specs/04-live-sync.md §9)', () => {
  it('starts fitted to the map, in both views', async () => {
    const fitted = fitCamera({ width: 2000, height: 1500 }, VIEWPORT);
    const dm = await draw({ grid: GRID, map: MAP, mode: 'dm' });
    expect([dm.stage.x(), dm.stage.y(), dm.stage.scaleX()]).toEqual([fitted.x, fitted.y, fitted.scale]);
    expect([dm.stage.width(), dm.stage.height()]).toEqual([800, 600]);
    rendered!.unmount();
    const player = await draw({ grid: GRID, map: MAP, mode: 'player' });
    expect([player.stage.x(), player.stage.y(), player.stage.scaleX()]).toEqual([fitted.x, fitted.y, fitted.scale]);
  });

  it('zooms and pans by keyboard, and a reset fits the map again', async () => {
    const { view, stage } = await draw({ grid: GRID, map: MAP, mode: 'dm' });
    const element = viewport(view);
    const fitted = camera(element);
    press(element, '+');
    expect(camera(element).scale).toBeGreaterThan(fitted.scale);
    expect(stage.scaleX()).toBe(camera(element).scale);
    press(element, 'ArrowRight');
    press(element, 'ArrowDown', true);
    const moved = camera(element);
    expect(moved.x).toBeLessThan(fitted.x);
    expect(moved.y).toBeLessThan(fitted.y);
    expect([stage.x(), stage.y()]).toEqual([moved.x, moved.y]);
    press(element, '0');
    expect(camera(element)).toEqual(fitted);
    press(element, '-');
    expect(camera(element).scale).toBeLessThan(fitted.scale);
    await click(button(view, t('canvas.fit')));
    expect(camera(element)).toEqual(fitted);
    await click(button(view, t('canvas.zoomIn')));
    expect(camera(element).scale).toBeGreaterThan(fitted.scale);
    await click(button(view, t('canvas.zoomOut')));
    expect(camera(element).scale).toBeCloseTo(fitted.scale, 9);
  });

  it('pans by dragging and zooms with the wheel in the DM view', async () => {
    const { view, stage } = await draw({ grid: GRID, map: MAP, mode: 'dm' });
    const element = viewport(view);
    const fitted = camera(element);
    expect(stage.draggable()).toBe(true);
    act(() => {
      stage.position({ x: fitted.x + 40, y: fitted.y - 30 });
      stage.fire('dragmove', { target: stage });
    });
    expect(camera(element)).toMatchObject({ x: fitted.x + 40, y: fitted.y - 30 });
    act(() => {
      stage.fire('wheel', { evt: new WheelEvent('wheel', { deltaY: -100, cancelable: true }), target: stage });
    });
    expect(camera(element).scale).toBeGreaterThan(fitted.scale);
  });

  it('leaves the canvas keys alone with a modifier, so the browser keeps its own shortcuts', async () => {
    const { view } = await draw({ grid: GRID, map: MAP, mode: 'dm' });
    const element = viewport(view);
    const before = camera(element);
    for (const key of ['ArrowLeft', 'ArrowRight', '+', '-', '0']) {
      for (const modifier of ['altKey', 'ctrlKey', 'metaKey']) {
        const event = new KeyboardEvent('keydown', { key, [modifier]: true, bubbles: true, cancelable: true });
        act(() => {
          element.dispatchEvent(event);
        });
        expect(camera(element), `${modifier} ${key}`).toEqual(before);
        expect(event.defaultPrevented, `${modifier} ${key}`).toBe(false);
      }
    }
  });

  it('ignores a sideways wheel swipe, which has no vertical part (review C-1)', async () => {
    const { view, stage } = await draw({ grid: GRID, map: MAP, mode: 'dm' });
    const before = camera(viewport(view));
    act(() => {
      stage.fire('wheel', { evt: new WheelEvent('wheel', { deltaX: 80, deltaY: 0, cancelable: true }), target: stage });
    });
    expect(camera(viewport(view))).toEqual(before);
  });

  it('keeps every wheel step when several arrive before the next render (review C-2)', async () => {
    const { view, stage } = await draw({ grid: GRID, map: MAP, mode: 'dm' });
    const before = camera(viewport(view));
    act(() => {
      for (let step = 0; step < 3; step++) {
        stage.fire('wheel', { evt: new WheelEvent('wheel', { deltaY: -100, cancelable: true }), target: stage });
      }
    });
    expect(camera(viewport(view)).scale).toBeCloseTo(before.scale * 1.1 ** 3, 9);
  });

  it('fits a newly shown map afresh, dropping the camera the DM set on the previous one', async () => {
    const { view } = await draw({ grid: GRID, map: MAP, mode: 'dm' });
    press(viewport(view), '+');
    const other = { ...MAP, id: 'd'.repeat(64), variants: { display: { width: 1000, height: 1000 } } };
    act(() => rendered!.rerender(createElement(MapCanvas, { grid: GRID, map: other, mode: 'dm' })));
    await settle();
    expect(camera(viewport(view))).toEqual(fitCamera({ width: 1000, height: 1000 }, VIEWPORT));
  });
});

describe('the player rendering (specs/08-ux-journeys.md §9)', () => {
  it('has no control and nothing that takes focus, and ignores the pointer', async () => {
    const { view, stage } = await draw({ grid: GRID, map: MAP, mode: 'player' });
    expect(view.querySelectorAll(FOCUSABLE)).toHaveLength(0);
    expect(view.querySelector('button, [role="application"], [tabindex]')).toBeNull();
    expect(stage.draggable()).toBe(false);
    expect(stage.listening()).toBe(false);
    expect(view.textContent).toBe('');
  });
});

describe('the DM rendering (specs/08-ux-journeys.md §8)', () => {
  it('names the map and says how to operate it by keyboard', async () => {
    const { view } = await draw({ grid: GRID, map: MAP, mode: 'dm', label: t('canvas.label', { name: 'Cave' }) });
    const element = viewport(view);
    expect(element.tabIndex).toBe(0);
    expect(element.getAttribute('aria-label')).toBe('Map of Cave');
    expect(document.getElementById(element.getAttribute('aria-describedby')!)!.textContent).toBe(t('canvas.help'));
  });
});

describe('measuring a rectangle for calibration (PRP-03, specs/06-grid-and-measurement.md §1, D-094)', () => {
  // Konva reads the pointer from the event against the container, which jsdom places at 0, 0.
  function pointer(stage: Konva.Stage, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number) {
    const evt = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
    act(() => {
      stage.setPointersPositions(evt);
      stage.fire(type, { evt, target: stage });
    });
  }

  it('draws instead of panning, reports the rectangle in original pixels, and shows it', async () => {
    const onDraw = vi.fn();
    const { view, stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', measure: { rect: undefined, onDraw } });
    expect(stage.draggable()).toBe(false);
    const fitted = camera(viewport(view));
    const screen = (wx: number, wy: number) => [fitted.x + wx * fitted.scale, fitted.y + wy * fitted.scale] as const;
    // World (display) pixels 100, 50 to 250, 200: the display version is half the original.
    pointer(stage, 'pointerdown', ...screen(100, 50));
    pointer(stage, 'pointermove', ...screen(180, 120));
    const dragged = stage.findOne<Konva.Rect>('.measure')!;
    expect(dragged.x()).toBeCloseTo(100, 6);
    expect(dragged.width()).toBeCloseTo(80, 6);
    pointer(stage, 'pointerup', ...screen(250, 200));
    expect(onDraw).toHaveBeenCalledOnce();
    const rect = onDraw.mock.calls[0]![0] as { x: number; y: number; width: number; height: number };
    expect(rect.x).toBeCloseTo(200, 6);
    expect(rect.y).toBeCloseTo(100, 6);
    expect(rect.width).toBeCloseTo(300, 6);
    expect(rect.height).toBeCloseTo(300, 6);
    // The camera did not move.
    expect(camera(viewport(view))).toEqual(fitted);
  });

  it('shows the measured rectangle it is given, in display pixels, and ignores a click', async () => {
    const onDraw = vi.fn();
    const { stage } = await draw({
      grid: GRID,
      map: MAP,
      mode: 'dm',
      measure: { rect: { x: 200, y: 100, width: 300, height: 300 }, onDraw },
    });
    const shown = stage.findOne<Konva.Rect>('.measure')!;
    expect([shown.x(), shown.y(), shown.width(), shown.height()]).toEqual([100, 50, 150, 150]);
    pointer(stage, 'pointerdown', 300, 300);
    pointer(stage, 'pointerup', 301, 301);
    expect(onDraw).not.toHaveBeenCalled();
  });

  it('pans again once measuring ends, and the player view never measures', async () => {
    const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm' });
    expect(stage.draggable()).toBe(true);
    expect(stage.findOne('.measure')).toBeUndefined();
    rendered!.unmount();
    const player = await draw({
      grid: GRID,
      map: MAP,
      mode: 'player',
      measure: { rect: { x: 0, y: 0, width: 10, height: 10 }, onDraw: vi.fn() },
    });
    expect(player.stage.findOne('.measure')).toBeUndefined();
  });
});
