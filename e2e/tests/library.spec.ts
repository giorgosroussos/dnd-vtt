import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openWorkspace } from './dm.js';
import { solidPng } from './png.js';

// The library panel and the live bar against the real server (PRP-01 part 2,
// specs/08-ux-journeys.md §1, specs/05-assets-and-images.md §1, §4, §6, D-088): an
// asset is created from a generated image in one action, found by search and by
// tag, edited and deleted.

const library = (page: Page) => page.getByRole('complementary', { name: 'Asset library' });

test('the DM creates an asset with its image, finds it, edits it and deletes it', async ({ page }) => {
  const name = `Library goblin ${Date.now()}`;
  await openWorkspace(page);
  await expect(page.getByRole('region', { name: 'Live scene' })).toContainText(
    'Nothing is live. The TV shows the idle screen.',
  );

  await library(page).getByRole('button', { name: 'New asset' }).click();
  const dialog = page.getByRole('dialog', { name: 'New asset' });
  await dialog.getByLabel('Image: PNG, JPEG or WebP').setInputFiles({
    name: 'goblin.png',
    mimeType: 'image/png',
    buffer: solidPng(64, 48, [40, 160, 90]),
  });
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel('Size').selectOption('small');
  await dialog.getByLabel('Tags, separated by commas').fill('E2E-Cave, goblinoid');
  await expect(dialog.getByLabel('Tokens of this asset start hidden')).toBeChecked();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);

  const item = library(page).locator('.eg-library__item', { hasText: name });
  await expect(item).toContainText('Monster · Small');
  await expect(item).toContainText('Hidden when placed');
  // The thumbnail is the server's, loaded for this DM session.
  const thumbnail = item.locator('img');
  await expect(thumbnail).toHaveAttribute('src', /^\/images\/[0-9a-f]{64}\/thumbnail$/);
  await expect.poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  // Search by a substring of the name, then filter by the tag, stored in lower case.
  await library(page).getByLabel('Search names and tags').fill(name.slice(8, 20));
  await expect(library(page).locator('.eg-library__name')).toHaveText([name]);
  await library(page).getByLabel('Search names and tags').fill('');
  await library(page).getByRole('button', { name: 'Show only e2e-cave' }).click();
  await expect(library(page).locator('.eg-library__name')).toHaveText([name]);

  await library(page)
    .getByRole('button', { name: `Edit ${name}` })
    .click();
  const edit = page.getByRole('dialog', { name: `Edit ${name}` });
  await edit.getByLabel('Category').selectOption('npc');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(item).toContainText('NPC · Small');

  await library(page)
    .getByRole('button', { name: `Delete ${name}` })
    .click();
  const remove = page.getByRole('dialog', { name: `Delete ${name}?` });
  await remove.getByRole('button', { name: 'Delete' }).click();
  await expect(remove).toHaveCount(0);
  await expect(library(page).locator('.eg-library__item', { hasText: name })).toHaveCount(0);
});

test('a file over the upload limit is refused before it is sent', async ({ page }) => {
  await openWorkspace(page);
  const uploads: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/images')) uploads.push(request.method());
  });
  await library(page).getByRole('button', { name: 'New asset' }).click();
  const dialog = page.getByRole('dialog', { name: 'New asset' });
  // 51 MiB of zeros: over the default limit of 50 MB (D-075); its content never matters.
  // Written to a file, since Playwright passes no buffer over 50 MB.
  const huge = test.info().outputPath('huge.png');
  writeFileSync(huge, Buffer.alloc(51 * 1024 * 1024));
  await dialog.getByLabel('Image: PNG, JPEG or WebP').setInputFiles(huge);
  await expect(dialog).toContainText('This file is 51 MB; the upload limit is 50 MB.');
  await dialog.getByLabel('Name', { exact: true }).fill('Huge');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toContainText('This file is 51 MB; the upload limit is 50 MB.');
  expect(uploads).toEqual([]);
});
