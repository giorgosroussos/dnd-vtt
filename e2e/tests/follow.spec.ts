import { expect, test, type Locator, type Page } from '@playwright/test';
import { cameraOf, sceneRow, selectScene, viewport, type Camera } from './canvas-view.js';
import { openWorkspace, seedCampaign } from './dm.js';
import { solidPng } from './png.js';

// DMT-03: Follow my view against the production server (specs/04-live-sync.md §9, specs/08-ux-journeys.md §11,
// §13, Q-113, Q-120). A DM context and a player context at once: with Follow my view on, the TV follows the
// DM's pans and zooms and shows at least everything the DM's view shows; Lock TV camera, a manual TV camera
// control and another scene going live each turn it off; opening another scene to prepare pauses it, and
// returning to the live scene sends the view at once.

const player = (page: Page) => page.locator('main[data-view="player"]');
const tvCanvas = (page: Page) => page.locator('main[data-view="player"] .eg-canvas--player');
const panel = (page: Page) => page.locator('main.eg-scene');
const liveBar = (page: Page) => page.getByRole('region', { name: 'Live scene' });
const followButton = (page: Page) => page.getByRole('button', { name: 'Follow my view' });

interface WorldBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The part of the world a canvas shows, from its camera and its size on the page. */
async function shown(camera: Camera, canvas: Locator): Promise<WorldBox> {
  // The camera is in pixels of the canvas's inside, without its border.
  const box = await canvas.evaluate((element: HTMLElement) => ({
    width: element.clientWidth,
    height: element.clientHeight,
  }));
  return {
    left: -camera.x / camera.scale,
    top: -camera.y / camera.scale,
    right: (box.width - camera.x) / camera.scale,
    bottom: (box.height - camera.y) / camera.scale,
  };
}

async function tvCamera(page: Page): Promise<Camera> {
  return tvCanvas(page).evaluate((element: HTMLElement) => ({
    x: Number(element.dataset.cameraX),
    y: Number(element.dataset.cameraY),
    scale: Number(element.dataset.cameraScale),
  }));
}

/** How far the TV is from showing the whole of the DM's view: 0 once it shows all of it, in world pixels. */
async function cropped(dm: Page, tv: Page): Promise<number> {
  const mine = await shown(await cameraOf(dm), viewport(dm));
  const theirs = await shown(await tvCamera(tv), tvCanvas(tv));
  return Math.max(
    0,
    theirs.left - mine.left,
    theirs.top - mine.top,
    mine.right - theirs.right,
    mine.bottom - theirs.bottom,
  );
}

/** How much more the TV shows than the DM's view along the tighter axis: about 0 when widened, not zoomed out. */
async function slack(dm: Page, tv: Page): Promise<number> {
  const mine = await shown(await cameraOf(dm), viewport(dm));
  const theirs = await shown(await tvCamera(tv), tvCanvas(tv));
  const across = theirs.right - theirs.left - (mine.right - mine.left);
  const down = theirs.bottom - theirs.top - (mine.bottom - mine.top);
  return Math.min(across, down);
}

/** The TV shows exactly the DM's view widened to its shape: nothing cropped, nothing extra on the tight axis. */
async function expectFollowing(dm: Page, tv: Page) {
  await expect.poll(() => cropped(dm, tv), { timeout: 5_000 }).toBeLessThan(1);
  await expect.poll(() => slack(dm, tv), { timeout: 5_000 }).toBeLessThan(2);
}

/** The TV's camera once it has settled: read twice, a glide apart. */
async function settledTv(tv: Page): Promise<Camera> {
  let last = await tvCamera(tv);
  await expect
    .poll(async () => {
      const next = await tvCamera(tv);
      const same = next.x === last.x && next.y === last.y && next.scale === last.scale;
      last = next;
      return same;
    })
    .toBe(true);
  return last;
}

/** The TV's camera stays where it is while the DM's view moves. */
async function expectTvStays(dm: Page, tv: Page, keys: string[]) {
  const before = await settledTv(tv);
  await viewport(dm).focus();
  for (const key of keys) await dm.keyboard.press(key);
  // Longer than the throttle's interval and the TV's glide together.
  await dm.waitForTimeout(600);
  expect(await tvCamera(tv)).toEqual(before);
}

test('the TV follows the DM’s view without cropping it, until Lock, a TV control or another live scene turns it off; another scene opened pauses it', async ({
  browser,
}) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const tv = await playerContext.newPage();
  await openWorkspace(dm);

  const names = { campaign: `Follow DMT-03 ${Date.now()}`, session: 'Chase night', scene: 'Rooftops' };
  const campaignId = await seedCampaign(dm, names.campaign, [names.session]);
  const [session] = (await (await dm.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as { id: string }[];
  const createScene = async (name: string) =>
    (await (await dm.request.post(`/api/sessions/${session!.id}/scenes`, { data: { name } })).json()) as {
      id: string;
    };
  const roofs = await createScene(names.scene);
  await createScene('Alley');
  const map = (await (
    await dm.request.post('/api/images', {
      data: solidPng(1200, 800, [60, 50, 80]),
      headers: { 'content-type': 'application/octet-stream' },
    })
  ).json()) as { id: string };
  expect((await dm.request.patch(`/api/scenes/${roofs.id}`, { data: { map_image_id: map.id } })).ok()).toBe(true);
  await dm.reload();

  try {
    await tv.goto('/');
    await expect(player(tv)).toHaveAttribute('data-scene', 'idle');
    await selectScene(dm, names);
    await liveBar(dm)
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await expect(panel(dm)).toHaveAttribute('data-mode', 'live');
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    await expect.poll(async () => (await tvCamera(tv)).scale).toBeGreaterThan(0);

    // Off at activation; turned on, the TV takes the DM's view at once, and the live indicator says so.
    await expect(followButton(dm)).toHaveAttribute('aria-pressed', 'false');
    await followButton(dm).click();
    await expect(followButton(dm)).toHaveAttribute('aria-pressed', 'true');
    await expect(liveBar(dm)).toContainText('TV follows you');
    await expect(viewport(dm)).toHaveAttribute('data-tv-follow', 'on');
    await expectFollowing(dm, tv);

    // A zoom in and a pan of the DM's own view: the TV follows, cropping nothing.
    await viewport(dm).focus();
    await dm.keyboard.press('+');
    await dm.keyboard.press('+');
    await dm.keyboard.press('ArrowRight');
    await dm.keyboard.press('ArrowDown');
    await expectFollowing(dm, tv);
    // A drag pan with the pointer, and a zoom out.
    const canvasBox = (await viewport(dm).boundingBox())!;
    const from = { x: canvasBox.x + canvasBox.width * 0.6, y: canvasBox.y + canvasBox.height * 0.5 };
    await dm.mouse.move(from.x, from.y);
    await dm.mouse.down();
    await dm.mouse.move(from.x - 60, from.y - 30, { steps: 8 });
    await dm.mouse.up();
    await dm.keyboard.press('-');
    await expectFollowing(dm, tv);
    await expect(followButton(dm)).toHaveAttribute('aria-pressed', 'true');

    // Lock TV camera turns it off, and the DM's view moves alone again.
    await dm.getByRole('button', { name: 'Lock TV camera' }).click();
    await expect(followButton(dm)).toHaveAttribute('aria-pressed', 'false');
    await expect(followButton(dm)).toHaveAttribute('aria-disabled', 'true');
    await expectTvStays(dm, tv, ['ArrowLeft', '+']);
    await dm.getByRole('button', { name: 'Lock TV camera' }).click();

    // A manual TV camera control turns it off: TV zoom in acts on the TV, then the DM's view moves alone.
    await followButton(dm).click();
    await expectFollowing(dm, tv);
    const before = await settledTv(tv);
    await dm.getByRole('button', { name: 'TV zoom in' }).click();
    await expect(followButton(dm)).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await tvCamera(tv)).scale).toBeGreaterThan(before.scale * 1.1);
    await expect(viewport(dm)).not.toHaveAttribute('data-tv-follow', 'on');
    await expectTvStays(dm, tv, ['ArrowUp', '-']);

    // Another scene opened to prepare pauses it: nothing reaches the TV; back on the live scene, the view goes at once.
    await followButton(dm).click();
    await expectFollowing(dm, tv);
    await sceneRow(dm, 'Alley').click();
    await expect(panel(dm)).toHaveAttribute('data-mode', 'prep');
    await expect(liveBar(dm)).toContainText('Follow paused');
    await expectTvStays(dm, tv, ['+', 'ArrowRight', 'ArrowRight']);
    await liveBar(dm)
      .getByRole('button', { name: `Players see ${names.scene}: show the live scene` })
      .click();
    await expect(panel(dm)).toHaveAttribute('data-mode', 'live');
    await expect(followButton(dm)).toHaveAttribute('aria-pressed', 'true');
    await expect(liveBar(dm)).toContainText('TV follows you');
    await expectFollowing(dm, tv);

    // Another scene going live turns it off, and it starts off there.
    await sceneRow(dm, 'Alley').click();
    await liveBar(dm).getByRole('button', { name: 'Go live: Alley' }).click();
    await expect(liveBar(dm).getByRole('status')).toHaveText('Players see Alley');
    await expect(panel(dm)).toHaveAttribute('data-mode', 'live');
    await expect(followButton(dm)).toHaveAttribute('aria-pressed', 'false');
    await expect(liveBar(dm)).not.toContainText('TV follows you');
    await expectTvStays(dm, tv, ['+', 'ArrowLeft']);
  } finally {
    // Leave no campaign behind: the keyboard walk (keyboard.spec.ts) visits every control of the tree.
    const summary = await dm.request.get(`/api/campaigns/${campaignId}/deletion`);
    if (summary.ok()) {
      await dm.request.delete(`/api/campaigns/${campaignId}`, { data: { confirm: (await summary.json()) as object } });
    }
    await dmContext.close();
    await playerContext.close();
  }
});
