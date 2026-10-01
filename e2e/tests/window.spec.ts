import { expect, test, type Page } from '@playwright/test';
import { openSetup, selectScene, viewport } from './canvas-view.js';
import { openWorkspace, seedCampaign, E2E_PIN } from './dm.js';
import { solidPng } from './png.js';
import { calibrationPanel, newAsset, pick, saveCalibration, squareCentre, tokensOf, unique } from './prep.js';

// REL-03, G-041 (specs/08-ux-journeys.md §7): the DM view in a laptop's window. A 1080p laptop at Windows'
// default 150% scaling leaves the page about 1,280 × 620 CSS pixels once the browser's toolbars and the
// taskbar are counted. There, calibrating, placing a token and changing the PIN are done with the canvas
// and the Settings dialog whole on screen: the page never scrolls, the canvas's tool rail stays on the
// canvas and above its grid status, and the dialog shows every control without scrolling inside it.

const WIDTH = 1280;
const HEIGHT = 620;

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Where the page's parts are, and whether the page or the dialog scrolls. */
async function layout(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string): Box | null => {
      const found = document.querySelector(selector);
      if (!found) return null;
      const { top, bottom, left, right } = found.getBoundingClientRect();
      return { top, bottom, left, right };
    };
    const dialog = document.querySelector('dialog[open]');
    return {
      window: [window.innerWidth, window.innerHeight],
      pageScrolls:
        document.documentElement.scrollHeight > window.innerHeight ||
        document.documentElement.scrollWidth > window.innerWidth,
      canvas: box('main [role="application"]'),
      rail: box('.eg-rail'),
      status: box('.eg-canvas__status'),
      magnifier: box('.eg-magnifier'),
      dialog: box('dialog[open]'),
      dialogScrolls: dialog ? dialog.scrollHeight > dialog.clientHeight + 1 : null,
    };
  });
}

const within = (inner: Box, outer: Box) =>
  inner.top >= outer.top && inner.bottom <= outer.bottom && inner.left >= outer.left && inner.right <= outer.right;
const screen: Box = { top: 0, bottom: HEIGHT, left: 0, right: WIDTH };

/** A control is on screen, unscrolled, and not covered: a click at its centre reaches it. */
async function reachable(page: Page, name: string, scope = page.locator('body')) {
  const control = scope.getByRole('button', { name, exact: true });
  const box = (await control.boundingBox())!;
  expect(within({ top: box.y, bottom: box.y + box.height, left: box.x, right: box.x + box.width }, screen)).toBe(true);
  await control.click({ trial: true });
}

test('the DM view at a laptop’s 1,280 × 620: calibration, token placement and the PIN change without scrolling', async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1.5 });
  const page = await context.newPage();
  await openWorkspace(page);
  const names = { campaign: `Laptop ${unique()}`, session: 'Session 1', scene: 'Hall' };
  const campaignId = await seedCampaign(page, names.campaign, [names.session]);
  const [session] = (await (await page.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as {
    id: string;
  }[];
  const map = (await (
    await page.request.post('/api/images', {
      data: solidPng(1000, 720, [96, 70, 48 + (Date.now() % 50)]),
      headers: { 'content-type': 'application/octet-stream' },
    })
  ).json()) as { id: string };
  const scene = (await (
    await page.request.post(`/api/sessions/${session!.id}/scenes`, {
      data: { name: names.scene, map_image_id: map.id },
    })
  ).json()) as { id: string };
  const asset = `Laptop scout ${unique()}`;
  await newAsset(page, asset, { category: 'npc', size: 'medium' }, [40, 90, 60]);

  try {
    await page.reload();
    await selectScene(page, names);

    // Preparing: the canvas whole on screen, the rail above the grid status.
    let now = await layout(page);
    expect(now.window).toEqual([WIDTH, HEIGHT]);
    expect(now.pageScrolls).toBe(false);
    expect(within(now.canvas!, screen)).toBe(true);
    expect(now.rail!.bottom).toBeLessThanOrEqual(now.status!.top);

    // The scene's setup open leaves the canvas shorter: the rail still ends above the grid status,
    // on the canvas, and the page still does not scroll.
    await openSetup(page);
    await expect(page.getByRole('button', { name: 'Calibrate grid' })).toBeVisible();
    now = await layout(page);
    expect(now.pageScrolls).toBe(false);
    expect(within(now.canvas!, screen)).toBe(true);
    expect(within(now.rail!, now.canvas!)).toBe(true);
    expect(now.rail!.bottom).toBeLessThanOrEqual(now.status!.top);

    // Calibrating: the panel, the whole canvas and the magnifier inside it, unscrolled.
    await page.getByRole('button', { name: 'Calibrate grid' }).click();
    await expect(calibrationPanel(page).getByLabel('Known dimensions')).toBeChecked();
    await expect(page.locator('.eg-magnifier')).toBeVisible();
    now = await layout(page);
    expect(now.pageScrolls).toBe(false);
    expect(within(now.canvas!, screen)).toBe(true);
    expect(within(now.magnifier!, now.canvas!)).toBe(true);
    await calibrationPanel(page).getByLabel('Columns').fill('25');
    await calibrationPanel(page).getByLabel('Rows').fill('18');
    await reachable(page, 'Save calibration', calibrationPanel(page));
    await saveCalibration(page);

    // Placing a token: picked from Add token, dropped on a square, with the canvas on screen throughout.
    await page.getByRole('button', { name: 'Scene setup' }).click();
    await pick(page, asset);
    now = await layout(page);
    expect(now.pageScrolls).toBe(false);
    expect(within(now.canvas!, screen)).toBe(true);
    await page.mouse.click(...(await squareCentre(page, 40, 12, 8)));
    await expect.poll(async () => (await tokensOf(page, scene.id)).map(({ x, y }) => [x, y])).toEqual([[12, 8]]);
    expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);
    await expect(viewport(page)).toBeInViewport({ ratio: 1 });

    // The Settings dialog: whole on screen with no scrolling inside it, before and after saving and
    // changing the PIN, when each shows its status line.
    await page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog.getByLabel('Upload limit, in MB')).toBeFocused();
    const fits = async () => {
      const shown = await layout(page);
      expect(within(shown.dialog!, screen)).toBe(true);
      expect(shown.dialogScrolls).toBe(false);
    };
    await fits();
    for (const name of ['Save settings', 'Change PIN', 'Close']) await reachable(page, name, dialog);
    await dialog.getByRole('button', { name: 'Save settings' }).click();
    await expect(dialog.getByRole('status').first()).toHaveText(/^Settings saved\./);
    await fits();
    // The same PIN again: the change goes through, and the tests after this one sign in as before.
    await dialog.getByLabel('Current PIN').fill(E2E_PIN);
    await dialog.getByLabel('New PIN, 4 to 8 digits').fill(E2E_PIN);
    await dialog.getByLabel('The new PIN again').fill(E2E_PIN);
    await dialog.getByRole('button', { name: 'Change PIN' }).click();
    await expect(dialog.getByText('PIN changed', { exact: false })).toBeVisible();
    await fits();
  } finally {
    const summary = await page.request.get(`/api/campaigns/${campaignId}/deletion`);
    if (summary.ok()) {
      await page.request.delete(`/api/campaigns/${campaignId}`, {
        data: { confirm: (await summary.json()) as object },
      });
    }
    await context.close();
  }
});
