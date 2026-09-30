// @vitest-environment jsdom
import { act, createElement } from 'react';
import Konva from 'konva';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Grid, Image, RegionShape } from '@emberglass/shared';
import { t } from '../ui/messages.js';
import { installCanvas2d, installImageLoading, installResizeObserver } from '../ui/testing/canvas2d.js';
import { settle } from '../ui/testing/fakeServer.js';
import { render, type Rendered } from '../ui/testing/render.js';
import { FOG_COLOURS, rectBetween } from './FogLayer.js';
import { MapCanvas, type FogTool } from './MapCanvas.js';
import type { CanvasToken } from './tokens.js';

// Fog regions on the map canvas (TBL-03, specs/04-live-sync.md §13, specs/08-ux-journeys.md §11), with the
// real react-konva tree read back from the stage: the TV's opaque mask, the DM's outlines, hatch and tags,
// and the fog tool that draws a rectangle by a drag and a polygon corner by corner, snapped to grid corners.

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
/** Where grid corner (x, y) is on the screen. */
const corner = (x: number, y: number) => ({ x: (15 + x * 50) * SCALE, y: (125 + y * 50) * SCALE });

const BACK_ROOM: RegionShape = { kind: 'rect', x: 4, y: 0, width: 4, height: 4 };
const CELLAR: RegionShape = {
  kind: 'polygon',
  points: [
    { x: 0, y: 5 },
    { x: 3, y: 5 },
    { x: 0, y: 8 },
  ],
};
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

function pointer(stage: Konva.Stage, type: 'pointerdown' | 'pointermove' | 'pointerup', at: { x: number; y: number }) {
  const evt = new MouseEvent(type, {
    clientX: at.x,
    clientY: at.y,
    bubbles: true,
    buttons: type === 'pointerup' ? 0 : 1,
  });
  act(() => {
    stage.setPointersPositions(evt);
    stage.fire(type, { evt, target: stage });
  });
}
const click = (stage: Konva.Stage, at: { x: number; y: number }) => {
  pointer(stage, 'pointerdown', at);
  pointer(stage, 'pointerup', at);
};
const press = (element: HTMLElement, key: string) =>
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });

describe('the fog on the TV (specs/04-live-sync.md §13)', () => {
  it('draws each fogged shape opaque, soft at the edge, over the map and the grid and under the tokens', async () => {
    const { view, stage } = await draw({
      grid: GRID,
      map: MAP,
      mode: 'player',
      tokens: [GOBLIN],
      fog: {
        regions: [
          { shape: BACK_ROOM, hidden: true },
          { shape: CELLAR, hidden: true },
        ],
      },
    });
    const fog = stage.find<Konva.Line>('.fog');
    expect(fog).toHaveLength(2);
    for (const shape of fog) {
      expect(shape.fill()).toBe(FOG_COLOURS.fog);
      expect(shape.closed()).toBe(true);
      expect(shape.shadowBlur()).toBeGreaterThan(0);
      expect(shape.shadowColor()).toBe(FOG_COLOURS.fog);
    }
    // The rectangle's corners in the world: squares of 50 px from (15, 125).
    expect(fog[0]!.points()).toEqual([215, 125, 415, 125, 415, 325, 215, 325]);
    const names = layerNames(stage);
    expect(names.indexOf('fog-layer')).toBeGreaterThan(1);
    expect(names.indexOf('fog-layer')).toBeLessThan(names.indexOf('tokens'));
    expect(JSON.parse(view.querySelector<HTMLElement>('.eg-canvas--player')!.dataset.fog!)).toEqual([
      BACK_ROOM,
      CELLAR,
    ]);
    // Nothing on the TV is named, nor listens.
    expect(stage.find('.fog-tag')).toHaveLength(0);
    expect(stage.findOne<Konva.Layer>('.fog-layer')!.listening()).toBe(false);
  });

  it('draws nothing of a revealed region, and no layer at all without fog', async () => {
    const { stage } = await draw({
      grid: GRID,
      map: MAP,
      mode: 'player',
      fog: { regions: [{ shape: BACK_ROOM, hidden: false }] },
    });
    expect(stage.findOne('.fog-layer')).toBeUndefined();
  });
});

describe('the fog in the DM view (specs/08-ux-journeys.md §11)', () => {
  const regions = [
    { id: 'r1', name: 'Back room', shape: BACK_ROOM, hidden: true },
    { id: 'r2', name: 'Cellar', shape: CELLAR, hidden: false },
  ];

  it('outlines a fogged region dashed in blue over a hatch, a revealed one dotted and faint, each tagged', async () => {
    const { stage } = await draw({ grid: GRID, map: MAP, mode: 'dm', label: 'Crypt', fog: { regions } });
    const fogged = stage.findOne<Konva.Group>('.fog-region-fogged')!;
    const revealed = stage.findOne<Konva.Group>('.fog-region-revealed')!;
    const outline = (group: Konva.Group) => group.findOne<Konva.Line>('.fog-outline')!;
    expect(outline(fogged).stroke()).toBe(FOG_COLOURS.outline);
    expect(outline(fogged).dash()).toEqual([6, 4]);
    expect(fogged.findOne('.fog-hatch')).toBeDefined();
    expect(outline(revealed).dash()).toEqual([2, 4]);
    expect(outline(revealed).opacity()).toBeLessThan(1);
    expect(revealed.findOne('.fog-hatch')).toBeUndefined();
    const tag = (group: Konva.Group) => group.findOne<Konva.Label>('.fog-tag')!.findOne<Konva.Text>('Text')!.text();
    expect(tag(fogged)).toBe(t('fog.tagFogged', { name: 'Back room' }));
    expect(tag(revealed)).toBe(t('fog.tagRevealed', { name: 'Cellar' }));
    // The DM sees the map under the fog: nothing is opaque.
    expect(stage.find('.fog')).toHaveLength(0);
  });

  it('fogs or reveals a region from its tag, but not while a tool has the pointer', async () => {
    const onToggleRegion = vi.fn();
    const tool: FogTool = { on: false, onToggle: vi.fn(), onDraw: vi.fn(), onToggleRegion };
    const props: Props = { grid: GRID, map: MAP, mode: 'dm', label: 'Crypt', fog: { regions, tool } };
    const { stage } = await draw(props);
    act(() => {
      stage.findOne<Konva.Group>('.fog-region-fogged')!.findOne<Konva.Label>('.fog-tag')!.fire('click');
    });
    expect(onToggleRegion).toHaveBeenCalledWith('r1');
    expect(stage.findOne<Konva.Layer>('.fog-layer')!.listening()).toBe(true);
    await redraw({ ...props, fog: { regions, tool: { ...tool, on: true } } });
    expect(stage.findOne<Konva.Layer>('.fog-layer')!.listening()).toBe(false);
  });
});

describe('the fog tool (specs/04-live-sync.md §13)', () => {
  function drawing(fields: Partial<FogTool> = {}) {
    const tool: FogTool = { on: true, onToggle: vi.fn(), onDraw: vi.fn(), ...fields };
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
      fog: { regions: [], tool },
    };
    return { tool, props };
  }

  it('draws a rectangle by a drag, its corners snapped to the nearest grid corners', async () => {
    const { tool, props } = drawing();
    const { view, stage } = await draw(props);
    expect(viewport(view).dataset.fogTool).toBe('on');
    const from = corner(2, 1);
    const to = corner(5, 3);
    pointer(stage, 'pointerdown', { x: from.x + 3, y: from.y - 4 });
    pointer(stage, 'pointermove', { x: to.x - 5, y: to.y + 4 });
    expect(JSON.parse(viewport(view).dataset.fogDraft!)).toMatchObject({
      kind: 'rect',
      from: { x: 2, y: 1 },
      to: { x: 5, y: 3 },
    });
    pointer(stage, 'pointerup', { x: to.x - 5, y: to.y + 4 });
    expect(tool.onDraw).toHaveBeenCalledWith({ kind: 'rect', x: 2, y: 1, width: 3, height: 2 });
    expect(viewport(view).dataset.fogDraft).toBeUndefined();
  });

  it('draws a polygon corner by corner, closed by its first corner again', async () => {
    const { tool, props } = drawing();
    const { view, stage } = await draw(props);
    click(stage, corner(1, 1));
    click(stage, corner(4, 1));
    // The same corner twice in a row with fewer than three corners adds nothing.
    click(stage, corner(4, 1));
    click(stage, corner(4, 4));
    expect(JSON.parse(viewport(view).dataset.fogDraft!)).toEqual({
      kind: 'polygon',
      points: [
        { x: 1, y: 1 },
        { x: 4, y: 1 },
        { x: 4, y: 4 },
      ],
    });
    expect(stage.find('.fog-draft-corner')).toHaveLength(3);
    click(stage, { x: corner(1, 1).x + 2, y: corner(1, 1).y + 2 });
    expect(tool.onDraw).toHaveBeenCalledWith({
      kind: 'polygon',
      points: [
        { x: 1, y: 1 },
        { x: 4, y: 1 },
        { x: 4, y: 4 },
      ],
    });
  });

  it('closes a polygon by its last corner twice, and never selects a token while drawing', async () => {
    const onSelect = vi.fn();
    const { tool, props } = drawing();
    const { stage } = await draw({ ...props, tokenControls: { ...props.tokenControls!, onSelect } });
    for (const at of [corner(1, 1), corner(3, 1), corner(3, 3), corner(3, 3)]) click(stage, at);
    expect(tool.onDraw).toHaveBeenCalledTimes(1);
    expect(stage.findOne<Konva.Layer>('.tokens')!.listening()).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('draws by keys too: Enter a corner at the centre of the view, Backspace takes it off, Escape drops the shape then leaves', async () => {
    const onToggle = vi.fn();
    const { tool, props } = drawing({ onToggle });
    const { view } = await draw(props);
    const map = viewport(view);
    press(map, 'Enter');
    const first = JSON.parse(map.dataset.fogDraft!) as { points: { x: number; y: number }[] };
    expect(first.points).toHaveLength(1);
    // The centre of the view, (400, 300) on screen, is grid corner (19.5, 12.5) rounded.
    expect(first.points[0]).toEqual({ x: 20, y: 13 });
    press(map, 'ArrowRight');
    press(map, 'Enter');
    press(map, 'Backspace');
    expect((JSON.parse(map.dataset.fogDraft!) as { points: unknown[] }).points).toHaveLength(1);
    press(map, 'Escape');
    expect(map.dataset.fogDraft).toBeUndefined();
    expect(onToggle).not.toHaveBeenCalled();
    press(map, 'Escape');
    expect(onToggle).toHaveBeenCalledWith(false);
    press(map, 'f');
    expect(onToggle).toHaveBeenLastCalledWith(false);
    expect(tool.onDraw).not.toHaveBeenCalled();
    expect(view.querySelector('[id$="-fog"]')).toBeNull();
    expect(document.getElementById(map.getAttribute('aria-describedby')!)!.textContent).toBe(t('canvas.helpFog'));
  });

  it('ignores a drag less than a square wide or high', () => {
    expect(rectBetween({ x: 1, y: 1 }, { x: 1, y: 4 })).toBeUndefined();
    expect(rectBetween({ x: 3, y: 4 }, { x: 1, y: 1 })).toEqual({ kind: 'rect', x: 1, y: 1, width: 2, height: 3 });
  });
});
