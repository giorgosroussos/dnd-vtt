// @vitest-environment jsdom
import { act, createElement } from 'react';
import Konva from 'konva';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { imageFileUrl, type Image, type Scene } from '@emberglass/shared';
import { MAGNIFIER_PX } from '../../canvas/calibration.js';
import { t } from '../../ui/messages.js';
import { images, installCanvas2d, installImageLoading, installResizeObserver } from '../../ui/testing/canvas2d.js';
import {
  button,
  click,
  FakeServer,
  installDialog,
  settle,
  submit,
  type,
  type Reply,
} from '../../ui/testing/fakeServer.js';
import { render, type Rendered } from '../../ui/testing/render.js';
import { ScenePanel } from '../ScenePanel.js';

// Grid calibration in the scene panel (PRP-03, specs/06-grid-and-measurement.md §1, §2,
// specs/03-domain-model.md §5, §6, specs/05-assets-and-images.md §7, specs/07-security-and-access.md
// §5, D-093, D-094), against a scripted server. The map is 1,000 × 600 original pixels shown by a
// display version half that size, so every expected value below is in original pixels and the
// overlay's lines are at half of them.

let server: FakeServer;
let rendered: Rendered | undefined;
let scene: Scene;
let map: Image;

beforeEach(() => {
  installCanvas2d();
  installResizeObserver({ width: 800, height: 600 });
  installImageLoading();
  installDialog();
  server = new FakeServer().install();
  const campaign = server.addCampaign('Lost Mine');
  const session = server.addSession(campaign.id, 'One');
  scene = server.addScene(session.id, 'Cave');
  map = server.addImage({ width: 1000, height: 600, variants: { display: { width: 500, height: 300 } } });
  scene.map_image_id = map.id;
});

afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  server.uninstall();
});

async function open(target: Scene = scene): Promise<HTMLElement> {
  rendered = render(
    createElement(ScenePanel, { sceneId: target.id, name: target.name, uploadLimit: 50 * 1024 * 1024 }),
  );
  await settle();
  return rendered.container;
}

const mapStage = () => Konva.stages.find((each) => each.container().closest('[role="application"]'))!;
const cornerStage = () => Konva.stages.find((each) => each.container().closest('.eg-magnifier'));
const xLines = () =>
  mapStage()
    .find<Konva.Line>('.grid-line-x')
    .map((line) => line.points()[0]!);
const yLines = () =>
  mapStage()
    .find<Konva.Line>('.grid-line-y')
    .map((line) => line.points()[1]!);
const field = (view: HTMLElement, label: string) =>
  [...view.querySelectorAll('input')].find((input) => input.labels?.[0]?.textContent === label)!;
const radio = (view: HTMLElement, label: string) => field(view, label);
const patches = () => server.calls.filter((call) => call.method === 'PATCH');

async function calibrate(view: HTMLElement): Promise<void> {
  await click(button(view, t('calibration.open')));
}

function key(element: HTMLElement, name: string, shiftKey = false) {
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true }));
  });
}

function drag(stage: Konva.Stage, from: [number, number], to: [number, number]) {
  const camera = { x: stage.x(), y: stage.y(), scale: stage.scaleX() };
  const at = ([wx, wy]: [number, number]) => ({
    clientX: camera.x + wx * camera.scale,
    clientY: camera.y + wy * camera.scale,
  });
  for (const [kind, point] of [
    ['pointerdown', from],
    ['pointermove', to],
    ['pointerup', to],
  ] as const) {
    const evt = new MouseEvent(kind, { ...at(point), bubbles: true });
    act(() => {
      stage.setPointersPositions(evt);
      stage.fire(kind, { evt, target: stage });
    });
  }
}

describe('where calibration is offered (specs/06-grid-and-measurement.md §1, specs/03-domain-model.md §6)', () => {
  it('offers no calibration on a scene without a map', async () => {
    scene.map_image_id = null;
    const view = await open();
    expect(button(view, t('calibration.open'))).toBeUndefined();
    expect(view.querySelector('.eg-calibration')).toBeNull();
  });

  it('opens above the canvas with the method chosen and focused, loading no original until then', async () => {
    const view = await open();
    expect(images.requested).toEqual([imageFileUrl(map.id, 'display')]);
    await calibrate(view);
    expect(view.querySelector('.eg-calibration h2')!.textContent).toBe(t('calibration.heading'));
    expect(document.activeElement).toBe(radio(view, t('calibration.method.dimensions')));
    expect(button(view, t('calibration.open'))).toBeUndefined();
  });
});

describe('known dimensions', () => {
  it('draws size = original width ÷ columns as it is typed, and saves it only on Save, in original pixels', async () => {
    const view = await open();
    await calibrate(view);
    await type(field(view, t('calibration.columns')), '25');
    await type(field(view, t('calibration.rows')), '15');
    // 1000 ÷ 25 = 40 original px, a line every 20 display px, before anything is saved.
    expect(xLines().slice(0, 3)).toEqual([0, 20, 40]);
    expect(xLines()).toHaveLength(26);
    expect(patches()).toEqual([]);
    await click(button(view, t('calibration.save')));
    expect(patches().map((call) => call.body)).toEqual([
      { grid: { size: 40, offset_x: 0, offset_y: 0, columns: 25, rows: 15 } },
    ]);
    expect(server.scenes[0]!.grid).toMatchObject({ size: 40, columns: 25, rows: 15 });
    expect(view.querySelector('[role="status"]')!.textContent).toBe(t('calibration.saved'));
    expect(view.querySelector('.eg-calibration')).toBeNull();
    expect(document.activeElement).toBe(button(view, t('calibration.open')));
    expect(xLines()[1]).toBe(20);
  });

  it('refuses a count that is not a whole number, keeps the last grid drawn and sends nothing', async () => {
    const view = await open();
    await calibrate(view);
    await type(field(view, t('calibration.columns')), '25');
    await type(field(view, t('calibration.columns')), '0');
    expect(view.querySelector('.eg-field__error')!.textContent).toBe(t('calibration.error.count'));
    expect(xLines()[1]).toBe(20);
    await click(button(view, t('calibration.save')));
    expect(patches()).toEqual([]);
    expect(document.activeElement).toBe(field(view, t('calibration.columns')));
  });
});

describe('a rectangle over N × N squares', () => {
  it('measures a rectangle dragged on the map, converting display to original pixels, then saves size and offset', async () => {
    const view = await open();
    await calibrate(view);
    await click(radio(view, t('calibration.method.rectangle')));
    expect(mapStage().draggable()).toBe(false);
    // Display 50, 30 to 110, 90: original 100, 60, 120 px a side over 3 squares.
    drag(mapStage(), [50, 30], [110, 90]);
    await settle();
    expect(view.textContent).toContain(t('calibration.measured', { width: '120', height: '120' }));
    expect(xLines().slice(0, 2)).toEqual([10, 30]);
    expect(yLines()[0]).toBeCloseTo(10, 9);
    expect(yLines()[1]).toBeCloseTo(30, 9);
    await click(button(view, t('calibration.save')));
    const body = patches()[0]!.body as { grid: Record<string, number> };
    expect(body.grid.size).toBeCloseTo(40, 9);
    expect(body.grid.offset_x).toBeCloseTo(20, 9);
    expect(body.grid.offset_y).toBeCloseTo(20, 9);
    expect(body.grid).toMatchObject({ columns: 25, rows: 15 });
  });

  it('recomputes from the same rectangle when the number of squares changes', async () => {
    const view = await open();
    await calibrate(view);
    await click(radio(view, t('calibration.method.rectangle')));
    drag(mapStage(), [50, 30], [110, 90]);
    await settle();
    await type(field(view, t('calibration.squares')), '4');
    // 120 ÷ 4 = 30 original px, 15 display px.
    expect(xLines()[1]! - xLines()[0]!).toBeCloseTo(15, 9);
  });
});

describe('fine tuning', () => {
  it('steps size and offsets with the arrow keys, 0.1 px or 1 px with Shift, and keeps a decimal size exactly', async () => {
    scene.grid = { ...scene.grid, size: 40 };
    const view = await open();
    await calibrate(view);
    await click(radio(view, t('calibration.method.fine')));
    const size = field(view, t('calibration.size'));
    key(size, 'ArrowUp');
    key(size, 'ArrowUp');
    expect(size.value).toBe('40.2');
    const x = field(view, t('calibration.offsetX'));
    key(x, 'ArrowUp', true);
    key(x, 'ArrowUp', true);
    expect(x.value).toBe('2');
    // The overlay follows: the first vertical line at 2 original px, 1 display px.
    expect(xLines()[0]).toBe(1);
    expect(xLines()[1]).toBeCloseTo(1 + 20.1, 9);
    await type(size, '40.4');
    await click(button(view, t('calibration.save')));
    expect(patches()[0]!.body).toEqual({
      grid: { size: 40.4, offset_x: 2, offset_y: 0, columns: 25, rows: 15 },
    });
  });

  it('continues from what the rectangle measured', async () => {
    const view = await open();
    await calibrate(view);
    await click(radio(view, t('calibration.method.rectangle')));
    drag(mapStage(), [50, 30], [110, 90]);
    await settle();
    await click(radio(view, t('calibration.method.fine')));
    expect(field(view, t('calibration.size')).value).toBe('40');
    expect(field(view, t('calibration.offsetX')).value).toBe('20');
  });
});

describe('the far-corner magnifier (specs/06-grid-and-measurement.md §1, specs/05-assets-and-images.md §7)', () => {
  it('draws the original, the calibration version, at the bottom-right corner with the draft grid', async () => {
    const view = await open();
    await calibrate(view);
    expect(images.requested).toEqual([imageFileUrl(map.id, 'display'), imageFileUrl(map.id, 'original')]);
    await settle();
    const box = view.querySelector<HTMLElement>('.eg-magnifier [role="img"]')!;
    expect(box.getAttribute('aria-label')).toBe(t('calibration.magnifier'));
    const corner = cornerStage()!.findOne<Konva.Image>('.corner')!;
    expect((corner.image() as HTMLImageElement).src).toBe(imageFileUrl(map.id, 'original'));
    // 1000 ÷ 30 columns ≈ 33.3 px until calibrated: three squares, 100 px, at the far corner.
    expect(corner.crop()).toEqual({ x: 900, y: 500, width: 100, height: 100 });
    await type(field(view, t('calibration.columns')), '25');
    // 40 px squares: a 120 px region, lines at 880, 920, 960, 1000 in it.
    expect(box.dataset.cropX).toBe('880');
    const zoom = MAGNIFIER_PX / 120;
    const xs = cornerStage()!
      .find<Konva.Line>('.corner-line-x')
      .map((line) => line.points()[0]);
    expect(xs).toEqual([0, 40, 80, 120].map((at) => at * zoom));
  });

  it('says so when the original cannot be loaded', async () => {
    images.failing.add(imageFileUrl(map.id, 'original'));
    const view = await open();
    await calibrate(view);
    await settle();
    expect(view.querySelector('.eg-magnifier__caption')!.textContent).toBe(t('calibration.magnifierFailed'));
  });
});

describe('cancelling, refusals and the map while calibrating', () => {
  it('cancels without sending anything, draws the stored grid again and returns focus', async () => {
    const view = await open();
    const stored = xLines();
    await calibrate(view);
    await type(field(view, t('calibration.columns')), '25');
    expect(xLines()).not.toEqual(stored);
    await click(button(view, t('calibration.cancel')));
    expect(patches()).toEqual([]);
    expect(xLines()).toEqual(stored);
    expect(document.activeElement).toBe(button(view, t('calibration.open')));
  });

  it('keeps the draft when the server refuses the save, saying why', async () => {
    server.before = (call) =>
      call.method === 'PATCH'
        ? { status: 409, body: { error: { code: 'calibration_needs_map', message: 'test' } } }
        : undefined;
    const view = await open();
    await calibrate(view);
    await type(field(view, t('calibration.columns')), '25');
    await click(button(view, t('calibration.save')));
    expect(view.querySelector('[role="alert"]')!.textContent).toBe(t('error.code.calibration_needs_map'));
    expect(view.querySelector('.eg-calibration')).not.toBeNull();
    expect(xLines()[1]).toBe(20);
  });

  it('refuses a save pressed twice while the first runs, with focus kept', async () => {
    let release: (reply?: Reply) => void = () => {};
    server.before = (call) =>
      call.method === 'PATCH' ? new Promise<Reply | undefined>((resolve) => (release = resolve)) : undefined;
    const view = await open();
    await calibrate(view);
    const save = button(view, t('calibration.save'))!;
    save.focus();
    await click(save);
    expect(save.getAttribute('aria-disabled')).toBe('true');
    await click(save);
    expect(patches()).toHaveLength(1);
    expect(document.activeElement).toBe(save);
    release();
    await settle();
    expect(view.querySelector('.eg-calibration')).toBeNull();
  });

  it('takes the place of the map and grid setup while calibrating, so the map cannot be replaced meanwhile', async () => {
    const view = await open();
    await calibrate(view);
    expect(view.querySelector('form')).toBeNull();
    expect(button(view, t('sceneMap.replace'))).toBeUndefined();
    expect(view.querySelector('input[type="checkbox"]')).toBeNull();
    await click(button(view, t('calibration.cancel')));
    expect(view.querySelector('form')).not.toBeNull();
  });
});

describe('replacing a calibrated map (D-093)', () => {
  const png = () => new File([new Uint8Array(100)], 'map.png', { type: 'image/png' });
  function choose(view: HTMLElement) {
    const input = view.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [png()] });
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  it('asks first, saying the calibration goes, and changes nothing when cancelled', async () => {
    scene.grid = { ...scene.grid, size: 40 };
    const before = structuredClone(scene);
    const view = await open();
    choose(view);
    await submit(view.querySelector('form'));
    const dialog = view.querySelector('dialog')!;
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.textContent).toContain(t('sceneMap.replaceCalibrated.heading'));
    expect(dialog.textContent).toContain(t('sceneMap.replaceCalibrated.body'));
    expect(server.writes()).toEqual([]);
    await click(button(dialog, t('sceneMap.replaceCalibrated.cancel')));
    expect(view.querySelector('dialog')).toBeNull();
    expect(server.writes()).toEqual([]);
    expect(server.scenes[0]).toEqual(before);
    expect(document.activeElement).toBe(button(view, t('sceneMap.replace')));
  });

  it('replaces the map once confirmed', async () => {
    scene.grid = { ...scene.grid, size: 40 };
    const view = await open();
    choose(view);
    await submit(view.querySelector('form'));
    await click(button(view.querySelector('dialog')!, t('sceneMap.replaceCalibrated.confirm')));
    expect(server.writes()).toEqual(['POST /api/images', `PATCH /api/scenes/${scene.id}`]);
    expect(server.scenes[0]!.map_image_id).not.toBe(map.id);
  });

  it('asks nothing for a map that was never calibrated', async () => {
    const view = await open();
    choose(view);
    await submit(view.querySelector('form'));
    expect(view.querySelector('dialog')).toBeNull();
    expect(server.writes()).toEqual(['POST /api/images', `PATCH /api/scenes/${scene.id}`]);
  });
});
