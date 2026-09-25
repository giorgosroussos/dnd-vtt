import { expect, type Page } from '@playwright/test';

// Reading the DM view's map canvas in a real browser (PRP-02, PRP-03, D-090, D-094): its camera
// from the viewport's data attributes, and what its two layers drew from their pixels.

export const tree = (page: Page) => page.getByRole('navigation', { name: 'Campaigns, sessions and scenes' });
export const nameButton = (page: Page, name: string) => tree(page).getByRole('button', { name, exact: true });
export const viewport = (page: Page) => page.locator('main [role="application"]');

export async function selectScene(page: Page, names: { campaign: string; session: string; scene: string }) {
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
