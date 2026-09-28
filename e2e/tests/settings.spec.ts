import { expect, test, type Page } from '@playwright/test';
import { selectScene, viewport } from './canvas-view.js';
import { openWorkspace, seedCampaign } from './dm.js';
import { solidPng } from './png.js';

// REL-01: the settings change against the production server with no restart (specs/09-operations.md §7,
// specs/05-assets-and-images.md §6, specs/06-grid-and-measurement.md §5, Q-051, G-036). A DM context and
// a player context at once: an upload limit saved in the Settings dialog is the one the next upload is
// refused at, in the DM view and by the server, and a new diagonal rule changes the distance the TV shows
// for the measurement already on it. The settings are put back afterwards: every test shares the server.

const MB = 1024 * 1024;
const player = (page: Page) => page.locator('main[data-view="player"]');
const tvCanvas = (page: Page) => page.locator('main[data-view="player"] .eg-canvas--player');
const panel = (page: Page) => page.locator('main .eg-scene');
const liveBar = (page: Page) => page.getByRole('region', { name: 'Live scene' });
const feetOn = async (page: Page): Promise<number | undefined> =>
  (JSON.parse((await tvCanvas(page).getAttribute('data-ruler')) ?? 'null') as { feet: number } | null)?.feet;

async function saveSettings(dm: Page, change: (dialog: ReturnType<Page['getByRole']>) => Promise<void>) {
  await liveBar(dm).getByRole('button', { name: 'Settings' }).click();
  const dialog = dm.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByLabel('Upload limit, in MB')).not.toHaveValue('');
  await change(dialog);
  await dialog.getByRole('button', { name: 'Save settings' }).click();
  await expect(dialog.getByRole('status').first()).toHaveText(/^Settings saved\./);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
}

test('settings saved in the DM view take effect with no restart: the upload limit and the TV’s distance', async ({
  browser,
}) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const tv = await playerContext.newPage();
  await openWorkspace(dm);

  const names = { campaign: `Settings REL-01 ${Date.now()}`, session: 'Tuning night', scene: 'Wide hall' };
  const campaignId = await seedCampaign(dm, names.campaign, [names.session]);
  const [session] = (await (await dm.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as { id: string }[];
  const hall = (await (
    await dm.request.post(`/api/sessions/${session!.id}/scenes`, { data: { name: names.scene } })
  ).json()) as { id: string };
  const map = (await (
    await dm.request.post('/api/images', {
      data: solidPng(600, 400, [40, 60, 50]),
      headers: { 'content-type': 'application/octet-stream' },
    })
  ).json()) as { id: string };
  expect((await dm.request.patch(`/api/scenes/${hall.id}`, { data: { map_image_id: map.id } })).ok()).toBe(true);
  await dm.reload();

  try {
    // The upload limit: 1 MB, saved from the dialog.
    await saveSettings(dm, (dialog) => dialog.getByLabel('Upload limit, in MB').fill('1'));
    await selectScene(dm, names);
    await dm.getByLabel('Map image: PNG, JPEG or WebP').setInputFiles({
      name: 'big.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(1.5 * MB),
    });
    await expect(panel(dm)).toContainText('This file is 1.5 MB; the upload limit is 1 MB.');
    // The server refuses at the new limit too, naming it.
    const refused = await dm.request.post('/api/images', {
      data: Buffer.alloc(2 * MB),
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(refused.status()).toBe(413);
    expect(((await refused.json()) as { error: { details: { message: string }[] } }).error.details).toEqual([
      { path: '', message: `limit: ${MB} bytes` },
    ]);

    // The rule: a diagonal measurement on the TV, by the PHB rule, then by the DMG rule once saved.
    await tv.goto('/');
    await expect(player(tv)).toHaveAttribute('data-scene', 'idle');
    await liveBar(dm)
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await expect(panel(dm)).toHaveAttribute('data-mode', 'live');
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    await panel(dm).getByRole('button', { name: 'Ruler', exact: true }).click();
    await viewport(dm).focus();
    for (const key of ['Enter', 'ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowDown']) await dm.keyboard.press(key);
    // Two diagonals: 10 ft by the PHB rule.
    await expect.poll(() => feetOn(tv)).toBe(10);
    await saveSettings(dm, (dialog) => dialog.getByLabel('Diagonals alternate 5 ft and 10 ft (DMG)').check());
    // The same measurement, counted again on the server: 15 ft.
    await expect.poll(() => feetOn(tv)).toBe(15);
  } finally {
    // Put the settings back for the other tests, and leave no campaign behind.
    await dm.request.patch('/api/settings', {
      data: { upload_limit_bytes: 50 * MB, display_variant_size: 4096, ruler_rule: 'phb' },
    });
    const summary = await dm.request.get(`/api/campaigns/${campaignId}/deletion`);
    if (summary.ok()) {
      await dm.request.delete(`/api/campaigns/${campaignId}`, { data: { confirm: (await summary.json()) as object } });
    }
    await dmContext.close();
    await playerContext.close();
  }
});
