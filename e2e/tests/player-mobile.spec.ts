import { devices, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { selectScene, viewport } from './canvas-view.js';
import { openWorkspace, seedCampaign } from './dm.js';
import { solidPng } from './png.js';

// UXR-05 (specs/08-ux-journeys.md §7, §9, §14, specs/10-testing-acceptance.md §4, Q-125): the player view on an
// emulated phone and tablet. It fills the screen without scrolling, the initiative strip fits, a fullscreen button
// is there, a pinch zooms that screen only and a double tap or its button returns it to the DM's camera; a phone
// connected before the TV never sets the TV frame's shape.

const player = (page: Page) => page.locator('main[data-view="player"]');
const canvas = (page: Page) => page.locator('.eg-canvas--player');
const scaleOf = async (page: Page) => Number(await canvas(page).getAttribute('data-camera-scale'));

// Two fingers moving apart, then lifted, as pointer events on the map: Playwright's touchscreen taps only.
async function pinchOut(page: Page) {
  await canvas(page).evaluate((element) => {
    const box = element.getBoundingClientRect();
    const y = box.top + box.height / 2;
    const x = box.left + box.width / 2;
    const fire = (type: string, pointerId: number, clientX: number) =>
      element.dispatchEvent(
        new PointerEvent(type, { pointerId, pointerType: 'touch', clientX, clientY: y, bubbles: true }),
      );
    fire('pointerdown', 11, x - 40);
    fire('pointerdown', 12, x + 40);
    fire('pointermove', 12, x + 120);
    fire('pointerup', 11, x - 40);
    fire('pointerup', 12, x + 120);
  });
}
async function doubleTap(page: Page) {
  await canvas(page).evaluate((element) => {
    const box = element.getBoundingClientRect();
    const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
    const fire = (type: string) =>
      element.dispatchEvent(new PointerEvent(type, { pointerId: 21, pointerType: 'touch', bubbles: true, ...at }));
    fire('pointerdown');
    fire('pointerup');
    fire('pointerdown');
    fire('pointerup');
  });
}

// A device's screen, touch and user agent, in the browser this project runs.
function device(name: string) {
  const { defaultBrowserType, ...options } = devices[name]!;
  void defaultBrowserType;
  return options;
}

async function seed(dm: Page) {
  const stamp = Date.now();
  const names = { campaign: `Mobile UXR-05 ${stamp}`, session: 'Night', scene: 'Market square' };
  const campaignId = await seedCampaign(dm, names.campaign, [names.session]);
  const [session] = (await (await dm.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as { id: string }[];
  const upload = async (width: number, height: number, colour: [number, number, number]) =>
    (await (
      await dm.request.post('/api/images', {
        data: solidPng(width, height, colour),
        headers: { 'content-type': 'application/octet-stream' },
      })
    ).json()) as { id: string };
  const scene = (await (
    await dm.request.post(`/api/sessions/${session!.id}/scenes`, {
      data: { name: names.scene, map_image_id: (await upload(900, 600, [70, 60, 40])).id },
    })
  ).json()) as { id: string };
  for (const [index, name] of ['Ash', 'Birch', 'Cedar', 'Dogwood', 'Elm', 'Fir'].entries()) {
    const asset = (await (
      await dm.request.post('/api/assets', {
        data: {
          name: `${name} ${stamp}`,
          image_id: (await upload(64, 64, [40 * index, 100, 140])).id,
          category: 'pc',
          size: 'medium',
        },
      })
    ).json()) as { id: string };
    await dm.request.post(`/api/scenes/${scene.id}/tokens`, { data: { asset_id: asset.id, x: 2 + index, y: 3 } });
  }
  return names;
}

test('the player view on a phone and a tablet: the whole screen, fullscreen, its own pinch zoom, and no say in the TV frame', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const dmContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dm = await dmContext.newPage();
  const contexts: BrowserContext[] = [dmContext];
  const open = async (b: Browser, options: Parameters<Browser['newContext']>[0]) => {
    const context = await b.newContext(options);
    contexts.push(context);
    const page = await context.newPage();
    await page.goto('/');
    await expect(player(page)).toHaveAttribute('data-live', 'connected');
    return page;
  };
  try {
    await openWorkspace(dm);
    const names = await seed(dm);
    // The phone first, then the TV: the frame must still take the TV's shape.
    const phone = await open(browser, device('Pixel 7'));
    const tv = await open(browser, { viewport: { width: 1920, height: 1080 } });
    const tablet = await open(browser, device('iPad Mini'));

    await dm.reload();
    await selectScene(dm, names);
    await dm
      .getByRole('region', { name: 'Live scene' })
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await dm.getByRole('tab', { name: /^Initiative/ }).click();
    await dm.getByRole('button', { name: 'Start combat' }).click();

    for (const page of [phone, tablet]) {
      await expect(player(page)).toHaveAttribute('data-scene', 'live');
      await expect(player(page)).toHaveAttribute('data-handheld', 'true');
      const size = page.viewportSize()!;
      // The map fills the screen and nothing scrolls sideways.
      expect(await canvas(page).boundingBox()).toEqual({ x: 0, y: 0, width: size.width, height: size.height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
      // The strip fits inside the screen.
      const strip = (await page.locator('.eg-player__initiative').boundingBox())!;
      expect(strip.x).toBeGreaterThanOrEqual(0);
      expect(strip.x + strip.width).toBeLessThanOrEqual(size.width);
      await expect(page.getByRole('button', { name: 'Full screen' })).toBeVisible();
    }
    // A TV has no controls at all (Q-054).
    await expect(player(tv)).not.toHaveAttribute('data-handheld', 'true');
    await expect(tv.locator('button')).toHaveCount(0);

    // A pinch on the phone zooms the phone only; its button and a double tap take it back.
    const fitted = await scaleOf(phone);
    const tvScale = await scaleOf(tv);
    await pinchOut(phone);
    await expect.poll(() => scaleOf(phone)).toBeCloseTo(fitted * 2, 5);
    expect(await scaleOf(tv)).toBe(tvScale);
    await phone.getByRole('button', { name: 'Back to the table view' }).click();
    await expect.poll(() => scaleOf(phone)).toBeCloseTo(fitted, 9);
    await pinchOut(phone);
    await expect.poll(() => scaleOf(phone)).toBeGreaterThan(fitted);
    await doubleTap(phone);
    await expect.poll(() => scaleOf(phone)).toBeCloseTo(fitted, 9);

    // The DM's frame has the TV's shape, not the phone's that connected first.
    const frame = JSON.parse((await viewport(dm).getAttribute('data-tv-frame'))!) as { width: number; height: number };
    expect(Math.round((frame.width / frame.height) * 100) / 100).toBe(Math.round((1920 / 1080) * 100) / 100);

    await phone.mouse.click(5, 5);
    await phone.screenshot({ path: test.info().outputPath('player-phone.png') });
    await tablet.screenshot({ path: test.info().outputPath('player-tablet.png') });
    await dm.getByRole('button', { name: 'End combat' }).click();
    await dm.getByRole('dialog').getByRole('button', { name: 'End combat' }).click();
    await dm.getByRole('region', { name: 'Live scene' }).getByRole('button', { name: 'Go idle' }).click();
  } finally {
    for (const context of contexts) await context.close();
  }
});
