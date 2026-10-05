import { expect, test, type Page } from '@playwright/test';
import { selectScene, viewport } from './canvas-view.js';
import { openWorkspace, seedCampaign, signIn } from './dm.js';
import { solidPng } from './png.js';
import { commandFromPage } from './socket.js';

// UIX-01: the redesigned screens against the production server (specs/08-ux-journeys.md §1, §4, §11,
// Q-100), captured at the sizes of the design's boards, the DM view at 1440 × 900 and the TV at
// 1920 × 1080, and the TV again at 1280 × 720 with 2.5× zoom. Each capture is attached to the test's
// results for comparison with the boards of docs/inputs/Design.html; what the layout promises is asserted:
// the side panels keep their width and the map area takes the rest, and the TV's labels stay readable.

const player = (page: Page) => page.locator('main[data-view="player"]');
const tvCanvas = (page: Page) => page.locator('main[data-view="player"] .eg-canvas--player');

async function capture(page: Page, name: string) {
  // Once the fades have run; the idle glow's breaths and the live dot's pulses are not waited for.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => !['eg-ember', 'eg-live-pulse'].includes((animation as CSSAnimation).animationName))
        .map((animation) => animation.finished),
    ),
  );
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path });
  await test.info().attach(name, { path, contentType: 'image/png' });
}

test('the three screens at the boards’ sizes, the side panels at their widths and the TV readable at 720 lines', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const dmContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dm = await dmContext.newPage();
  await openWorkspace(dm);
  const names = { campaign: `Redesign ${Date.now()}`, session: 'Session 1', scene: 'Tavern common room' };
  const campaignId = await seedCampaign(dm, names.campaign, [names.session]);
  const [session] = (await (await dm.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as { id: string }[];
  const map = (await (
    await dm.request.post('/api/images', {
      data: solidPng(900, 720, [107, 74, 44]),
      headers: { 'content-type': 'application/octet-stream' },
    })
  ).json()) as { id: string };
  const scene = (await (
    await dm.request.post(`/api/sessions/${session!.id}/scenes`, { data: { name: names.scene, map_image_id: map.id } })
  ).json()) as { id: string };
  for (const name of ['Cellar', 'Road to Brenholt']) {
    await dm.request.post(`/api/sessions/${session!.id}/scenes`, { data: { name } });
  }
  const asset = async (name: string, category: string, colour: [number, number, number]) => {
    const image = (await (
      await dm.request.post('/api/images', {
        data: solidPng(64, 64, colour),
        headers: { 'content-type': 'application/octet-stream' },
      })
    ).json()) as { id: string };
    return (await (
      await dm.request.post('/api/assets', { data: { name, category, image_id: image.id, size: 'medium' } })
    ).json()) as { id: string };
  };
  const hero = await asset(`Deadeye ${Date.now()}`, 'pc', [70, 60, 50]);
  const bandit = await asset(`Bandit ${Date.now()}`, 'monster', [90, 40, 30]);
  await dm.request.post(`/api/scenes/${scene.id}/tokens`, { data: { asset_id: hero.id, x: 10, y: 10 } });
  await dm.request.post(`/api/scenes/${scene.id}/tokens`, { data: { asset_id: bandit.id, x: 16, y: 5 } });

  const tvContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tvContext.newPage();
  const smallContext = await browser.newContext({ viewport: { width: 512, height: 288 }, deviceScaleFactor: 2.5 });
  const small = await smallContext.newPage();
  try {
    // The idle TV (board 3).
    await tv.goto('/');
    await expect(player(tv)).toHaveAttribute('data-scene', 'idle');
    await tv.evaluate(() => document.fonts.ready);
    await capture(tv, 'player-idle-1920x1080');

    // The live DM view (board 1): the side panels keep their width, the map area takes the rest.
    await dm.reload();
    await selectScene(dm, names);
    await dm
      .getByRole('region', { name: 'Live scene' })
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    await expect(dm.locator('.eg-header')).toHaveCSS('height', '56px');
    expect((await dm.locator('.eg-workspace__sidebar').boundingBox())!.width).toBe(256);
    expect((await dm.locator('.eg-side').boundingBox())!.width).toBe(320);
    const map = (await dm.locator('main.eg-scene').boundingBox())!;
    expect(map.width).toBe(1440 - 256 - 320);
    await expect(viewport(dm)).toHaveAttribute('data-tv-frame', /"width"/);
    await capture(dm, 'dm-live-1440x900');
    // Wider: only the map area grows.
    await dm.setViewportSize({ width: 1920, height: 1080 });
    await expect.poll(async () => (await dm.locator('main.eg-scene').boundingBox())!.width).toBe(1920 - 256 - 320);
    expect((await dm.locator('.eg-side').boundingBox())!.width).toBe(320);

    // The live TV (board 2): the scene's name bottom left, and labels read across a room.
    await expect(tv.locator('.eg-player__plate')).toHaveText(names.scene);
    await expect(tv.locator('.eg-player__vignette')).toHaveCount(1);
    await capture(tv, 'player-live-1920x1080');

    // A 1280 × 720 TV at 2.5× zoom: the page fills it, and the scene's name is at least 22 CSS pixels, 55
    // device pixels. The token labels' size on the TV is `labelScaleFor`'s, which PlayerView.test.tsx checks.
    await small.goto('/');
    await expect(player(small)).toHaveAttribute('data-scene', 'live');
    const filled = (await tvCanvas(small).boundingBox())!;
    expect(filled).toEqual({ x: 0, y: 0, width: 512, height: 288 });
    const plate = await small
      .locator('.eg-player__plate-name')
      .evaluate((element) => getComputedStyle(element).fontSize);
    expect(parseFloat(plate)).toBeGreaterThanOrEqual(22);
    await capture(small, 'player-live-1280x720-zoom-2.5');
  } finally {
    await commandFromPage(dm, 'scene.deactivate', {}).catch(() => undefined);
    const summary = await dm.request.get(`/api/campaigns/${campaignId}/deletion`);
    if (summary.ok()) {
      await dm.request.delete(`/api/campaigns/${campaignId}`, { data: { confirm: (await summary.json()) as object } });
    }
    for (const id of [hero.id, bandit.id]) await dm.request.delete(`/api/assets/${id}`);
    await dmContext.close();
    await tvContext.close();
    await smallContext.close();
  }
});

test('the scene sidebar starts collapsed at the edge, opens over the map on hover, closes on leaving and docks by its pin', async ({
  browser,
}) => {
  // A browser that never pinned it: the default of Q-121.
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: { cookies: [], origins: [] },
  });
  const dm = await context.newPage();
  try {
    await signIn(dm);
    await dm.goto('/dm');
    await expect(dm.locator('.eg-header__crumbs')).toBeVisible();
    const dock = dm.locator('.eg-dock');
    const scenes = dm.getByRole('navigation', { name: 'Scenes of this session' });
    const strip = dm.getByRole('button', { name: 'Show scenes' });
    await expect(dock).toHaveAttribute('data-sidebar', 'collapsed');
    await expect(scenes).toBeHidden();
    // Collapsed, the map takes the sidebar's width; open, it keeps its size under the sidebar.
    const collapsed = (await dm.locator('main.eg-scene').boundingBox())!;
    expect(collapsed.width).toBe(1440 - 56 - 320);

    const edge = (await strip.boundingBox())!;
    await dm.mouse.move(edge.x + edge.width / 2, edge.y + 200);
    await expect(dock).toHaveAttribute('data-sidebar', 'open');
    await expect(scenes).toBeVisible();
    expect((await dm.locator('main.eg-scene').boundingBox())!.width).toBe(collapsed.width);
    await capture(dm, 'dm-sidebar-open-1440x900');
    await dm.mouse.move(900, 450);
    await expect(dock).toHaveAttribute('data-sidebar', 'collapsed');
    await expect(scenes).toBeHidden();

    // A click opens it until it is closed again; the pin docks it, and a reload keeps it docked.
    await strip.click();
    await dm.mouse.move(900, 450);
    await expect(scenes).toBeVisible();
    await dm.getByRole('button', { name: 'Keep scenes open' }).click();
    await expect(dock).toHaveAttribute('data-sidebar', 'pinned');
    await dm.reload();
    await expect(dock).toHaveAttribute('data-sidebar', 'pinned');
    expect((await dm.locator('.eg-workspace__sidebar').boundingBox())!.width).toBe(256);
    expect((await dm.locator('main.eg-scene').boundingBox())!.width).toBe(1440 - 256 - 320);
    await dm.getByRole('button', { name: 'Let scenes collapse' }).click();
    await expect(dock).toHaveAttribute('data-sidebar', 'collapsed');
    await expect(strip).toBeFocused();
  } finally {
    await context.close();
  }
});
