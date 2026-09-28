import { expect, test, type Page } from '@playwright/test';
import { cameraOf, selectScene, viewport, type Camera } from './canvas-view.js';
import { openWorkspace, seedCampaign } from './dm.js';
import { solidPng } from './png.js';

// LIV-06: steering the TV camera from the DM view against the production server (specs/04-live-sync.md
// §2, §3, §9, specs/08-ux-journeys.md §2, Q-038, Q-080, D-046, D-119). A DM context and a player
// context at once: dragging the TV frame's edge and resizing it by a corner change what the player
// context shows, the DM's own view does not move, and going live on another scene fits the TV again.

const player = (page: Page) => page.locator('main[data-view="player"]');
const tvCanvas = (page: Page) => page.locator('main[data-view="player"] .eg-canvas--player');
const panel = (page: Page) => page.locator('main .eg-scene');
const liveBar = (page: Page) => page.getByRole('region', { name: 'Live scene' });

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

async function tvCamera(page: Page): Promise<Camera> {
  return tvCanvas(page).evaluate((element: HTMLElement) => ({
    x: Number(element.dataset.cameraX),
    y: Number(element.dataset.cameraY),
    scale: Number(element.dataset.cameraScale),
  }));
}

/** The TV frame in the DM's canvas, in pixels from the canvas's corner. */
async function frameIn(page: Page): Promise<Box> {
  return JSON.parse((await viewport(page).getAttribute('data-tv-frame'))!) as Box;
}

/** The TV frame on the page, where the pointer grabs it; the canvas moves when a status line appears. */
async function frameOf(page: Page): Promise<Box> {
  const origin = (await viewport(page).boundingBox())!;
  const frame = await frameIn(page);
  return { ...frame, left: origin.x + frame.left, top: origin.y + frame.top };
}

async function dragFrom(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

/** Fit-to-map, as `client/src/canvas/geometry.ts` `fitCamera` computes it. */
function fitted(world: { width: number; height: number }, screen: { width: number; height: number }): Camera {
  const scale = Math.min(screen.width / world.width, screen.height / world.height);
  return { scale, x: (screen.width - world.width * scale) / 2, y: (screen.height - world.height * scale) / 2 };
}

const near = (actual: Camera, expected: Camera) => {
  expect(actual.scale).toBeCloseTo(expected.scale, 4);
  expect(actual.x).toBeCloseTo(expected.x, 1);
  expect(actual.y).toBeCloseTo(expected.y, 1);
};

test('the DM steers the TV by moving and resizing its frame, the DM’s view stays, and another scene going live fits the TV again', async ({
  browser,
}) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const tv = await playerContext.newPage();
  await openWorkspace(dm);

  const names = { campaign: `Cameras LIV-06 ${Date.now()}`, session: 'Steering night', scene: 'Watchtower' };
  const campaignId = await seedCampaign(dm, names.campaign, [names.session]);
  const [session] = (await (await dm.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as { id: string }[];
  const createScene = async (name: string) =>
    (await (await dm.request.post(`/api/sessions/${session!.id}/scenes`, { data: { name } })).json()) as {
      id: string;
    };
  const tower = await createScene(names.scene);
  await createScene('Fog');
  const map = (await (
    await dm.request.post('/api/images', {
      data: solidPng(600, 400, [40, 70, 50]),
      headers: { 'content-type': 'application/octet-stream' },
    })
  ).json()) as { id: string };
  expect((await dm.request.patch(`/api/scenes/${tower.id}`, { data: { map_image_id: map.id } })).ok()).toBe(true);
  await dm.reload();

  try {
    await tv.goto('/');
    await expect(player(tv)).toHaveAttribute('data-scene', 'idle');
    const screen = tv.viewportSize()!;

    await selectScene(dm, names);
    await liveBar(dm)
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await expect(panel(dm)).toHaveAttribute('data-mode', 'live');
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    // The TV starts fitted to the map (specs/04-live-sync.md §9).
    await expect.poll(async () => (await tvCamera(tv)).scale).toBeGreaterThan(0);
    const start = await tvCamera(tv);
    near(start, fitted({ width: 600, height: 400 }, screen));
    // The frame has the TV's shape, which the TV reported (D-119).
    await expect
      .poll(async () => {
        const frame = await frameIn(dm);
        return Math.round((frame.width / frame.height) * 1000) / 1000;
      })
      .toBe(Math.round((screen.width / screen.height) * 1000) / 1000);

    // The DM's own view zoomed out, so the whole frame is on screen to grab.
    await viewport(dm).focus();
    await dm.keyboard.press('-');
    await dm.keyboard.press('-');
    const dmView = await cameraOf(dm);

    // Drag the frame by its top edge up and to the left: the TV pans, the DM's view does not move. The
    // camera's centre stays on the map (the contract's bounds), so the steps stay well inside it.
    const before = await frameOf(dm);
    const beforeIn = await frameIn(dm);
    await dragFrom(
      dm,
      { x: before.left + before.width / 2, y: before.top },
      {
        x: before.left + before.width / 2 - 30,
        y: before.top - 20,
      },
    );
    await expect.poll(async () => (await tvCamera(tv)).x).not.toBeCloseTo(start.x, 0);
    const panned = await tvCamera(tv);
    expect(panned.scale).toBeCloseTo(start.scale, 4);
    // The frame went left and up by the drag, so the map moved right and down on the TV.
    const movedIn = await frameIn(dm);
    expect(movedIn.left - beforeIn.left).toBeCloseTo(-30, 0);
    expect(movedIn.top - beforeIn.top).toBeCloseTo(-20, 0);
    expect(panned.x).toBeGreaterThan(start.x);
    expect(panned.y).toBeGreaterThan(start.y);
    expect(await cameraOf(dm)).toEqual(dmView);
    await expect(panel(dm).getByRole('status')).toHaveText('The TV now shows the part of the map in the frame.');

    // Resize it by its bottom-right corner to half its width: the TV zooms in, the opposite corner
    // stays, and the DM's view does not move.
    const moved = await frameOf(dm);
    await dragFrom(
      dm,
      { x: moved.left + moved.width, y: moved.top + moved.height },
      {
        x: moved.left + moved.width / 2,
        y: moved.top + moved.height / 2,
      },
    );
    await expect.poll(async () => (await tvCamera(tv)).scale).toBeGreaterThan(panned.scale * 1.5);
    const resized = await frameIn(dm);
    expect(resized.width / resized.height).toBeCloseTo(movedIn.width / movedIn.height, 2);
    expect(resized.width).toBeCloseTo(movedIn.width / 2, 0);
    expect(resized.left).toBeCloseTo(movedIn.left, 0);
    expect(resized.top).toBeCloseTo(movedIn.top, 0);
    expect(await cameraOf(dm)).toEqual(dmView);

    // Another scene goes live: the TV is fitted to its grid extent (30 × 20 squares of 64 pixels).
    await dm
      .getByRole('navigation', { name: 'Campaigns, sessions and scenes' })
      .getByRole('button', { name: 'Fog', exact: true })
      .click();
    await liveBar(dm).getByRole('button', { name: 'Go live: Fog' }).click();
    await expect(liveBar(dm).getByRole('status')).toHaveText('Live: Fog');
    await expect
      .poll(async () => (await tvCamera(tv)).scale)
      .toBeCloseTo(fitted({ width: 1920, height: 1280 }, screen).scale, 4);
    near(await tvCamera(tv), fitted({ width: 1920, height: 1280 }, screen));

    // And the first scene live again is fitted to its map, not where it was steered.
    await dm
      .getByRole('navigation', { name: 'Campaigns, sessions and scenes' })
      .getByRole('button', { name: names.scene, exact: true })
      .click();
    await liveBar(dm)
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await expect.poll(async () => (await tvCamera(tv)).scale).toBeCloseTo(start.scale, 4);
    near(await tvCamera(tv), start);
  } finally {
    // Leave no campaign behind: the keyboard walk (keyboard.spec.ts) visits every control of the tree,
    // and each campaign an earlier spec leaves adds to its time budget.
    const summary = await dm.request.get(`/api/campaigns/${campaignId}/deletion`);
    if (summary.ok()) {
      await dm.request.delete(`/api/campaigns/${campaignId}`, { data: { confirm: (await summary.json()) as object } });
    }
    await dmContext.close();
    await playerContext.close();
  }
});
