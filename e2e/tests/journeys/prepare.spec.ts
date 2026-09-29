import { expect, test } from '@playwright/test';
import { nameButton, selectScene, tree, viewport } from '../canvas-view.js';
import { openWorkspace } from '../dm.js';
import { griddedPng } from '../png.js';
import {
  calibrationPanel,
  create,
  dragBy,
  drawn,
  newAsset,
  pick,
  saveCalibration,
  sceneIdOf,
  screenOf,
  squareCentre,
  status,
  tokensOf,
  unique,
} from '../prep.js';
import { deleteAssets, deleteCampaign, framesOf, player } from './support.js';

// Journey 2, Prepare (specs/10-testing-acceptance.md §5, specs/08-ux-journeys.md §10, specs/03-domain-model.md,
// specs/06-grid-and-measurement.md §1, specs/05-assets-and-images.md §3–§5, Q-091, Q-092), which is also
// Phase 2's exit test (specs/13-implementation-plan.md §5): a campaign prepared in the browser, with a mapped
// scene calibrated by each method in turn, a map-less scene and numbered tokens added through the picker,
// some hidden, moved with snapping and with Alt, then reloaded unchanged; a TV connected all along hears
// nothing of it (REL-02, D-127).

test('Prepare (Phase 2 exit): a campaign prepared in the browser, calibrated by each method, with numbered tokens some hidden, reloads unchanged and reaches no TV', async ({
  page,
  browser,
}, info) => {
  // The longest journey: some forty steps, which WebKit on the Windows runner (CI run 36563039931) and
  // Firefox on a loaded machine take past the default 30 s, each step passing (D-131). Only those
  // engines get longer; Chromium and Edge keep the default, so a slowdown there still fails (review T-L2).
  if (['webkit', 'firefox'].includes(info.project.name)) test.setTimeout(90_000);
  // Unique across the browsers of the matrix too; kept short, since the layout check below reads long labels.
  const id = unique();
  // A TV connected all along: preparing reaches no client but the DM view (specs/02-architecture.md §4).
  const tvContext = await browser.newContext();
  const tv = await tvContext.newPage();
  const tvFrames = framesOf(tv);
  await tv.goto('/');
  await expect(player(tv)).toHaveAttribute('data-scene', 'idle');
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
    buffer: griddedPng(
      1000,
      720,
      { size: 40, offsetX: 0, offsetY: 0 },
      [200, 170, [...id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 90],
      [20, 20, 20],
    ),
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

  // The TV stayed on the idle screen and heard nothing of it: no scene, asset, token or name. It was
  // connected all along: its idle snapshot arrived, so the silence is not a TV that never listened
  // (review M4).
  await expect(player(tv)).toHaveAttribute('data-scene', 'idle');
  expect(tvFrames.some((frame) => frame.startsWith('42') && frame.includes('"scene.snapshot"'))).toBe(true);
  const heard = tvFrames.join('\n');
  for (const secret of [campaign, throne, road, goblin.id, hero.id, goblin.image_id, goblinName, heroName, 'token.']) {
    expect(heard, secret).not.toContain(secret);
  }
  await tvContext.close();
  await deleteCampaign(page, campaignId);
  await deleteAssets(page, [goblin.id, hero.id]);
});
