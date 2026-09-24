import { expect, test, type Page } from '@playwright/test';
import { openWorkspace } from './dm.js';

// The sidebar tree against the real server (PRP-01, specs/08-ux-journeys.md §1,
// specs/03-domain-model.md §7, Q-089, D-078, D-085): build a campaign, rename,
// reorder by dragging and by keyboard, delete through the confirmation.

const tree = (page: Page) => page.getByRole('navigation', { name: 'Campaigns, sessions and scenes' });
const nameButton = (page: Page, name: string) => tree(page).getByRole('button', { name, exact: true });
// `has` is matched inside each row, so it takes a locator relative to it.
const row = (page: Page, name: string) =>
  tree(page).locator('.eg-tree__row', { has: page.getByRole('button', { name, exact: true }) });
const levelNames = (page: Page, level: string) =>
  tree(page).locator(`.eg-tree__item--${level} > .eg-tree__row [data-action="name"]`).allTextContents();

async function create(page: Page, open: string, label: string, name: string) {
  await tree(page).getByRole('button', { name: open }).last().click();
  await tree(page).getByLabel(label).fill(name);
  await tree(page).getByRole('button', { name: 'Create' }).click();
  await expect(nameButton(page, name)).toBeVisible();
}

test('the DM builds, renames, reorders and deletes in the tree', async ({ page }) => {
  const campaign = `Tree campaign ${Date.now()}`;
  await openWorkspace(page);

  await create(page, 'New campaign', 'Campaign name', campaign);
  await nameButton(page, campaign).click();
  await create(page, 'New session', 'Session title', 'One');
  await create(page, 'New session', 'Session title', 'Two');
  await nameButton(page, 'One').click();
  for (const scene of ['Cave', 'Hall', 'Bridge']) await create(page, 'New scene', 'Scene name', scene);

  await tree(page).getByRole('button', { name: 'Rename Hall' }).click();
  await tree(page).getByLabel('New name for Hall').fill('Great hall');
  await tree(page).getByRole('button', { name: 'Save' }).click();
  await expect(nameButton(page, 'Great hall')).toBeVisible();

  // Dragging a scene onto a sibling puts it there (Q-089).
  await row(page, 'Bridge').dragTo(row(page, 'Cave'));
  await expect.poll(() => levelNames(page, 'scene')).toEqual(['Bridge', 'Cave', 'Great hall']);

  // The keyboard alternative: Move up, operated with Enter.
  await tree(page).getByRole('button', { name: 'Move Two up' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => levelNames(page, 'session')).toEqual(['Two', 'One']);
  await expect(tree(page).getByRole('button', { name: 'Two', exact: true })).toBeFocused();

  // Selecting a scene names it in the main area.
  await nameButton(page, 'Cave').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cave');

  // The server kept both orders.
  await page.reload();
  await nameButton(page, campaign).click();
  await expect.poll(() => levelNames(page, 'session')).toEqual(['Two', 'One']);
  await nameButton(page, 'One').click();
  await expect.poll(() => levelNames(page, 'scene')).toEqual(['Bridge', 'Cave', 'Great hall']);

  // Escape cancels a deletion; the dialog's counts come from the server.
  await tree(page)
    .getByRole('button', { name: `Delete ${campaign}` })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Sessions: 2');
  await expect(dialog).toContainText('Scenes: 3');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(nameButton(page, campaign)).toBeVisible();

  await tree(page).getByRole('button', { name: 'Delete One' }).click();
  await expect(dialog).toContainText('Delete One?');
  await expect(dialog).toContainText('Scenes: 3');
  await expect(dialog).toContainText('Tokens: 0');
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => levelNames(page, 'session')).toEqual(['Two']);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('No scene selected');
});
