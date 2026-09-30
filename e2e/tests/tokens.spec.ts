import { expect, test } from '@playwright/test';
import { nameButton, sceneRow, selectedTokenLabel, viewport } from './canvas-view.js';
import { contrastFailures } from './contrast.js';
import { openWorkspace } from './dm.js';
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
