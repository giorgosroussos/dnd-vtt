import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { contrastFailures } from './contrast.js';
import { openWorkspace, seedCampaign } from './dm.js';
import { solidPng } from './png.js';

// The canvas and the grid overlay against the real server (PRP-02, specs/08-ux-journeys.md §3,
// specs/06-grid-and-measurement.md §2, specs/03-domain-model.md §6, specs/07-security-and-access.md
// §5, D-026, D-090): a generated map is attached to a scene in one action and drawn with the
// overlay, the grid is hidden for players and stays faint for the DM, the DM zooms and pans,
// and a reload finds the scene unchanged. What is drawn is read from the canvas pixels.

const tree = (page: Page) => page.getByRole('navigation', { name: 'Campaigns, sessions and scenes' });
const nameButton = (page: Page, name: string) => tree(page).getByRole('button', { name, exact: true });
const viewport = (page: Page) => page.locator('main [role="application"]');

const MAP_COLOUR: [number, number, number] = [40, 160, 90];
// 30 squares across by default until PRP-03 calibrates (D-090): 900 / 30 = 30 px a square.
const MAP_SIZE = { width: 900, height: 600 };
const SQUARE = MAP_SIZE.width / 30;

async function seedScene(page: Page, name: string): Promise<{ campaign: string; session: string; scene: string }> {
  const campaign = `Canvas campaign ${Date.now()}`;
  const campaignId = await seedCampaign(page, campaign, ['Canvas session']);
  const [session] = (await (await page.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as {
    id: string;
  }[];
  expect((await page.request.post(`/api/sessions/${session!.id}/scenes`, { data: { name } })).ok()).toBe(true);
  return { campaign, session: 'Canvas session', scene: name };
}

async function selectScene(page: Page, names: { campaign: string; session: string; scene: string }) {
  await nameButton(page, names.campaign).click();
  await nameButton(page, names.session).click();
  await nameButton(page, names.scene).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(names.scene);
  await expect(viewport(page)).toBeVisible();
}

interface Camera {
  x: number;
  y: number;
  scale: number;
}

async function cameraOf(page: Page): Promise<Camera> {
  return viewport(page).evaluate((element: HTMLElement) => ({
    x: Number(element.dataset.cameraX),
    y: Number(element.dataset.cameraY),
    scale: Number(element.dataset.cameraScale),
  }));
}

/**
 * What the two layers show around world point (wx, wy): the map layer's colour there, and the
 * strongest grid-layer alpha within `radius` screen pixels of it.
 */
async function drawnAt(page: Page, wx: number, wy: number, radius = 0): Promise<{ map: number[]; grid: number }> {
  const camera = await cameraOf(page);
  return viewport(page).evaluate(
    (element, { sx, sy, radius }) => {
      const [mapLayer, gridLayer] = [...element.querySelectorAll('canvas')];
      const ratio = window.devicePixelRatio;
      const read = (canvas: HTMLCanvasElement, x: number, y: number) => [
        ...canvas.getContext('2d')!.getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data,
      ];
      let grid = 0;
      for (let dx = -radius; dx <= radius; dx++) grid = Math.max(grid, read(gridLayer!, sx + dx, sy)[3]!);
      return { map: read(mapLayer!, sx, sy), grid };
    },
    { sx: camera.x + wx * camera.scale, sy: camera.y + wy * camera.scale, radius },
  );
}

const near = (actual: number[], expected: number[], tolerance = 10) =>
  expected.every((value, index) => Math.abs(actual[index]! - value) <= tolerance);

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

  // A map-less scene: its 30 × 20 extent with the overlay (specs/03-domain-model.md §6).
  await expect(viewport(page)).toHaveAttribute('data-grid', 'shown');
  expect((await drawnAt(page, 32, 32)).map[3]).toBe(255);

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

  const box = (await viewport(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await cameraOf(page)).scale).toBeGreaterThan(fitted.scale);
  const wheeled = await cameraOf(page);
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

  // Only the display version was ever requested for the canvas (specs/07-security-and-access.md §5).
  expect(imageRequests.length).toBeGreaterThan(0);
  expect(imageRequests.filter((path) => !path.endsWith('/display'))).toEqual([]);
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

  expect(await contrastFailures(page), 'selected scene').toEqual([]);
});
