// @vitest-environment jsdom
import { act } from 'react';
import Konva from 'konva';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { imageFileUrl, type Scene } from '@emberglass/shared';
import { t } from '../ui/messages.js';
import { images, installCanvas2d, installImageLoading, installResizeObserver } from '../ui/testing/canvas2d.js';
import { button, click, FakeServer, installDialog, settle, type Reply } from '../ui/testing/fakeServer.js';
import { render, type Rendered } from '../ui/testing/render.js';
import { DmView } from './DmView.js';

// Switching scenes in the workspace while a request for the previous one is still running
// (PRP-02 review M-1, D-090, D-093): the panel is keyed by scene, so a late answer for scene
// A never shows on scene B, and B's controls act on B.

let server: FakeServer;
let rendered: Rendered | undefined;
let cave: Scene;
let hall: Scene;

beforeEach(() => {
  installDialog();
  installCanvas2d();
  installResizeObserver({ width: 800, height: 600 });
  installImageLoading();
  server = new FakeServer().install();
  const session = server.addSession(server.addCampaign('Lost Mine').id, 'One');
  cave = server.addScene(session.id, 'Cave');
  hall = server.addScene(session.id, 'Hall');
});

afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  server.uninstall();
});

async function open(): Promise<HTMLElement> {
  rendered = render(DmView);
  await settle();
  const view = rendered.container;
  await click(button(view, 'Lost Mine'));
  await click(button(view, 'One'));
  return view;
}

const main = (view: HTMLElement) => view.querySelector('main')!;
const gridBox = (view: HTMLElement) => main(view).querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const stage = () => Konva.stages.at(-1)!;

describe('switching scenes while a request runs', () => {
  it('drops the late answer of a map change for the scene it left, and acts on the new scene', async () => {
    const map = server.addImage({ width: 4000, height: 3000, variants: { display: { width: 2000, height: 1500 } } });
    let release: (reply?: Reply) => void = () => {};
    server.before = (call) =>
      call.method === 'PATCH' && call.path === `/api/scenes/${cave.id}`
        ? new Promise<Reply | undefined>((resolve) => (release = resolve))
        : undefined;
    const view = await open();
    await click(button(view, 'Cave'));
    act(() => gridBox(view).click());
    await settle();
    await click(button(view, 'Hall'));
    expect(main(view).querySelector('h1')!.textContent).toBe('Hall');
    // The answer for the cave arrives now, with a map: nothing of it reaches the hall.
    release({ status: 200, body: { ...cave, map_image_id: map.id, grid: { ...cave.grid, visible: false } } });
    await settle();
    expect(main(view).querySelector('h1')!.textContent).toBe('Hall');
    expect(stage().findOne('.extent')).toBeDefined();
    expect(stage().findOne('.map')).toBeUndefined();
    expect(images.requested).toEqual([]);
    expect(gridBox(view).checked).toBe(true);
    expect(gridBox(view).getAttribute('aria-disabled')).toBeNull();
    server.before = undefined;
    act(() => gridBox(view).click());
    await settle();
    expect(server.calls.at(-1)).toMatchObject({
      method: 'PATCH',
      path: `/api/scenes/${hall.id}`,
      body: { grid: { visible: false } },
    });
  });

  it('drops the late map record of the scene it left', async () => {
    const map = server.addImage();
    server.scenes.find((each) => each.id === cave.id)!.map_image_id = map.id;
    let release: (reply?: Reply) => void = () => {};
    server.before = (call) =>
      call.path === `/api/images/${map.id}`
        ? new Promise<Reply | undefined>((resolve) => (release = resolve))
        : undefined;
    const view = await open();
    await click(button(view, 'Cave'));
    await click(button(view, 'Hall'));
    release({ status: 200, body: map });
    await settle();
    expect(main(view).querySelector('h1')!.textContent).toBe('Hall');
    expect(stage().findOne('.extent')).toBeDefined();
    expect(images.requested).not.toContain(imageFileUrl(map.id, 'display'));
    expect(main(view).textContent).not.toContain(t('sceneMap.replace'));
  });
});
