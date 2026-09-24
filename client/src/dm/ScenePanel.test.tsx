// @vitest-environment jsdom
import { act, createElement } from 'react';
import Konva from 'konva';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { imageFileUrl, type GridPreset, type Scene } from '@emberglass/shared';
import { t } from '../ui/messages.js';
import { images, installCanvas2d, installImageLoading, installResizeObserver } from '../ui/testing/canvas2d.js';
import { button, FakeServer, settle, submit, type Reply } from '../ui/testing/fakeServer.js';
import { render, type Rendered } from '../ui/testing/render.js';
import { ScenePanel } from './ScenePanel.js';

// The selected scene's setup and canvas (PRP-02, specs/08-ux-journeys.md §1, §3,
// specs/06-grid-and-measurement.md §2, specs/03-domain-model.md §6, D-026, D-090, G-016, G-017),
// against a scripted server behind fetch and XMLHttpRequest.

const MiB = 1024 * 1024;
let server: FakeServer;
let rendered: Rendered | undefined;
let scene: Scene;

beforeEach(() => {
  installCanvas2d();
  installResizeObserver({ width: 800, height: 600 });
  installImageLoading();
  server = new FakeServer().install();
  const campaign = server.addCampaign('Lost Mine');
  const session = server.addSession(campaign.id, 'One');
  scene = server.addScene(session.id, 'Cave');
});

afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  server.uninstall();
});

async function open(uploadLimit = 50 * MiB, target: Scene = scene): Promise<HTMLElement> {
  rendered = render(createElement(ScenePanel, { sceneId: target.id, name: target.name, uploadLimit }));
  await settle();
  return rendered.container;
}

const fileInput = (view: HTMLElement) => view.querySelector<HTMLInputElement>('input[type="file"]')!;
const gridBox = (view: HTMLElement) => view.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const canvasState = (view: HTMLElement) => view.querySelector<HTMLElement>('[role="application"]')?.dataset;
const stage = () => Konva.stages.at(-1)!;

function choose(view: HTMLElement, file: File) {
  const input = fileInput(view);
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const png = (bytes: number) => new File([new Uint8Array(bytes)], 'map.png', { type: 'image/png' });

describe('the scene on the canvas (specs/08-ux-journeys.md §3)', () => {
  it('reads the scene from the server when it is selected and draws a map-less scene as its extent', async () => {
    const view = await open();
    expect(server.calls.map((call) => `${call.method} ${call.path}`)).toContain(`GET /api/scenes/${scene.id}`);
    expect(view.querySelector('h1')!.textContent).toBe('Cave');
    expect(fileInput(view).labels![0]!.textContent).toBe(t('sceneMap.image'));
    expect(stage().findOne('.extent')).toBeDefined();
    expect(stage().find('.grid-line')).toHaveLength(31 + 21);
    expect(canvasState(view)!.grid).toBe('shown');
  });

  it('draws the map the server knows, even when the tree held the scene from before it was attached', async () => {
    const map = server.addImage({ width: 4000, height: 3000, variants: { display: { width: 2000, height: 1500 } } });
    server.scenes[0]!.map_image_id = map.id;
    const view = await open();
    expect(server.calls.map((call) => call.path)).toContain(`/api/images/${map.id}`);
    expect(images.requested).toEqual([imageFileUrl(map.id, 'display')]);
    expect(stage().findOne('.map')).toBeDefined();
    expect(fileInput(view).labels![0]!.textContent).toBe(t('sceneMap.replaceImage'));
    expect(button(view, t('sceneMap.replace'))).toBeDefined();
  });

  it('says so when the map image cannot be loaded', async () => {
    const map = server.addImage();
    server.scenes[0]!.map_image_id = map.id;
    images.failing.add(imageFileUrl(map.id, 'display'));
    const view = await open();
    expect(view.textContent).toContain(t('sceneMap.loadFailed'));
  });
});

describe('attaching a map (specs/03-domain-model.md §5, §6, G-016, G-017)', () => {
  it('uploads the file and sets it as the map in the same action, then draws it', async () => {
    const preset: GridPreset = { ...scene.grid, size: 50, offset_x: 10, offset_y: 0, visible: false };
    server.uploadedImage = {
      width: 1000,
      height: 500,
      variants: { display: { width: 1000, height: 500 } },
      grid_preset: preset,
    };
    const view = await open();
    const file = png(2048);
    choose(view, file);
    await submit(view.querySelector('form'));
    expect(server.writes()).toEqual(['POST /api/images', `PATCH /api/scenes/${scene.id}`]);
    const image = server.images.at(-1)!;
    expect(server.uploads).toEqual([file]);
    expect(server.calls.find((call) => call.method === 'PATCH')!.body).toEqual({ map_image_id: image.id });
    await settle();
    expect(stage().findOne('.map')).toBeDefined();
    expect(images.requested).toEqual([imageFileUrl(image.id, 'display')]);
    // The new map's preset: hidden for players, so the DM sees it faintly.
    expect(canvasState(view)!.grid).toBe('faint');
    expect(gridBox(view).checked).toBe(false);
    expect(button(view, t('sceneMap.replace'))).toBeDefined();
  });

  it('refuses a file over the upload limit before sending anything, naming its size and the limit', async () => {
    const view = await open(2 * MiB);
    choose(view, png(3 * MiB));
    expect(view.textContent).toContain(t('sceneMap.tooLarge', { size: '3', limit: '2' }));
    await submit(view.querySelector('form'));
    expect(server.writes()).toEqual([]);
    expect(view.textContent).toContain(t('sceneMap.tooLarge', { size: '3', limit: '2' }));
  });

  it('asks for a file before sending', async () => {
    const view = await open();
    await submit(view.querySelector('form'));
    expect(view.textContent).toContain(t('sceneMap.required'));
    expect(server.writes()).toEqual([]);
  });

  it('shows the progress of the upload while it is sent, with the controls off, and clears it after', async () => {
    let release: (reply?: Reply) => void = () => {};
    server.uploadProgress = [0.25, 0.6];
    server.before = (call) =>
      call.path === '/api/images' ? new Promise<Reply | undefined>((resolve) => (release = resolve)) : undefined;
    const view = await open();
    choose(view, png(4096));
    await submit(view.querySelector('form'));
    const bar = view.querySelector('progress')!;
    expect(bar.getAttribute('aria-label')).toBe(t('sceneMap.uploading'));
    expect(bar.value).toBe(60);
    expect(view.textContent).toContain(t('sceneMap.progress', { percent: 60 }));
    expect(button(view, t('sceneMap.attach'))!.disabled).toBe(true);
    expect(fileInput(view).disabled).toBe(true);
    release();
    await settle();
    expect(view.querySelector('progress')).toBeNull();
    expect(server.writes()).toEqual(['POST /api/images', `PATCH /api/scenes/${scene.id}`]);
  });

  it('shows an upload refused by the server by its message and sets no map', async () => {
    server.before = (call) =>
      call.path === '/api/images'
        ? { status: 415, body: { error: { code: 'unsupported_media_type', message: 'test' } } }
        : undefined;
    const view = await open();
    choose(view, png(100));
    await submit(view.querySelector('form'));
    expect(view.textContent).toContain(t('error.code.unsupported_media_type'));
    expect(server.writes()).toEqual(['POST /api/images']);
    expect(view.querySelector('progress')).toBeNull();
    expect(button(view, t('sceneMap.attach'))!.disabled).toBe(false);
  });

  it('says the server did not answer when the upload never gets an answer', async () => {
    server.before = (call) => (call.path === '/api/images' ? Promise.reject(new TypeError('offline')) : undefined);
    const view = await open();
    choose(view, png(100));
    await submit(view.querySelector('form'));
    expect(view.textContent).toContain(t('error.code.network'));
  });

  it('shows a refused map change by its message, keeping the scene as it was', async () => {
    server.before = (call) =>
      call.method === 'PATCH'
        ? { status: 400, body: { error: { code: 'reference_not_found', message: 'test' } } }
        : undefined;
    const view = await open();
    choose(view, png(100));
    await submit(view.querySelector('form'));
    expect(view.textContent).toContain(t('error.code.reference_not_found'));
    expect(stage().findOne('.extent')).toBeDefined();
  });
});

describe('the grid for players (specs/06-grid-and-measurement.md §2, D-026)', () => {
  it('hides and shows the grid for players, and the DM keeps seeing it faintly', async () => {
    const view = await open();
    expect(gridBox(view).labels![0]!.textContent).toBe(t('sceneGrid.visible'));
    expect(gridBox(view).checked).toBe(true);
    act(() => gridBox(view).click());
    await settle();
    expect(server.calls.at(-1)).toMatchObject({ method: 'PATCH', body: { grid: { visible: false } } });
    expect(gridBox(view).checked).toBe(false);
    expect(canvasState(view)!.grid).toBe('faint');
    expect(stage().find('.grid-line').length).toBeGreaterThan(0);
    act(() => gridBox(view).click());
    await settle();
    expect(server.calls.at(-1)).toMatchObject({ method: 'PATCH', body: { grid: { visible: true } } });
    expect(canvasState(view)!.grid).toBe('shown');
  });

  it('shows the change at once while it is sent, with the checkbox off until the server answers', async () => {
    let release: (reply?: Reply) => void = () => {};
    server.before = (call) =>
      call.method === 'PATCH' ? new Promise<Reply | undefined>((resolve) => (release = resolve)) : undefined;
    const view = await open();
    act(() => gridBox(view).click());
    await settle();
    expect(gridBox(view).checked).toBe(false);
    expect(gridBox(view).disabled).toBe(true);
    // The canvas follows what the server stored, not the request.
    expect(canvasState(view)!.grid).toBe('shown');
    release();
    await settle();
    expect(gridBox(view).disabled).toBe(false);
    expect(canvasState(view)!.grid).toBe('faint');
  });

  it('keeps the checkbox as the server has it when the change is refused', async () => {
    server.before = (call) => (call.method === 'PATCH' ? Promise.reject(new TypeError('offline')) : undefined);
    const view = await open();
    act(() => gridBox(view).click());
    await settle();
    expect(gridBox(view).checked).toBe(true);
    expect(view.textContent).toContain(t('error.code.network'));
  });
});
