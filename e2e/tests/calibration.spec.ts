import { expect, test, type Page } from '@playwright/test';
import { cameraOf, drawnAt, nameButton, overlayLineOffset, selectScene, viewport } from './canvas-view.js';
import { contrastFailures } from './contrast.js';
import { openWorkspace, seedCampaign } from './dm.js';
import { griddedPng } from './png.js';

// Grid calibration against the real server (PRP-03, specs/06-grid-and-measurement.md §1, §2, §3,
// specs/03-domain-model.md §4, §5, specs/05-assets-and-images.md §7, specs/07-security-and-access.md
// §5, D-094): generated maps with a drawn grid are calibrated by each method, the overlay is read
// from the canvas pixels on the drawn lines, a reload finds the calibration unchanged, and a new
// scene of a calibrated map starts from its preset while the first keeps its own grid.

interface Drawn {
  size: number;
  offsetX: number;
  offsetY: number;
}

interface Grid {
  size: number | null;
  offset_x: number;
  offset_y: number;
  visible: boolean;
  feet_per_square: number;
  columns: number;
  rows: number;
  type: 'square';
}

const LINE: [number, number, number] = [20, 20, 20];
let seeds = 0;

/** Uploads a gridded map whose bytes no other test uses, so it starts without a preset. */
async function uploadMap(page: Page, width: number, height: number, drawn: Drawn): Promise<string> {
  const background: [number, number, number] = [200, 180 - (seeds++ % 60), Date.now() % 90];
  const response = await page.request.post('/api/images', {
    data: griddedPng(width, height, drawn, background, LINE),
    headers: { 'content-type': 'application/octet-stream' },
  });
  expect(response.status(), await response.text()).toBe(201);
  const image = (await response.json()) as { id: string; grid_preset: unknown };
  expect(image.grid_preset).toBeNull();
  return image.id;
}

interface Seeded {
  campaign: string;
  session: string;
  sessionId: string;
}

async function seedSession(page: Page): Promise<Seeded> {
  const campaign = `Calibration campaign ${Date.now()} ${seeds++}`;
  const campaignId = await seedCampaign(page, campaign, ['Calibration session']);
  const [session] = (await (await page.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as {
    id: string;
  }[];
  return { campaign, session: 'Calibration session', sessionId: session!.id };
}

async function newScene(
  page: Page,
  sessionId: string,
  name: string,
  mapId: string,
): Promise<{ id: string; grid: Grid }> {
  const response = await page.request.post(`/api/sessions/${sessionId}/scenes`, {
    data: { name, map_image_id: mapId },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as { id: string; grid: Grid };
}

const gridOf = async (page: Page, sceneId: string): Promise<Grid> =>
  ((await (await page.request.get(`/api/scenes/${sceneId}`)).json()) as { grid: Grid }).grid;
const presetOf = async (page: Page, imageId: string): Promise<Grid | null> =>
  ((await (await page.request.get(`/api/images/${imageId}`)).json()) as { grid_preset: Grid | null }).grid_preset;

/**
 * The overlay lies on the drawn lines: at each drawn line of `columns` (and of `rows`) the
 * overlay's light line is within 0.6 screen pixels of it, and half a square away there is no
 * line at all. The far lines are where a size a fraction of a pixel off has drifted furthest:
 * 0.1 px over 25 squares is 2.5 px, several screen pixels at any fitted scale here.
 */
async function expectOverlayOnDrawnLines(page: Page, drawn: Drawn, columns: number[], rows: number[]) {
  const line = (index: number, offset: number) => offset + index * drawn.size;
  const middle = (index: number, offset: number) => offset + (index + 0.5) * drawn.size;
  const across = { x: middle(2, drawn.offsetX), y: middle(2, drawn.offsetY) };
  for (const k of columns) {
    await expect
      .poll(async () => overlayLineOffset(page, line(k, drawn.offsetX), across.y, 'x'), `column line ${k}`)
      .toBeGreaterThan(-0.6);
    expect(await overlayLineOffset(page, line(k, drawn.offsetX), across.y, 'x'), `column line ${k}`).toBeLessThan(0.6);
    expect((await drawnAt(page, middle(k, drawn.offsetX), across.y)).grid, `mid-square after column ${k}`).toBe(0);
  }
  for (const k of rows) {
    const offset = await overlayLineOffset(page, across.x, line(k, drawn.offsetY), 'y');
    expect(offset, `row line ${k}`).not.toBeNull();
    expect(Math.abs(offset!), `row line ${k}`).toBeLessThan(0.6);
    expect((await drawnAt(page, across.x, middle(k, drawn.offsetY))).grid, `mid-square after row ${k}`).toBe(0);
  }
}

const calibrationPanel = (page: Page) => page.getByRole('region', { name: 'Calibrate the grid' });

const save = async (page: Page) => {
  await calibrationPanel(page).getByRole('button', { name: 'Save calibration' }).click();
  await expect(page.locator('main [role="status"]')).toHaveText('Grid calibrated.');
  await expect(calibrationPanel(page)).toHaveCount(0);
};

test('known dimensions calibrate a map live, a reload keeps it, and a new scene of the map starts from its preset', async ({
  page,
}) => {
  await openWorkspace(page);
  // 40 px squares from the top-left corner: the map is 25 × 18 squares.
  const drawn = { size: 40, offsetX: 0, offsetY: 0 };
  const seeded = await seedSession(page);
  const map = await uploadMap(page, 1000, 720, drawn);
  const known = await newScene(page, seeded.sessionId, 'Known hall', map);
  const images: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith(`/images/${map}/`)) images.push(url.pathname);
  });
  await page.reload();
  await selectScene(page, { ...seeded, scene: 'Known hall' });
  // Until calibration the overlay reads the default 30 columns (D-090): not on the drawn lines.
  expect((await drawnAt(page, 1000 / 30 + 0.5, 60)).grid).toBeGreaterThan(0);
  expect(images).not.toContain(`/images/${map}/original`);

  await page.getByRole('button', { name: 'Calibrate grid' }).click();
  await expect(calibrationPanel(page).getByLabel('Known dimensions')).toBeChecked();
  await calibrationPanel(page).getByLabel('Columns').fill('25');
  await calibrationPanel(page).getByLabel('Rows').fill('18');
  // The overlay follows before anything is saved, out to the far lines.
  await expectOverlayOnDrawnLines(page, drawn, [1, 12, 23, 24], [1, 16, 17]);
  expect(await gridOf(page, known.id)).toEqual(known.grid);

  // The magnifier shows the original's far corner, with the drawn line and the overlay on it.
  const magnifier = page.getByRole('img', { name: 'Far corner of the map, magnified, with the grid' });
  await expect(magnifier).toBeVisible();
  await expect(magnifier).toHaveAttribute('data-crop-x', '880');
  expect(images).toContain(`/images/${map}/original`);
  // Original x 960 is a drawn line: 80 px into the 120 px region, at 200 ÷ 120 magnifier px each.
  const corner = await magnifier.evaluate((element) => {
    const [mapLayer, gridLayer] = [...element.querySelectorAll('canvas')];
    const ratio = window.devicePixelRatio;
    const read = (canvas: HTMLCanvasElement, x: number, y: number) => [
      ...canvas.getContext('2d')!.getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data,
    ];
    const at = (80 * 200) / 120;
    return {
      line: read(mapLayer!, at + 1, 30),
      overlay: Math.max(read(gridLayer!, at, 30)[3]!, read(gridLayer!, at + 1, 30)[3]!),
    };
  });
  expect(corner.line.slice(0, 3)).toEqual(LINE);
  expect(corner.overlay).toBeGreaterThan(40);

  await save(page);
  const saved = await gridOf(page, known.id);
  expect(saved).toEqual({ ...known.grid, size: 40, offset_x: 0, offset_y: 0, columns: 25, rows: 18 });
  expect(await presetOf(page, map)).toEqual(saved);

  // Reload: unchanged, and still on the drawn lines.
  await page.reload();
  await selectScene(page, { ...seeded, scene: 'Known hall' });
  await expectOverlayOnDrawnLines(page, drawn, [1, 24], [17]);
  expect(await gridOf(page, known.id)).toEqual(saved);

  // A new scene of the same map starts from the preset: on the drawn lines without calibrating.
  const later = await newScene(page, seeded.sessionId, 'Later hall', map);
  expect(later.grid).toEqual(saved);
  await page.reload();
  await selectScene(page, { ...seeded, scene: 'Later hall' });
  await expectOverlayOnDrawnLines(page, drawn, [1, 24], [17]);

  // Recalibrating the later scene moves the preset, and the first scene keeps its own grid.
  await page.getByRole('button', { name: 'Calibrate grid' }).click();
  await calibrationPanel(page).getByLabel('Fine tuning').check();
  await calibrationPanel(page).getByLabel('Offset x (px)').fill('20');
  await save(page);
  expect((await gridOf(page, later.id)).offset_x).toBe(20);
  expect((await presetOf(page, map))!.offset_x).toBe(20);
  expect(await gridOf(page, known.id)).toEqual(saved);
  expect((await newScene(page, seeded.sessionId, 'Third hall', map)).grid.offset_x).toBe(20);
});

test('the rectangle method measures N × N drawn squares dragged on the map, and fine tuning finishes it', async ({
  page,
}) => {
  await openWorkspace(page);
  // 50 px squares from 20, 30: the rectangle covers 3 × 3 of them around the map's centre.
  const drawn = { size: 50, offsetX: 20, offsetY: 30 };
  const seeded = await seedSession(page);
  const map = await uploadMap(page, 1200, 800, drawn);
  const scene = await newScene(page, seeded.sessionId, 'Rectangle hall', map);
  await page.reload();
  await selectScene(page, { ...seeded, scene: 'Rectangle hall' });
  await page.getByRole('button', { name: 'Calibrate grid' }).click();
  await calibrationPanel(page).getByLabel('Rectangle over squares').check();

  // Zoomed in about the centre, as a DM would to drag precisely.
  await viewport(page).focus();
  for (let press = 0; press < 3; press++) await page.keyboard.press('+');
  const camera = await cameraOf(page);
  const box = (await viewport(page).boundingBox())!;
  const screen = (wx: number, wy: number) =>
    [box.x + 1 + camera.x + wx * camera.scale, box.y + 1 + camera.y + wy * camera.scale] as const;
  await page.mouse.move(...screen(520, 380));
  await page.mouse.down();
  await page.mouse.move(...screen(600, 460), { steps: 5 });
  await page.mouse.move(...screen(670, 530), { steps: 5 });
  await page.mouse.up();
  await expect(calibrationPanel(page)).toContainText('Rectangle:');
  // Measured to a fraction of a pixel: the overlay lies on the drawn lines out to the far edge.
  await page.getByRole('button', { name: 'Fit map' }).click();
  await expectOverlayOnDrawnLines(page, drawn, [0, 11, 22], [0, 14]);
  await save(page);
  const saved = await gridOf(page, scene.id);
  expect(saved.size).toBeCloseTo(50, 2);
  expect(saved.offset_x).toBeCloseTo(20, 1);
  expect(saved.offset_y).toBeCloseTo(30, 1);
  expect(saved).toMatchObject({ columns: 24, rows: 16 });

  // Fine tuning then sets it exactly, by typing and by the arrow keys.
  await page.getByRole('button', { name: 'Calibrate grid' }).click();
  await calibrationPanel(page).getByLabel('Fine tuning').check();
  const size = calibrationPanel(page).getByLabel('Square size (px)');
  await size.fill('50');
  await calibrationPanel(page).getByLabel('Offset x (px)').fill('20');
  await calibrationPanel(page).getByLabel('Offset y (px)').fill('30');
  await size.press('ArrowUp');
  await expect(size).toHaveValue('50.1');
  await size.press('ArrowDown');
  await expect(size).toHaveValue('50');
  await save(page);
  expect(await gridOf(page, scene.id)).toMatchObject({ size: 50, offset_x: 20, offset_y: 30 });
  await page.reload();
  await selectScene(page, { ...seeded, scene: 'Rectangle hall' });
  await expectOverlayOnDrawnLines(page, drawn, [0, 22], [14]);
});

test('fine tuning keeps a decimal square size exactly, and the overlay lies on a grid drawn at it', async ({
  page,
}) => {
  await openWorkspace(page);
  // 37.5 px squares from 12, 7: half a pixel wrong would drift 13 px by the far edge.
  const drawn = { size: 37.5, offsetX: 12, offsetY: 7 };
  const seeded = await seedSession(page);
  const map = await uploadMap(page, 1000, 720, drawn);
  const scene = await newScene(page, seeded.sessionId, 'Fine hall', map);
  await page.reload();
  await selectScene(page, { ...seeded, scene: 'Fine hall' });
  await page.getByRole('button', { name: 'Calibrate grid' }).click();
  await calibrationPanel(page).getByLabel('Fine tuning').check();
  const size = calibrationPanel(page).getByLabel('Square size (px)');
  await size.fill('37');
  const offsetX = calibrationPanel(page).getByLabel('Offset x (px)');
  await offsetX.fill('12');
  await calibrationPanel(page).getByLabel('Offset y (px)').fill('7');
  // Five steps of 0.1 px by keyboard: 37 → 37.5.
  for (let step = 0; step < 5; step++) await size.press('ArrowUp');
  await expect(size).toHaveValue('37.5');
  await expectOverlayOnDrawnLines(page, drawn, [1, 13, 25], [1, 18]);
  await save(page);
  const saved = await gridOf(page, scene.id);
  expect(saved).toMatchObject({ size: 37.5, offset_x: 12, offset_y: 7, columns: 27, rows: 19 });
  expect(await presetOf(page, map)).toEqual(saved);
  await page.reload();
  await selectScene(page, { ...seeded, scene: 'Fine hall' });
  expect(await gridOf(page, scene.id)).toEqual(saved);
  await expectOverlayOnDrawnLines(page, drawn, [25], [18]);
});

test('calibration is reached and operated by keyboard alone, with readable contrast, and a calibrated map is replaced only after a confirmation', async ({
  page,
}) => {
  await openWorkspace(page);
  const drawn = { size: 40, offsetX: 0, offsetY: 0 };
  const seeded = await seedSession(page);
  const map = await uploadMap(page, 1000, 720, drawn);
  const scene = await newScene(page, seeded.sessionId, 'Keyboard hall', map);
  await page.reload();
  await selectScene(page, { ...seeded, scene: 'Keyboard hall' });

  const ring = (element: HTMLElement | SVGElement) => {
    const style = getComputedStyle(element);
    return (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none';
  };
  const calibrate = page.getByRole('button', { name: 'Calibrate grid' });
  // Tab reaches Calibrate grid from the scene's name in the tree.
  await nameButton(page, 'Keyboard hall').focus();
  for (let presses = 0; presses < 40 && !(await calibrate.evaluate((e) => e === document.activeElement)); presses++) {
    await page.keyboard.press('Tab');
  }
  await expect(calibrate).toBeFocused();
  expect(await calibrate.evaluate(ring)).toBe(true);
  await page.keyboard.press('Enter');

  // The method takes focus; the arrow keys choose another, Tab walks the fields to Save.
  const panel = calibrationPanel(page);
  await expect(panel.getByLabel('Known dimensions')).toBeFocused();
  expect(await panel.getByLabel('Known dimensions').evaluate(ring)).toBe(true);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(panel.getByLabel('Fine tuning')).toBeChecked();
  const walk = [
    panel.getByLabel('Square size (px)'),
    panel.getByLabel('Offset x (px)'),
    panel.getByLabel('Offset y (px)'),
    panel.getByRole('button', { name: 'Save calibration' }),
    panel.getByRole('button', { name: 'Cancel' }),
  ];
  for (const control of walk) {
    await page.keyboard.press('Tab');
    await expect(control).toBeFocused();
    expect(await control.evaluate(ring)).toBe(true);
  }
  expect(await contrastFailures(page), 'calibration').toEqual([]);
  // Back to the size: Shift+Tab four times, then fine-tune by keys.
  for (let presses = 0; presses < 4; presses++) await page.keyboard.press('Shift+Tab');
  await expect(walk[0]!).toBeFocused();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('40');
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(walk[0]!).toHaveValue('40');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(walk[3]!).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main [role="status"]')).toHaveText('Grid calibrated.');
  await expect(calibrate).toBeFocused();
  const calibrated = await gridOf(page, scene.id);
  expect(calibrated).toMatchObject({ size: 40, offset_x: 0, offset_y: 0 });

  // Replacing the calibrated map asks first; Escape and the keep button change nothing.
  await page.getByLabel('New map image: PNG, JPEG or WebP').setInputFiles({
    name: 'other.png',
    mimeType: 'image/png',
    buffer: griddedPng(300, 200, drawn, [90, 90, 200], LINE),
  });
  const replace = page.getByRole('button', { name: 'Replace map' });
  await replace.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Replace the map?' });
  await expect(dialog).toContainText('The calibration goes with it');
  expect(await contrastFailures(page), 'replace dialog').toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(replace).toBeFocused();
  await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: 'Keep the current map' }).click();
  await expect(dialog).toHaveCount(0);
  const unchanged = (await (await page.request.get(`/api/scenes/${scene.id}`)).json()) as {
    map_image_id: string;
    grid: Grid;
  };
  expect(unchanged).toMatchObject({ map_image_id: map, grid: calibrated });

  // Confirmed, the new map replaces it and starts with its own grid.
  await replace.click();
  await dialog.getByRole('button', { name: 'Replace map' }).click();
  await expect(page.locator('main [role="status"]')).toHaveText('Map attached.');
  const replaced = (await (await page.request.get(`/api/scenes/${scene.id}`)).json()) as {
    map_image_id: string;
    grid: Grid;
  };
  expect(replaced.map_image_id).not.toBe(map);
  expect(replaced.grid.size).toBeNull();
  await expect(viewport(page)).toBeVisible();
});
