import { expect, type Page } from '@playwright/test';
import { cameraOf, nameButton, onScreen, tree, viewport } from './canvas-view.js';
import { solidPng } from './png.js';

// Preparing in the DM view against the real server (PRP-04, D-100): the helpers the token specs and
// the Prepare journey (journeys/prepare.spec.ts) share, moved here from tokens.spec.ts by REL-02.

export interface Token {
  id: string;
  label: string;
  x: number;
  y: number;
  hidden: boolean;
  z_order: number;
  asset_id: string;
}

export interface Drawn {
  id: string;
  label: string;
  hidden: boolean;
  x: number;
  y: number;
  left: number;
  top: number;
  side: number;
}

let seeds = 0;
export const unique = () => `${Date.now()}-${seeds++}`;

export async function create(page: Page, open: string, label: string, name: string) {
  await tree(page).getByRole('button', { name: open }).last().click();
  await tree(page).getByLabel(label).fill(name);
  await tree(page).getByRole('button', { name: 'Create' }).click();
  await expect(nameButton(page, name)).toBeVisible();
}

export async function newAsset(
  page: Page,
  name: string,
  fields: { category: string; size: string },
  colour: [number, number, number],
): Promise<{ id: string; image_id: string }> {
  const image = (await (
    await page.request.post('/api/images', {
      data: solidPng(48, 48, colour),
      headers: { 'content-type': 'application/octet-stream' },
    })
  ).json()) as { id: string };
  const response = await page.request.post('/api/assets', { data: { name, image_id: image.id, ...fields } });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as { id: string; image_id: string };
}

export const tokensOf = async (page: Page, sceneId: string): Promise<Token[]> =>
  (await (await page.request.get(`/api/scenes/${sceneId}/tokens`)).json()) as Token[];
export const drawn = async (page: Page): Promise<Drawn[]> =>
  JSON.parse((await viewport(page).getAttribute('data-tokens')) ?? '[]') as Drawn[];
export const sceneIdOf = async (page: Page, sessionId: string, name: string): Promise<string> =>
  ((await (await page.request.get(`/api/sessions/${sessionId}/scenes`)).json()) as { id: string; name: string }[]).find(
    (scene) => scene.name === name,
  )!.id;

/** Screen coordinates of world point (wx, wy) on the canvas. */
export async function screenOf(page: Page, wx: number, wy: number): Promise<[number, number]> {
  // The mouse does not scroll: at 1,280 × 720 the canvas lies partly below the fold (G-022).
  await viewport(page).scrollIntoViewIfNeeded();
  const camera = await cameraOf(page);
  const box = (await viewport(page).boundingBox())!;
  // The viewport's 1 px border.
  const [point] = await onScreen(page, [
    [box.x + 1 + camera.x + wx * camera.scale, box.y + 1 + camera.y + wy * camera.scale],
  ]);
  return point!;
}

/** Screen coordinates of the middle of grid square (gx, gy), for a grid of `square` world px from 0. */
export async function squareCentre(page: Page, square: number, gx: number, gy: number): Promise<[number, number]> {
  return screenOf(page, (gx + 0.5) * square, (gy + 0.5) * square);
}

export const picker = (page: Page) => page.getByRole('dialog', { name: 'Add a token' });
export const status = (page: Page) => page.locator('main [role="status"]');

/** Add token, then the picker: search for the asset and choose it. */
export async function pick(page: Page, name: string) {
  await page.getByRole('button', { name: 'Add token' }).click();
  await picker(page).getByLabel('Search names and tags').fill(name);
  await expect(picker(page).locator('.eg-library__name')).toHaveText([name]);
  await picker(page)
    .getByRole('button', { name: `Choose ${name}` })
    .click();
  await expect(picker(page)).toHaveCount(0);
  await expect(page.getByText(`Placing ${name}: click on the map where it goes.`)).toBeVisible();
}

/** Drags a drawn one-square token by `dx`, `dy` squares, holding Alt at the drop when asked. */
export async function dragBy(page: Page, label: string, dx: number, dy: number, alt = false) {
  await viewport(page).scrollIntoViewIfNeeded();
  const token = (await drawn(page)).find((each) => each.label === label)!;
  const box = (await viewport(page).boundingBox())!;
  const start: [number, number] = [box.x + 1 + token.left + token.side / 2, box.y + 1 + token.top + token.side / 2];
  const perSquare = token.side;
  const [from, to] = (await onScreen(page, [start, [start[0] + dx * perSquare, start[1] + dy * perSquare]])) as [
    [number, number],
    [number, number],
  ];
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(...to, { steps: 4 });
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
}

export const calibrationPanel = (page: Page) => page.getByRole('region', { name: 'Calibrate the grid' });
export async function saveCalibration(page: Page) {
  await calibrationPanel(page).getByRole('button', { name: 'Save calibration' }).click();
  await expect(status(page)).toHaveText('Grid calibrated.');
}
