import { expect, test } from '@playwright/test';
import { openWorkspace } from '../dm.js';
import { commandFromPage } from '../socket.js';
import { player } from './support.js';

// Journey 3, Connect TV (specs/10-testing-acceptance.md §5, specs/08-ux-journeys.md §4, §5, §10, Q-025,
// Q-026, Q-053): the DM opens "Connect a screen", the TV opens the URL shown there, typed as it reads,
// and shows the dark idle screen with the product name only. The owner's LG TV is REL-03 (G-002).

test('Connect TV: the URL in Connect a screen, typed on the TV, opens the idle screen', async ({ browser }) => {
  const dmContext = await browser.newContext();
  const tvContext = await browser.newContext();
  try {
    const dm = await dmContext.newPage();
    await openWorkspace(dm);
    // Whatever an earlier journey left live, this one starts with nothing on the TV.
    await commandFromPage(dm, 'scene.deactivate', {});

    await dm.getByRole('button', { name: 'Connect a screen' }).click();
    const dialog = dm.getByRole('dialog', { name: 'Connect a screen' });
    await expect(dialog).toBeVisible();
    const shown = dialog.locator('.eg-connect__url');
    await expect(shown).toHaveText(/^http:\/\/[\d.]+:\d+\/$/);
    const typed = (await shown.textContent())!;
    // The QR code opens the same address; neither names the DM view.
    await expect(dialog.getByRole('img', { name: `QR code that opens ${typed}` })).toBeVisible();
    await expect(dialog).not.toContainText('/dm');
    await dialog.getByRole('button', { name: 'Close' }).click();

    // The TV types it: a browser with no DM session, on this PC's LAN address.
    const tv = await tvContext.newPage();
    const response = await tv.goto(typed);
    expect(response?.status()).toBe(200);
    await expect(player(tv)).toHaveAttribute('data-scene', 'idle');
    await expect(player(tv)).toHaveText('Emberglass');
    await expect(tv.locator('button, a[href], input, select, textarea, [tabindex]')).toHaveCount(0);
    await expect(tv.locator('.eg-idle')).toHaveCSS('background-color', 'rgb(20, 17, 15)');
  } finally {
    await dmContext.close();
    await tvContext.close();
  }
});
