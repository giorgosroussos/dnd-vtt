import { expect, test } from '@playwright/test';
import { E2E_PIN } from './dm.js';

// The First run journey (specs/08-ux-journeys.md §10, specs/07-security-and-access.md
// §1, §2): on the server PC, the DM sets the PIN in the DM view, works, signs out and
// signs in again. Runs alone, before every other test, on the server's fresh data
// directory (the `first-run` project of playwright.config.ts, D-086).

test('the DM sets the PIN on the server PC, signs out and signs in again', async ({ page, browser }) => {
  await page.goto('/dm');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Set the DM PIN');
  await page.getByLabel('PIN, 4 to 8 digits').fill(E2E_PIN);
  await page.getByLabel('The same PIN again').fill(E2E_PIN);
  await page.getByRole('button', { name: 'Set PIN' }).click();

  const tree = page.getByRole('navigation', { name: 'Campaigns, sessions and scenes' });
  await expect(tree).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('No scene selected');
  // The session is the browser's until the server restarts.
  await page.reload();
  await expect(tree).toBeVisible();

  // Another browser now gets the PIN form, never setup again.
  const other = await browser.newPage();
  await other.goto('/dm');
  await expect(other.getByRole('heading', { level: 1 })).toHaveText('Enter the DM PIN');
  await other.close();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Enter the DM PIN');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Enter the DM PIN');

  await page.getByLabel('PIN', { exact: true }).fill('0000');
  await page.getByRole('button', { name: 'Enter' }).click();
  await expect(page.getByText('That PIN is not correct.')).toBeVisible();
  await expect(tree).toHaveCount(0);

  await page.getByLabel('PIN', { exact: true }).fill(E2E_PIN);
  await page.getByRole('button', { name: 'Enter' }).click();
  await expect(tree).toBeVisible();
});
