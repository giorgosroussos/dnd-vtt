import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { contrastFailures } from './contrast.js';
import { openWorkspace, seedCampaign } from './dm.js';
import { cameraOf, drawnAt, nameButton, near, selectScene, viewport } from './canvas-view.js';
import { solidPng } from './png.js';

// The canvas and the grid overlay against the real server (PRP-02, specs/08-ux-journeys.md §3,
// specs/06-grid-and-measurement.md §2, specs/03-domain-model.md §6, specs/07-security-and-access.md
// §5, D-026, D-090): a generated map is attached to a scene in one action and drawn with the
// overlay, the grid is hidden for players and stays faint for the DM, the DM zooms and pans,
// and a reload finds the scene unchanged. What is drawn is read from the canvas pixels.

const MAP_COLOUR: [number, number, number] = [40, 160, 90];
// 30 squares across by default until the scene is calibrated (D-090, D-094): 900 / 30 = 30 px a square.
const MAP_SIZE = { width: 900, height: 600 };
const SQUARE = MAP_SIZE.width / 30;

async function seedScene(
  page: Page,
  name: string,
): Promise<{ campaign: string; session: string; scene: string; id: string }> {
  const campaign = `Canvas campaign ${Date.now()}`;
  const campaignId = await seedCampaign(page, campaign, ['Canvas session']);
  const [session] = (await (await page.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as {
    id: string;
  }[];
  const created = await page.request.post(`/api/sessions/${session!.id}/scenes`, { data: { name } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  return { campaign, session: 'Canvas session', scene: name, id };
}

test('the DM attaches a map, sees it with the overlay, hides the grid for players, zooms and pans, and a reload keeps it', async ({
  page,
}) => {
  await openWorkspace(page);
  const names = await seedScene(page, 'Canvas cave');
  const imageRequests: string[] = [];
  const elsewhere: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/images/')) imageRequests.push(url.pathname);
    // Konva is bundled: nothing is fetched from another host (specs/02-architecture.md §6).
    if (
      !['http:', 'data:', 'blob:'].includes(url.protocol) ||
      (url.protocol === 'http:' && url.host !== new URL(page.url()).host)
    ) {
      elsewhere.push(request.url());
    }
  });
  await page.reload();
  await selectScene(page, names);

  // A map-less scene: its 30 × 20 extent on neutral dark grey, with the overlay on every
  // square edge, 64 world px apart, and nothing mid-square (specs/03-domain-model.md §6).
  await expect(viewport(page)).toHaveAttribute('data-grid', 'shown');
  expect(near((await drawnAt(page, 32, 32)).map, [0x2b, 0x2b, 0x2b, 255], 2)).toBe(true);
  expect((await drawnAt(page, 64, 32, 1)).grid).toBeGreaterThan(40);
  expect((await drawnAt(page, 96, 32)).grid).toBe(0);

  // Attach a generated map: uploaded and set on the scene in one action (G-016).
  await page.getByLabel('Map image: PNG, JPEG or WebP').setInputFiles({
    name: 'cave.png',
    mimeType: 'image/png',
    buffer: solidPng(MAP_SIZE.width, MAP_SIZE.height, MAP_COLOUR),
  });
  await page.getByRole('button', { name: 'Attach map' }).click();
  await expect(page.getByRole('button', { name: 'Replace map' })).toBeVisible();

  // The map is drawn; the overlay has a line on every square edge and nothing mid-square.
  await expect
    .poll(async () => near((await drawnAt(page, SQUARE * 4.5, SQUARE * 3.5)).map, [...MAP_COLOUR, 255]))
    .toBe(true);
  const onLine = await drawnAt(page, SQUARE * 5, SQUARE * 3.5, 1);
  expect(onLine.grid).toBeGreaterThan(40);
  expect((await drawnAt(page, SQUARE * 4.5, SQUARE * 3.5)).grid).toBe(0);

  // Hidden for players: the DM still sees the overlay, faintly (D-026).
  await page.getByLabel('Players see the grid').uncheck();
  await expect(viewport(page)).toHaveAttribute('data-grid', 'faint');
  await expect.poll(async () => (await drawnAt(page, SQUARE * 5, SQUARE * 3.5, 1)).grid).toBeLessThan(onLine.grid);
  expect((await drawnAt(page, SQUARE * 5, SQUARE * 3.5, 1)).grid).toBeGreaterThan(0);

  // Zoom and pan: keyboard, wheel, drag, and the reset.
  const fitted = await cameraOf(page);
  await viewport(page).focus();
  await page.keyboard.press('+');
  await expect.poll(async () => (await cameraOf(page)).scale).toBeGreaterThan(fitted.scale);
  const zoomed = await cameraOf(page);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await cameraOf(page)).x).toBeGreaterThan(zoomed.x);
  await page.getByRole('button', { name: 'Fit map' }).click();
  await expect.poll(() => cameraOf(page)).toEqual(fitted);

  // The wheel zooms about the pointer: the world point under it stays under it. The stage
  // starts inside the viewport's 1 px border.
  const box = (await viewport(page).boundingBox())!;
  const pointer = { x: 100, y: 90 };
  const under = { x: (pointer.x - 1 - fitted.x) / fitted.scale, y: (pointer.y - 1 - fitted.y) / fitted.scale };
  await page.mouse.move(box.x + pointer.x, box.y + pointer.y);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await cameraOf(page)).scale).toBeGreaterThan(fitted.scale);
  const wheeled = await cameraOf(page);
  expect(under.x * wheeled.scale + wheeled.x + 1).toBeCloseTo(pointer.x, 0);
  expect(under.y * wheeled.scale + wheeled.y + 1).toBeCloseTo(pointer.y, 0);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await cameraOf(page)).x).toBeCloseTo(wheeled.x + 120, 0);
  expect((await cameraOf(page)).y).toBeCloseTo(wheeled.y + 40, 0);
  await viewport(page).focus();
  await page.keyboard.press('0');
  await expect.poll(() => cameraOf(page)).toEqual(fitted);

  // Reload: the map and the players' grid setting were saved.
  await page.reload();
  await selectScene(page, names);
  await expect(page.getByRole('button', { name: 'Replace map' })).toBeVisible();
  await expect(page.getByLabel('Players see the grid')).not.toBeChecked();
  await expect(viewport(page)).toHaveAttribute('data-grid', 'faint');
  await expect
    .poll(async () => near((await drawnAt(page, SQUARE * 4.5, SQUARE * 3.5)).map, [...MAP_COLOUR, 255]))
    .toBe(true);

  // Only the display version of this map was ever requested (specs/07-security-and-access.md §5);
  // other specs' thumbnails, if any, are no concern of this one.
  const { map_image_id: mapId } = (await (await page.request.get(`/api/scenes/${names.id}`)).json()) as {
    map_image_id: string;
  };
  const ofMap = imageRequests.filter((path) => path.startsWith(`/images/${mapId}/`));
  expect(ofMap.length).toBeGreaterThan(0);
  expect(new Set(ofMap)).toEqual(new Set([`/images/${mapId}/display`]));
  expect(elsewhere).toEqual([]);
});

test('a map over the upload limit is refused before it is sent', async ({ page }) => {
  await openWorkspace(page);
  const names = await seedScene(page, 'Canvas huge');
  await page.reload();
  await selectScene(page, names);
  const uploads: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/images')) uploads.push(request.method());
  });
  // 51 MiB of zeros, over the default 50 MB limit (D-075); written to a file, since
  // Playwright passes no buffer over 50 MB.
  const huge = test.info().outputPath('huge-map.png');
  writeFileSync(huge, Buffer.alloc(51 * 1024 * 1024));
  await page.getByLabel('Map image: PNG, JPEG or WebP').setInputFiles(huge);
  await expect(page.locator('main')).toContainText('This file is 51 MB; the upload limit is 50 MB.');
  await page.getByRole('button', { name: 'Attach map' }).click();
  await expect(page.locator('main')).toContainText('This file is 51 MB; the upload limit is 50 MB.');
  expect(uploads).toEqual([]);
});

test('the canvas of a selected scene is reached, shown and operated by keyboard alone, with readable contrast', async ({
  page,
}) => {
  await openWorkspace(page);
  const names = await seedScene(page, 'Canvas keys');
  await page.reload();
  await selectScene(page, names);
  const controls = [
    page.getByLabel('Map image: PNG, JPEG or WebP'),
    page.getByRole('button', { name: 'Attach map' }),
    page.getByLabel('Players see the grid'),
    page.getByRole('button', { name: 'Zoom in' }),
    page.getByRole('button', { name: 'Zoom out' }),
    page.getByRole('button', { name: 'Fit map' }),
    viewport(page),
  ];
  // Tab from the scene's own name in the tree reaches each control in order, each with a ring.
  await nameButton(page, names.scene).focus();
  for (const control of controls) {
    for (let presses = 0; presses < 40; presses++) {
      if (await control.evaluate((element) => element === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(control).toBeFocused();
    const ring = await control.evaluate((element) => {
      const style = getComputedStyle(element);
      return (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none';
    });
    expect(ring).toBe(true);
  }

  // Operated by keys: the viewport's keys, the buttons by Enter and Space, the checkbox by Space.
  const fitted = await cameraOf(page);
  await page.keyboard.press('=');
  await expect.poll(async () => (await cameraOf(page)).scale).toBeGreaterThan(fitted.scale);
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await cameraOf(page)).y).toBeLessThan(fitted.y);
  await page.getByRole('button', { name: 'Fit map' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => cameraOf(page)).toEqual(fitted);
  await page.getByRole('button', { name: 'Zoom in' }).focus();
  await page.keyboard.press('Space');
  await expect.poll(async () => (await cameraOf(page)).scale).toBeGreaterThan(fitted.scale);
  await page.getByLabel('Players see the grid').focus();
  await page.keyboard.press('Space');
  await expect(viewport(page)).toHaveAttribute('data-grid', 'faint');
  // Focus stays on the checkbox through the save (review UX-1).
  await expect(page.getByLabel('Players see the grid')).toBeFocused();

  expect(await contrastFailures(page), 'selected scene').toEqual([]);
});
