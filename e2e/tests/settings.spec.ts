import { expect, test, type Page } from '@playwright/test';
import { openSetup, selectScene, viewport } from './canvas-view.js';
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
const panel = (page: Page) => page.locator('main.eg-scene');
const liveBar = (page: Page) => page.getByRole('region', { name: 'Live scene' });
const feetOn = async (page: Page): Promise<number | undefined> =>
  (JSON.parse((await tvCanvas(page).getAttribute('data-ruler')) ?? 'null') as { feet: number } | null)?.feet;

/** Opens Settings from the keyboard, runs `change` there, saves with Enter and closes with Escape. */
async function saveSettings(dm: Page, change: (dialog: ReturnType<Page['getByRole']>) => Promise<void>) {
  // In the header, beside the screens counter (UIX-01).
  const open = dm.getByRole('banner').getByRole('button', { name: 'Settings', exact: true });
  await open.focus();
  await dm.keyboard.press('Enter');
  const dialog = dm.getByRole('dialog', { name: 'Settings' });
  // Focus lands in the first setting once they have been read.
  await expect(dialog.getByLabel('Upload limit, in MB')).toBeFocused();
  await change(dialog);
  await expect(dialog.getByRole('status').first()).toHaveText(/^Settings saved\./);
  await dm.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // Focus returns to the button that opened it (review U-H1).
  await expect(open).toBeFocused();
}

test('settings saved in the DM view take effect with no restart: the upload limit and the TV’s distance', async ({
  browser,
}) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const tv = await playerContext.newPage();
  await openWorkspace(dm);

  // A long live scene name: at 1,024 px the live indicator still keeps one line (review U-M4).
  await dm.setViewportSize({ width: 1024, height: 700 });
  const names = {
    campaign: `Settings REL-01 ${Date.now()}`,
    session: 'Tuning night',
    scene: 'The wide hall under the old keep, where the river runs',
  };
  const before = (await (await dm.request.get('/api/settings')).json()) as Record<string, unknown>;
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
    await saveSettings(dm, async () => {
      // Typed, then saved with Enter in the field.
      await dm.keyboard.press('ControlOrMeta+a');
      await dm.keyboard.type('1');
      await dm.keyboard.press('Enter');
    });
    await selectScene(dm, names);
    await openSetup(dm);
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
    await panel(dm).getByRole('button', { name: 'Ruler, M' }).click();
    await viewport(dm).focus();
    for (const key of ['Enter', 'ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowDown']) await dm.keyboard.press(key);
    // Two diagonals: 10 ft by the PHB rule.
    await expect.poll(() => feetOn(tv)).toBe(10);
    // The header's live indicator keeps one line with the long name and its buttons.
    expect((await liveBar(dm).boundingBox())!.height).toBeLessThanOrEqual(42);
    await saveSettings(dm, async (dialog) => {
      // Tab to the rule, arrow to DMG, back to a text field and Enter.
      await dm.keyboard.press('Tab');
      await dm.keyboard.press('Tab');
      await expect(dialog.getByLabel('Every diagonal square counts 5 ft (PHB)')).toBeFocused();
      await dm.keyboard.press('ArrowDown');
      await expect(dialog.getByLabel('Diagonals alternate 5 ft and 10 ft (DMG)')).toBeChecked();
      await dm.keyboard.press('Shift+Tab');
      await dm.keyboard.press('Enter');
    });
    // The same measurement, counted again on the server: 15 ft.
    await expect.poll(() => feetOn(tv)).toBe(15);
  } finally {
    // Put the settings back for the other tests, and leave no campaign behind.
    const { upload_limit_bytes, display_variant_size, ruler_rule } = before;
    const restored = await dm.request.patch('/api/settings', {
      data: { upload_limit_bytes, display_variant_size, ruler_rule },
    });
    expect(restored.ok(), await restored.text()).toBe(true);
    const summary = await dm.request.get(`/api/campaigns/${campaignId}/deletion`);
    if (summary.ok()) {
      await dm.request.delete(`/api/campaigns/${campaignId}`, { data: { confirm: (await summary.json()) as object } });
    }
    await dmContext.close();
    await playerContext.close();
  }
});
