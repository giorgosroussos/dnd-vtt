import { expect, test, type Page } from '@playwright/test';
import { cameraOf, nameButton, selectScene, tree, viewport } from './canvas-view.js';
import { contrastFailures } from './contrast.js';
import { openWorkspace } from './dm.js';
import { griddedPng, solidPng } from './png.js';

// Tokens in preparation against the real server (PRP-04, specs/05-assets-and-images.md §2–§5,
// specs/06-grid-and-measurement.md §1, §4, specs/03-domain-model.md §4, specs/04-live-sync.md §2,
// specs/08-ux-journeys.md §8, §9, D-019, D-023, D-100, Q-091). The first test is Phase 2's exit test
// (specs/13-implementation-plan.md §5): a campaign prepared in the browser, with a mapped scene
// calibrated by each method in turn, a map-less scene and numbered tokens added through the picker,
// some hidden, moved with snapping and with Alt, then reloaded unchanged.

interface Token {
  id: string;
  label: string;
  x: number;
  y: number;
  hidden: boolean;
  z_order: number;
  asset_id: string;
}

interface Drawn {
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
const unique = () => `${Date.now()}-${seeds++}`;

async function create(page: Page, open: string, label: string, name: string) {
  await tree(page).getByRole('button', { name: open }).last().click();
  await tree(page).getByLabel(label).fill(name);
  await tree(page).getByRole('button', { name: 'Create' }).click();
  await expect(nameButton(page, name)).toBeVisible();
}

async function newAsset(
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

const tokensOf = async (page: Page, sceneId: string): Promise<Token[]> =>
  (await (await page.request.get(`/api/scenes/${sceneId}/tokens`)).json()) as Token[];
const drawn = async (page: Page): Promise<Drawn[]> =>
  JSON.parse((await viewport(page).getAttribute('data-tokens')) ?? '[]') as Drawn[];
const sceneIdOf = async (page: Page, sessionId: string, name: string): Promise<string> =>
  ((await (await page.request.get(`/api/sessions/${sessionId}/scenes`)).json()) as { id: string; name: string }[]).find(
    (scene) => scene.name === name,
  )!.id;

/** Screen coordinates of world point (wx, wy) on the canvas. */
async function screenOf(page: Page, wx: number, wy: number): Promise<[number, number]> {
  // The mouse does not scroll: at 1,280 × 720 the canvas lies partly below the fold (G-022).
  await viewport(page).scrollIntoViewIfNeeded();
  const camera = await cameraOf(page);
  const box = (await viewport(page).boundingBox())!;
  // The viewport's 1 px border.
  return [box.x + 1 + camera.x + wx * camera.scale, box.y + 1 + camera.y + wy * camera.scale];
}

/** Screen coordinates of the middle of grid square (gx, gy), for a grid of `square` world px from 0. */
async function squareCentre(page: Page, square: number, gx: number, gy: number): Promise<[number, number]> {
  return screenOf(page, (gx + 0.5) * square, (gy + 0.5) * square);
}

const picker = (page: Page) => page.getByRole('dialog', { name: 'Add a token' });
const status = (page: Page) => page.locator('main [role="status"]');

/** Add token, then the picker: search for the asset and choose it. */
async function pick(page: Page, name: string) {
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
async function dragBy(page: Page, label: string, dx: number, dy: number, alt = false) {
  await viewport(page).scrollIntoViewIfNeeded();
  const token = (await drawn(page)).find((each) => each.label === label)!;
  const box = (await viewport(page).boundingBox())!;
  const from = [box.x + 1 + token.left + token.side / 2, box.y + 1 + token.top + token.side / 2] as const;
  const perSquare = token.side;
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(from[0] + (dx * perSquare) / 2, from[1] + (dy * perSquare) / 2, { steps: 4 });
  await page.mouse.move(from[0] + dx * perSquare, from[1] + dy * perSquare, { steps: 4 });
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
}

const calibrationPanel = (page: Page) => page.getByRole('region', { name: 'Calibrate the grid' });
async function saveCalibration(page: Page) {
  await calibrationPanel(page).getByRole('button', { name: 'Save calibration' }).click();
  await expect(status(page)).toHaveText('Grid calibrated.');
}

test('Phase 2 exit: a campaign prepared in the browser, calibrated by each method, with numbered tokens some hidden, reloads unchanged', async ({
  page,
}) => {
  const id = unique();
  const campaign = `Prepared campaign ${id}`;
  const [goblinName, heroName] = [`Goblin ${id}`, `Hero ${id}`];
  await openWorkspace(page);
  await create(page, 'New campaign', 'Campaign name', campaign);
  await nameButton(page, campaign).click();
  await create(page, 'New session', 'Session title', 'Night one');
  await nameButton(page, 'Night one').click();
  await create(page, 'New scene', 'Scene name', 'Throne room');
  await create(page, 'New scene', 'Scene name', 'Open road');
  const campaignId = ((await (await page.request.get('/api/campaigns')).json()) as { id: string; name: string }[]).find(
    (each) => each.name === campaign,
  )!.id;
  const sessionId = (
    (await (await page.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as { id: string }[]
  )[0]!.id;
  const throne = await sceneIdOf(page, sessionId, 'Throne room');
  const road = await sceneIdOf(page, sessionId, 'Open road');
  const goblin = await newAsset(page, goblinName, { category: 'monster', size: 'medium' }, [160, 40, 40]);
  const hero = await newAsset(page, heroName, { category: 'pc', size: 'large' }, [40, 90, 160]);

  // A map with a drawn grid of 40 px squares: attached, then calibrated by each method in turn.
  await nameButton(page, 'Throne room').click();
  await page.getByLabel('Map image: PNG, JPEG or WebP').setInputFiles({
    name: 'throne.png',
    mimeType: 'image/png',
    buffer: griddedPng(1000, 720, { size: 40, offsetX: 0, offsetY: 0 }, [200, 170, (seeds * 7) % 90], [20, 20, 20]),
  });
  await page.getByRole('button', { name: 'Attach map' }).click();
  await expect(status(page)).toHaveText('Map attached.');
  await expect(viewport(page)).toBeVisible();

  await page.getByRole('button', { name: 'Calibrate grid' }).click();
  await calibrationPanel(page).getByLabel('Columns').fill('25');
  await calibrationPanel(page).getByLabel('Rows').fill('18');
  await saveCalibration(page);

  await page.getByRole('button', { name: 'Calibrate grid' }).click();
  await calibrationPanel(page).getByLabel('Rectangle', { exact: true }).check();
  // 3 × 3 drawn squares from world 400, 280 (display = original here, 1,000 px wide).
  await page.mouse.move(...(await screenOf(page, 400, 280)));
  await page.mouse.down();
  await page.mouse.move(...(await screenOf(page, 460, 340)), { steps: 5 });
  await page.mouse.move(...(await screenOf(page, 520, 400)), { steps: 5 });
  await page.mouse.up();
  await expect(calibrationPanel(page)).toContainText('Rectangle:');
  await saveCalibration(page);

  await page.getByRole('button', { name: 'Calibrate grid' }).click();
  await calibrationPanel(page).getByLabel('Fine tuning').check();
  await calibrationPanel(page).getByLabel('Square size (px)').fill('40');
  await calibrationPanel(page).getByLabel('Offset x (px)').fill('0');
  await calibrationPanel(page).getByLabel('Offset y (px)').fill('0');
  await saveCalibration(page);
  const grid = ((await (await page.request.get(`/api/scenes/${throne}`)).json()) as { grid: object }).grid;
  expect(grid).toMatchObject({ size: 40, offset_x: 0, offset_y: 0, columns: 25, rows: 18 });

  // Tokens through the picker, placed by a click on a square: hidden from the monster asset with
  // the bare name, numbered only when shown to players (Q-092); visible from the pc asset
  // (specs/05-assets-and-images.md §3, §4).
  for (const [gx, gy] of [
    [2, 2],
    [4, 2],
    [6, 2],
  ] as const) {
    await pick(page, goblinName);
    await page.mouse.click(...(await squareCentre(page, 40, gx, gy)));
    await expect(status(page)).toContainText('placed.');
  }
  await pick(page, heroName);
  // Just below and right of the corner shared by squares 10 and 11, clear of any rounding tie.
  await page.mouse.click(...(await screenOf(page, 10.8 * 40, 10.8 * 40)));
  await expect(status(page)).toHaveText(`${heroName} placed.`);
  let tokens = await tokensOf(page, throne);
  expect(tokens.map((each) => [each.label, each.x, each.y, each.hidden])).toEqual([
    [goblinName, 2, 2, true],
    [goblinName, 4, 2, true],
    [goblinName, 6, 2, true],
    // A Large token centred on the click covers the four squares around it.
    [heroName, 10, 10, false],
  ]);
  const [first, second, third] = tokens.map((each) => each.id);

  // Revealing numbers them: the first shown keeps the bare name, the second is 2 and the first 1.
  await page.getByLabel('Selected token').selectOption(first!);
  await page.getByRole('button', { name: `Reveal token ${goblinName}` }).click();
  await expect(status(page)).toHaveText(`${goblinName} revealed.`);
  await page.getByLabel('Selected token').selectOption(second!);
  await page.getByRole('button', { name: `Reveal token ${goblinName}` }).click();
  await expect(status(page)).toHaveText(`${goblinName} 2 revealed.`);
  await expect(page.getByRole('button', { name: `Hide token ${goblinName} 2` })).toBeVisible();
  // At 1,280 × 720, unscrolled, the token controls take at most one row more than before PRP-04
  // with a token selected, leaving the canvas's top above 560 px with long labels in the help line (G-022, D-100).
  const canvasTop = await page.evaluate(() => {
    window.scrollTo(0, 0);
    return document.querySelector('main [role="application"]')!.getBoundingClientRect().top;
  });
  expect(canvasTop).toBeLessThanOrEqual(560);
  expect((await tokensOf(page, throne)).map((each) => each.label)).toEqual([
    `${goblinName} 1`,
    `${goblinName} 2`,
    goblinName,
    heroName,
  ]);

  // Drag one with snapping and one, still hidden, with Alt held.
  await dragBy(page, `${goblinName} 1`, 2.3, 3.2);
  await expect
    .poll(async () => (await tokensOf(page, throne)).find((each) => each.id === first))
    .toMatchObject({ x: 4, y: 5 });
  await dragBy(page, goblinName, 1.4, 0.6, true);
  await expect.poll(async () => (await tokensOf(page, throne)).find((each) => each.id === third)!.x).not.toBe(6);
  const free = (await tokensOf(page, throne)).find((each) => each.id === third)!;
  expect(free.x).toBeCloseTo(7.4, 1);
  expect(free.y).toBeCloseTo(2.6, 1);
  expect(Number.isInteger(free.x)).toBe(false);
  expect(free.hidden).toBe(true);

  // A deleted number is never given again: the third shown is 3, not 2.
  await page.getByLabel('Selected token').selectOption(second!);
  await page.getByRole('button', { name: `Delete token ${goblinName} 2` }).click();
  await page
    .getByRole('dialog', { name: `Delete ${goblinName} 2?` })
    .getByRole('button', { name: 'Delete token' })
    .click();
  await expect(status(page)).toHaveText(`${goblinName} 2 deleted.`);
  await page.getByLabel('Selected token').selectOption(third!);
  await page.getByRole('button', { name: `Reveal token ${goblinName}` }).click();
  await expect(status(page)).toHaveText(`${goblinName} 3 revealed.`);
  // And one more, left hidden.
  await pick(page, goblinName);
  await page.mouse.click(...(await squareCentre(page, 40, 12, 3)));
  await expect(status(page)).toHaveText(`${goblinName} placed.`);

  // The map-less scene: a hero placed by keyboard at the centre of the view.
  await nameButton(page, 'Open road').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Open road');
  await pick(page, heroName);
  await expect(viewport(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText(`${heroName} placed.`);

  // Reload: the server holds the same, and the canvas draws it where it was.
  tokens = await tokensOf(page, throne);
  const roadTokens = await tokensOf(page, road);
  expect(roadTokens).toHaveLength(1);
  await nameButton(page, 'Throne room').click();
  // What is drawn, in grid units: the screen boxes depend on when the camera was fitted.
  const placedOf = async () => (await drawn(page)).map(({ id, label, hidden, x, y }) => ({ id, label, hidden, x, y }));
  await expect.poll(async () => (await drawn(page)).length).toBe(4);
  const before = await placedOf();
  await page.reload();
  await selectScene(page, { campaign, session: 'Night one', scene: 'Throne room' });
  expect(await tokensOf(page, throne)).toEqual(tokens);
  expect(await tokensOf(page, road)).toEqual(roadTokens);
  await expect.poll(placedOf).toEqual(before);
  expect(before.map((each) => [each.label, each.hidden])).toEqual([
    [`${goblinName} 1`, false],
    [`${goblinName} 3`, false],
    [heroName, false],
    [goblinName, true],
  ]);
  expect(((await (await page.request.get(`/api/scenes/${throne}`)).json()) as { grid: object }).grid).toEqual(grid);
  await expect(tree(page).getByRole('button', { name: 'Open road', exact: true })).toBeVisible();
  // The token image is the asset's display version, fetched for this DM session.
  const loaded = await page.evaluate(
    (src) => fetch(src).then((response) => response.status),
    `/images/${goblin.image_id}/display`,
  );
  expect(loaded).toBe(200);
  expect(roadTokens[0]).toMatchObject({ asset_id: hero.id, label: heroName, hidden: false });
});

test('tokens are added, chosen, moved and deleted by keyboard alone, with readable contrast', async ({ page }) => {
  const id = unique();
  const campaign = `Keyboard tokens ${id}`;
  const name = `Kobold ${id}`;
  await openWorkspace(page);
  await create(page, 'New campaign', 'Campaign name', campaign);
  await nameButton(page, campaign).click();
  await create(page, 'New session', 'Session title', 'Keys');
  await nameButton(page, 'Keys').click();
  await create(page, 'New scene', 'Scene name', 'Den');
  await newAsset(page, name, { category: 'monster', size: 'small' }, [120, 120, 40]);
  await nameButton(page, 'Den').click();
  const add = page.getByRole('button', { name: 'Add token' });
  await expect(add).toBeVisible();

  // Tab reaches Add token from the scene's name in the tree; Enter opens the picker.
  await nameButton(page, 'Den').focus();
  for (let presses = 0; presses < 40 && !(await add.evaluate((e) => e === document.activeElement)); presses++) {
    await page.keyboard.press('Tab');
  }
  await expect(add).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(picker(page)).toBeVisible();
  expect(await contrastFailures(page), 'token picker').toEqual([]);
  await page.keyboard.type(name);
  const choose = picker(page).getByRole('button', { name: `Choose ${name}` });
  await expect(choose).toBeVisible();
  for (let presses = 0; presses < 20 && !(await choose.evaluate((e) => e === document.activeElement)); presses++) {
    await page.keyboard.press('Tab');
  }
  await expect(choose).toBeFocused();
  await page.keyboard.press('Enter');
  // The map takes focus; Enter places the token at the centre of the view.
  await expect(viewport(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText(`${name} placed.`);
  const [placed] = await drawn(page);
  expect(placed!.label).toBe(name);
  expect(placed!.hidden).toBe(true);

  // The arrow keys move the selected token a square; Escape lets it go.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await drawn(page))[0]).toMatchObject({ x: placed!.x + 1, y: placed!.y + 1 });
  expect(await contrastFailures(page), 'token bar').toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Selected token')).toHaveValue('');

  // Chosen again from the token bar, then deleted from the map with Delete and the confirmation.
  await page.getByLabel('Selected token').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByLabel('Selected token')).toHaveValue(placed!.id);
  await viewport(page).focus();
  await page.keyboard.press('Delete');
  const dialog = page.getByRole('dialog', { name: `Delete ${name}?` });
  await expect(dialog).toBeVisible();
  expect(await contrastFailures(page), 'delete token dialog').toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(viewport(page)).toBeFocused();
  await page.keyboard.press('Delete');
  await dialog.getByRole('button', { name: 'Delete token' }).focus();
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText(`${name} deleted.`);
  await expect.poll(async () => (await drawn(page)).length).toBe(0);
});
