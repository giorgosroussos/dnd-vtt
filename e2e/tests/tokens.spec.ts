import { expect, test } from '@playwright/test';
import {
  nameButton,
  onScreen,
  sceneRow,
  selectScene,
  selectedTokenLabel,
  tokenPopover,
  viewport,
} from './canvas-view.js';
import { contrastFailures } from './contrast.js';
import { openWorkspace, seedCampaign } from './dm.js';
import { solidPng } from './png.js';
import { create, drawn, newAsset, picker, status, unique } from './prep.js';

// Tokens in preparation against the real server (PRP-04, specs/05-assets-and-images.md §2–§5,
// specs/06-grid-and-measurement.md §4, specs/08-ux-journeys.md §8, D-100): added, chosen, moved and
// deleted by keyboard alone. Phase 2's exit test, which prepares a whole campaign in the browser, is
// the Prepare journey now (journeys/prepare.spec.ts, REL-02).

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
  const add = page.getByRole('button', { name: 'Add token, T' });
  await expect(add).toBeVisible();

  // Tab reaches Add token on the tool rail from the scene's row in the scene list; Enter opens the picker
  // (UIX-01).
  await sceneRow(page, 'Den').focus();
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
  expect(await contrastFailures(page), 'token popover').toEqual([]);
  await page.keyboard.press('Escape');
  await expect(selectedTokenLabel(page)).toHaveCount(0);

  // Chosen again from the "In this scene" list by keyboard, then deleted from the map with Delete and the
  // confirmation (UIX-01).
  await page.locator('.eg-token-row__select').first().focus();
  await page.keyboard.press('Enter');
  await expect(selectedTokenLabel(page)).toHaveText(name);
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

// D-156: a press on a token released within 4 px is a click and opens its popover; one that moves past that
// is a drag, which closes the popover and leaves the token selected, with real pointer events.
test('a click on a token opens its popover and a drag closes it, keeping the token selected', async ({ page }) => {
  await openWorkspace(page);
  const id = unique();
  const names = { campaign: `Popover drag ${id}`, session: 'Drag night', scene: 'Ford' };
  const campaignId = await seedCampaign(page, names.campaign, [names.session]);
  const [session] = (await (await page.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as {
    id: string;
  }[];
  const post = async <T>(url: string, data: unknown, binary = false): Promise<T> =>
    (await (
      await page.request.post(
        url,
        binary ? { data, headers: { 'content-type': 'application/octet-stream' } } : { data },
      )
    ).json()) as T;
  const map = await post<{ id: string }>('/api/images', solidPng(600, 400, [60, 50, 40]), true);
  const scene = await post<{ id: string }>(`/api/sessions/${session!.id}/scenes`, {
    name: names.scene,
    map_image_id: map.id,
  });
  const image = await post<{ id: string }>('/api/images', solidPng(64, 64, [90, 40, 30]), true);
  const label = `Troll ${id}`;
  const asset = await post<{ id: string }>('/api/assets', {
    name: label,
    category: 'monster',
    image_id: image.id,
    size: 'large',
    default_hidden: false,
  });
  await page.request.post(`/api/scenes/${scene.id}/tokens`, { data: { asset_id: asset.id, x: 3, y: 3 } });
  await page.reload();
  await selectScene(page, names);

  const centre = async (): Promise<[number, number]> => {
    const [token] = await drawn(page);
    const box = (await viewport(page).boundingBox())!;
    const [point] = await onScreen(page, [
      [box.x + token!.left + token!.side / 2, box.y + token!.top + token!.side / 2],
    ]);
    return point!;
  };

  // A click with 2 px of jitter opens the popover.
  let [x, y] = await centre();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 2, y + 1);
  await page.mouse.up();
  await expect(tokenPopover(page)).toBeVisible();
  await expect(selectedTokenLabel(page)).toHaveText(label);

  // A drag of the token whose popover is open closes it, moves the token, and leaves it selected.
  const before = (await drawn(page))[0]!;
  [x, y] = await centre();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 30, y + 10, { steps: 6 });
  await expect(tokenPopover(page)).toHaveCount(0);
  await page.mouse.move(x + 120, y + 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await drawn(page))[0]!.x).not.toBe(before.x);
  await expect(selectedTokenLabel(page)).toHaveText(label);
  await expect(tokenPopover(page)).toHaveCount(0);

  // Clicking it again opens the popover; Space and a drag pans the view and closes it.
  [x, y] = await centre();
  await page.mouse.click(x, y);
  await expect(tokenPopover(page)).toBeVisible();
  await page.keyboard.down('Space');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 80, y - 40, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await expect(tokenPopover(page)).toHaveCount(0);
  await expect(selectedTokenLabel(page)).toHaveText(label);
});
