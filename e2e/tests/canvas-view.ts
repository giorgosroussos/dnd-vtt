import { expect, type Page } from '@playwright/test';

// Reading the DM view's map canvas in a real browser (PRP-02, PRP-03, D-090, D-094): its camera
// from the viewport's data attributes, and what its two layers drew from their pixels.

// The Campaign → Session → Scene tree, in the header's session switcher since the redesign (UIX-01).
export const tree = (page: Page) => page.getByRole('region', { name: 'Campaigns, sessions and scenes' });
export const nameButton = (page: Page, name: string) => tree(page).getByRole('button', { name, exact: true });
/** The header's breadcrumb, which opens and closes the switcher. */
export const breadcrumb = (page: Page) => page.locator('.eg-header__crumbs');

/** Opens the session switcher, if it is not open already. */
export async function openTree(page: Page): Promise<void> {
  if (await tree(page).isVisible()) return;
  await breadcrumb(page).click();
  await expect(tree(page)).toBeVisible();
}

/** The current session's scenes, in the left sidebar (UIX-01). */
export const sceneList = (page: Page) => page.getByRole('navigation', { name: 'Scenes of this session' });
/** A scene of the current session's list, by its name. */
export const sceneRow = (page: Page, name: string) =>
  sceneList(page).locator('.eg-scenes__select', { has: page.locator('.eg-scenes__name', { hasText: name }) });

/** Opens the selected scene's setup: its map, the players' grid, feet per square and calibration (UIX-01). */
export async function openSetup(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Scene setup' });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

/** Shows the right-hand panel's Library tab (UIX-01). */
export async function openLibrary(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Library' }).click();
}

/** The "In this scene" list's rows (UIX-01). */
export const tokenRows = (page: Page) => page.locator('.eg-token-row');
/** Selects a token by its label in the "In this scene" list. */
export async function selectTokenRow(page: Page, label: string): Promise<void> {
  await page.getByRole('tab', { name: 'In this scene' }).click();
  const exactly = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  await page
    .locator('.eg-token-row__select', { has: page.locator('.eg-token-row__name', { hasText: exactly }) })
    .click();
}
/** Selects a token by its id in the "In this scene" list. */
export async function selectTokenById(page: Page, id: string): Promise<void> {
  await page.getByRole('tab', { name: 'In this scene' }).click();
  await page.locator(`[data-token="${id}"] .eg-token-row__select`).click();
}
/** The label of the token the list marks as selected, or null. */
export const selectedTokenLabel = (page: Page) => page.locator('.eg-token-row--selected .eg-token-row__name');
/** The selected token's popover on the map. */
export const tokenPopover = (page: Page) => page.locator('.eg-popover');
/** Runs an item of the selected token's popover menu: Duplicate, To front, To back, Delete. */
export async function tokenMenu(page: Page, label: string, item: string): Promise<void> {
  await tokenPopover(page)
    .getByRole('button', { name: `More actions for ${label}` })
    .click();
  await tokenPopover(page).getByRole('menuitem', { name: item }).click();
}
export const viewport = (page: Page) => page.locator('main [role="application"]');

/**
 * Scrolls the page, when needed, so that every point given (in viewport pixels) is on screen, and
 * answers where each point is after the scroll. At 1,280 × 720 the canvas runs below the fold
 * (G-022); Chromium delivers a pointer event at a point off screen, WebKit does not, so a pointer
 * aimed there does nothing (REL-02, CI run 36561044420).
 */
export async function onScreen(page: Page, points: [number, number][]): Promise<[number, number][]> {
  const height = page.viewportSize()!.height;
  const ys = points.map(([, y]) => y);
  const [top, bottom] = [Math.min(...ys), Math.max(...ys)];
  const margin = 8;
  if (top >= margin && bottom <= height - margin) return points;
  const moved = await page.evaluate(
    (by) => {
      const before = window.scrollY;
      window.scrollBy(0, by);
      return window.scrollY - before;
    },
    (top + bottom) / 2 - height / 2,
  );
  return points.map(([x, y]) => [x, y - moved]);
}

export async function selectScene(page: Page, names: { campaign: string; session: string; scene: string }) {
  await openTree(page);
  await nameButton(page, names.campaign).click();
  await nameButton(page, names.session).click();
  await nameButton(page, names.scene).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(names.scene);
  await expect(viewport(page)).toBeVisible();
}

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export async function cameraOf(page: Page): Promise<Camera> {
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
export async function drawnAt(
  page: Page,
  wx: number,
  wy: number,
  radius = 0,
  axis: 'x' | 'y' = 'x',
): Promise<{ map: number[]; grid: number }> {
  const camera = await cameraOf(page);
  return viewport(page).evaluate(
    (element, { sx, sy, radius, axis }) => {
      const [mapLayer, gridLayer] = [...element.querySelectorAll('canvas')];
      const ratio = window.devicePixelRatio;
      const read = (canvas: HTMLCanvasElement, x: number, y: number) => [
        ...canvas.getContext('2d')!.getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data,
      ];
      let grid = 0;
      for (let d = -radius; d <= radius; d++) {
        const [x, y] = axis === 'x' ? [sx + d, sy] : [sx, sy + d];
        grid = Math.max(grid, read(gridLayer!, x, y)[3]!);
      }
      return { map: read(mapLayer!, sx, sy), grid };
    },
    { sx: camera.x + wx * camera.scale, sy: camera.y + wy * camera.scale, radius, axis },
  );
}

export const near = (actual: number[], expected: number[], tolerance = 10) =>
  expected.every((value, index) => Math.abs(actual[index]! - value) <= tolerance);

/**
 * Where the overlay's light line crossing world point (wx, wy) along `axis` is drawn, in screen
 * pixels from where that point is: the centroid of the grid layer's lightness within 4 px each
 * side, so a line antialiased over two pixels is placed to a fraction of one. Null when no light
 * line is there. The halo under each line is dark and weighs nothing.
 */
export async function overlayLineOffset(page: Page, wx: number, wy: number, axis: 'x' | 'y'): Promise<number | null> {
  const camera = await cameraOf(page);
  return viewport(page).evaluate(
    (element, { sx, sy, axis }) => {
      const gridLayer = [...element.querySelectorAll('canvas')][1]!;
      const ratio = window.devicePixelRatio;
      const window_ = 4 * ratio;
      const [cx, cy] = [sx * ratio, sy * ratio];
      const [x0, y0] =
        axis === 'x' ? [Math.round(cx) - window_, Math.round(cy)] : [Math.round(cx), Math.round(cy) - window_];
      const [w, h] = axis === 'x' ? [2 * window_ + 1, 1] : [1, 2 * window_ + 1];
      const data = gridLayer.getContext('2d')!.getImageData(x0, y0, w, h).data;
      let weight = 0;
      let moment = 0;
      for (let i = 0; i < w * h; i++) {
        // Lightness above the halo's, times coverage.
        const light = Math.max(0, data[i * 4]! - 64) * data[i * 4 + 3]!;
        const at = (axis === 'x' ? x0 : y0) + i + 0.5;
        weight += light;
        moment += light * at;
      }
      if (weight === 0) return null;
      return (moment / weight - (axis === 'x' ? cx : cy)) / ratio;
    },
    { sx: camera.x + wx * camera.scale, sy: camera.y + wy * camera.scale, axis },
  );
}
