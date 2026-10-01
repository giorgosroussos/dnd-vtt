// @vitest-environment jsdom
import { act, createElement } from 'react';
import Konva from 'konva';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FogMask, Grid, Image } from '@emberglass/shared';
import { t } from '../ui/messages.js';
import { installCanvas2d, installImageLoading, installResizeObserver } from '../ui/testing/canvas2d.js';
import { settle } from '../ui/testing/fakeServer.js';
import { render, type Rendered } from '../ui/testing/render.js';
import { FOG_COLOURS, fogRects } from './FogLayer.js';
import { MapCanvas, type FogTool } from './MapCanvas.js';
import type { CanvasToken } from './tokens.js';

// The painted fog on the map canvas (TBL-04, specs/04-live-sync.md §13, specs/08-ux-journeys.md §11), with the
// real react-konva tree read back from the stage: the TV's opaque mask, the DM's hatch, and the brush that
// paints or erases a stroke by a drag, previewed as the fog it would leave, and by keys.

const VIEWPORT = { width: 800, height: 600 };
// 100 original px squares from 30, 250; the display version is half the original, so 50 world px squares
// from 15, 125, and the fitted camera draws the 2000 × 1500 world at 0.4 from the corner.
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
const SCALE = 0.4;
/** Where grid point (x, y) is on the screen. */
const at = (x: number, y: number) => ({ x: (15 + x * 50) * SCALE, y: (125 + y * 50) * SCALE });

// Cells 16 to 32 of rows 0 to 4, and 16 to 20 of row 4: grid (4, 0) to (8, 1), and a strip below.
const MASK: FogMask = [
  { y: 0, runs: [16, 32] },
  { y: 1, runs: [16, 32] },
  { y: 2, runs: [16, 32] },
  { y: 3, runs: [16, 32] },
  { y: 4, runs: [16, 20] },
];
const GOBLIN: CanvasToken = {
  id: 'g1',
  label: 'Goblin 1',
  x: 1,
  y: 1,
  hidden: false,
  z_order: 0,
  size: 'medium',
  image_id: 'a'.repeat(64),
  category: 'monster',
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

type Props = Parameters<typeof MapCanvas>[0];
async function draw(props: Props): Promise<{ view: HTMLElement; stage: Konva.Stage }> {
  rendered = render(createElement(MapCanvas, props));
  await settle();
  return { view: rendered.container, stage: Konva.stages.at(-1)! };
}
const redraw = async (props: Props) => {
  act(() => rendered!.rerender(createElement(MapCanvas, props)));
  await settle();
};
const layerNames = (stage: Konva.Stage) => stage.getLayers().map((layer) => layer.name());
const viewport = (view: HTMLElement) => view.querySelector<HTMLElement>('[role="application"]')!;
const shownFog = (view: HTMLElement) => JSON.parse(viewport(view).dataset.fog!) as FogMask;

function pointer(
  stage: Konva.Stage,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  point: { x: number; y: number },
  button = 0,
) {
  const evt = new MouseEvent(type, {
    clientX: point.x,
    clientY: point.y,
    bubbles: true,
    button,
    buttons: type === 'pointerup' ? 0 : button === 0 ? 1 : 2,
  });
  act(() => {
    stage.setPointersPositions(evt);
    stage.fire(type, { evt, target: stage });
  });
}
const press = (element: HTMLElement, key: string) =>
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });

describe('the fog on the TV (specs/04-live-sync.md §13)', () => {
  it('draws the fog opaque, soft at the edge, over the map and the grid and under the tokens', async () => {
    const { view, stage } = await draw({
      grid: GRID,
      map: MAP,
      mode: 'player',
      tokens: [GOBLIN],
      fog: { fog: MASK },
    });
    const fog = stage.find<Konva.Shape>('.fog');
    expect(fog).toHaveLength(1);
    expect(fog[0]!.fill()).toBe(FOG_COLOURS.fog);
    expect(fog[0]!.shadowBlur()).toBeGreaterThan(0);
    expect(fog[0]!.shadowColor()).toBe(FOG_COLOURS.fog);
    expect(fog[0]!.getAttr('cells')).toEqual(fogRects(MASK));
    const names = layerNames(stage);
    expect(names.indexOf('fog-layer')).toBeGreaterThan(1);
    expect(names.indexOf('fog-layer')).toBeLessThan(names.indexOf('tokens'));
    expect(JSON.parse(view.querySelector<HTMLElement>('.eg-canvas--player')!.dataset.fog!)).toEqual(MASK);
    // Nothing on the TV listens.
    expect(stage.findOne<Konva.Layer>('.fog-layer')!.listening()).toBe(false);
    // The layer is blurred a little as drawn, so the cells' steps read as a round brush.
    expect(stage.findOne<Konva.Layer>('.fog-layer')!.getNativeCanvasElement().style.filter).toMatch(/^blur\(/);
  });

  it('draws no layer at all without fog', async () => {
    const { stage } = await draw({ grid: GRID, map: MAP, mode: 'player', fog: { fog: [] } });
    expect(stage.findOne('.fog-layer')).toBeUndefined();
  });
});

describe('fogRects', () => {
  it('carries each run down the rows that repeat it, so a block of rows is one rectangle', () => {
    expect(fogRects(MASK)).toEqual([
      { x0: 16, x1: 32, y0: 0, y1: 4 },
      { x0: 16, x1: 20, y0: 4, y1: 5 },
    ]);
    // A gap between rows breaks the rectangle even when the runs are the same.
    expect(
      fogRects([
        { y: 0, runs: [0, 2, 4, 6] },
        { y: 2, runs: [0, 2, 4, 6] },
      ]),
    ).toEqual([
      { x0: 0, x1: 2, y0: 0, y1: 1 },
      { x0: 4, x1: 6, y0: 0, y1: 1 },
      { x0: 0, x1: 2, y0: 2, y1: 3 },
      { x0: 4, x1: 6, y0: 2, y1: 3 },
    ]);
    expect(fogRects([])).toEqual([]);
  });
});

describe('the fog in the DM view (specs/08-ux-journeys.md §11)', () => {
  it('draws the fog as a hatch the map shows through, never opaque', async () => {
    const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', label: 'Crypt', fog: { fog: MASK } });
    const hatch = stage.findOne<Konva.Shape>('.fog-hatch')!;
    expect(hatch.getAttr('cells')).toEqual(fogRects(MASK));
    expect(stage.find('.fog')).toHaveLength(0);
    expect(stage.findOne<Konva.Layer>('.fog-layer')!.listening()).toBe(false);
  });

  it('draws no layer without fog while the brush is off', async () => {
    const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', label: 'Crypt', fog: { fog: [] } });
    expect(stage.findOne('.fog-layer')).toBeUndefined();
  });
});

describe('the fog brush (specs/04-live-sync.md §13)', () => {
  function painting(fields: Partial<FogTool> = {}, fog: FogMask = []) {
    const tool: FogTool = {
      on: true,
      onToggle: vi.fn(),
      erase: false,
      onErase: vi.fn(),
      radius: 1,
      onRadius: vi.fn(),
      onPaint: vi.fn(() => Promise.resolve(true)),
      ...fields,
    };
    const props: Props = {
      grid: GRID,
      map: MAP,
      mode: 'dm',
      label: 'Crypt',
      tokens: [GOBLIN],
      tokenControls: {
        selectedId: undefined,
        onSelect: vi.fn(),
        onDeselect: vi.fn(),
        onMove: vi.fn(),
        onDelete: vi.fn(),
      },
      fog: { fog, tool },
    };
    return { tool, props };
  }

  it('paints a stroke by a drag, shown as the fog it leaves, and sends it on release', async () => {
    const { tool, props } = painting();
    const { view, stage } = await draw(props);
    expect(viewport(view).dataset.fogTool).toBe('on');
    expect(viewport(view).dataset.fogBrush).toBe('paint 1');
    pointer(stage, 'pointerdown', at(2, 2));
    pointer(stage, 'pointermove', at(4, 2));
    pointer(stage, 'pointermove', at(6, 2));
    // Before the release the stroke already shows: a band a square either side of the line.
    const preview = shownFog(view);
    expect(preview.map((row) => row.y)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(tool.onPaint).not.toHaveBeenCalled();
    pointer(stage, 'pointerup', at(6, 2));
    await settle();
    expect(tool.onPaint).toHaveBeenCalledTimes(1);
    const stroke = vi.mocked(tool.onPaint).mock.calls[0]![0];
    expect(stroke.mode).toBe('paint');
    expect(stroke.radius).toBe(1);
    expect(stroke.points[0]).toEqual({ x: 2, y: 2 });
    expect(stroke.points.at(-1)).toEqual({ x: 6, y: 2 });
    // It goes on showing until the fog it made arrives.
    expect(shownFog(view)).toEqual(preview);
    await redraw({ ...props, fog: { fog: MASK, tool } });
    expect(shownFog(view)).toEqual(MASK);
  });

  it('takes a refused stroke off the map', async () => {
    const { props } = painting({ onPaint: vi.fn(() => Promise.resolve(false)) });
    const { view, stage } = await draw(props);
    pointer(stage, 'pointerdown', at(2, 2));
    pointer(stage, 'pointerup', at(2, 2));
    await settle();
    expect(shownFog(view)).toEqual([]);
  });

  it('erases when erasing: the preview takes the fog off under the stroke', async () => {
    const { tool, props } = painting({ erase: true, radius: 0.5 }, MASK);
    const { view, stage } = await draw(props);
    expect(viewport(view).dataset.fogBrush).toBe('erase 0.5');
    pointer(stage, 'pointerdown', at(6, 0.5));
    expect(shownFog(view).every((row) => row.runs.length === 4 || row.y >= 3)).toBe(true);
    pointer(stage, 'pointerup', at(6, 0.5));
    await settle();
    expect(vi.mocked(tool.onPaint).mock.calls[0]![0]).toMatchObject({ mode: 'erase', radius: 0.5 });
  });

  it('pans with the right button instead of painting, and never selects a token', async () => {
    const onSelect = vi.fn();
    const { tool, props } = painting();
    const { stage } = await draw({ ...props, tokenControls: { ...props.tokenControls!, onSelect } });
    const before = stage.x();
    pointer(stage, 'pointerdown', at(2, 2), 2);
    pointer(stage, 'pointermove', { x: at(2, 2).x + 40, y: at(2, 2).y }, 2);
    pointer(stage, 'pointerup', { x: at(2, 2).x + 40, y: at(2, 2).y }, 2);
    await settle();
    expect(tool.onPaint).not.toHaveBeenCalled();
    expect(stage.x()).not.toBe(before);
    expect(stage.findOne<Konva.Layer>('.tokens')!.listening()).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('paints by keys too: Enter at the centre of the view, E switches, [ and ] size it, Escape leaves', async () => {
    const { tool, props } = painting();
    const { view } = await draw(props);
    const map = viewport(view);
    press(map, 'Enter');
    await settle();
    // The centre of the view, (400, 300) on screen, is grid point (19.7, 12.5).
    expect(vi.mocked(tool.onPaint).mock.calls[0]![0]).toEqual({
      mode: 'paint',
      radius: 1,
      points: [{ x: 19.7, y: 12.5 }],
    });
    press(map, 'e');
    expect(tool.onErase).toHaveBeenCalledWith(true);
    press(map, ']');
    expect(tool.onRadius).toHaveBeenLastCalledWith(1.25);
    press(map, '[');
    expect(tool.onRadius).toHaveBeenLastCalledWith(0.75);
    press(map, 'Escape');
    expect(tool.onToggle).toHaveBeenCalledWith(false);
    expect(document.getElementById(map.getAttribute('aria-describedby')!)!.textContent).toBe(t('canvas.helpFog'));
  });

  it('keeps the size within a quarter square and five', async () => {
    const small = painting({ radius: 0.25 });
    const { view } = await draw(small.props);
    press(viewport(view), '[');
    expect(small.tool.onRadius).not.toHaveBeenCalled();
    const large = painting({ radius: 5 });
    await redraw(large.props);
    press(viewport(view), ']');
    expect(large.tool.onRadius).not.toHaveBeenCalled();
  });

  it('drops a stroke under way with Escape, and sends nothing', async () => {
    const { tool, props } = painting();
    const { view, stage } = await draw(props);
    pointer(stage, 'pointerdown', at(2, 2));
    pointer(stage, 'pointermove', at(4, 2));
    press(viewport(view), 'Escape');
    expect(shownFog(view)).toEqual([]);
    expect(tool.onToggle).not.toHaveBeenCalled();
    pointer(stage, 'pointerup', at(4, 2));
    await settle();
    expect(tool.onPaint).not.toHaveBeenCalled();
  });
});
