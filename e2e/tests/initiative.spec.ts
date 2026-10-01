import { expect, test, type Page } from '@playwright/test';
import { selectScene, selectTokenRow, tokenPopover } from './canvas-view.js';
import { openWorkspace, seedCampaign } from './dm.js';
import { solidPng } from './png.js';
import { framesOf } from './journeys/support.js';

// TBL-06: a whole combat against the production server (specs/04-live-sync.md §4, §14, specs/08-ux-journeys.md
// §12, Q-104, Q-106). A DM context and a player context at once: combat started from the visible player
// characters, numbers typed, a tie fixed by a drag, turns passed with Enter and Shift+Enter across rounds, a
// hidden monster revealed mid-fight, a player character revealed and added, the TV reloaded, every enemy
// marked Dead, the prompt, and combat ended. The TV's strip follows the DM's order throughout and never
// names an enemy or carries an initiative number.

const player = (page: Page) => page.locator('main[data-view="player"]');
const panel = (page: Page) => page.locator('main.eg-scene');
const liveBar = (page: Page) => page.getByRole('region', { name: 'Live scene' });
const initiativeTab = (page: Page) => page.getByRole('tab', { name: /^Initiative/ });
const rows = (page: Page) => page.locator('.eg-initiative__row .eg-initiative__line .eg-initiative__name');
const currentRow = (page: Page) =>
  page.locator('.eg-initiative__row--current .eg-initiative__line .eg-initiative__name');
const strip = (page: Page) => page.locator('.eg-player__initiative');
const cards = (page: Page) => page.locator('.eg-player__initiative-card .eg-player__initiative-name');
const stripTurn = (page: Page) => page.locator('.eg-player__initiative-card--current .eg-player__initiative-name');
const field = (page: Page, name: string) => page.getByRole('textbox', { name: `Initiative of ${name}` });

test('a combat runs end to end: order, ties, turns and rounds, a reveal, the dead, the prompt, and the TV strip in step', async ({
  browser,
}) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const tv = await playerContext.newPage();
  const tvFrames = framesOf(tv);
  await openWorkspace(dm);

  const stamp = Date.now();
  const names = { campaign: `Initiative TBL-06 ${stamp}`, session: 'Battle night', scene: 'Ambush at the ford' };
  const campaignId = await seedCampaign(dm, names.campaign, [names.session]);
  const [session] = (await (await dm.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as { id: string }[];
  const post = async <T>(url: string, data: unknown, binary = false): Promise<T> =>
    (await (
      await dm.request.post(url, binary ? { data, headers: { 'content-type': 'application/octet-stream' } } : { data })
    ).json()) as T;
  const map = await post<{ id: string }>('/api/images', solidPng(600, 400, [60, 50, 40]), true);
  const scene = await post<{ id: string }>(`/api/sessions/${session!.id}/scenes`, {
    name: names.scene,
    map_image_id: map.id,
  });
  const assets: string[] = [];
  const asset = async (name: string, category: 'pc' | 'monster', hidden: boolean, colour: [number, number, number]) => {
    const image = await post<{ id: string }>('/api/images', solidPng(64, 64, colour), true);
    const made = await post<{ id: string }>('/api/assets', {
      name,
      category,
      image_id: image.id,
      size: 'medium',
      default_hidden: hidden,
    });
    assets.push(made.id);
    return made;
  };
  const label = { tamsin: `Tamsin ${stamp}`, wren: `Wren ${stamp}`, goblin: `Goblin ${stamp}`, ogre: `Ogre ${stamp}` };
  const place = async (assetId: string, x: number, y: number) =>
    post<{ token: { id: string } }>(`/api/scenes/${scene.id}/tokens`, { asset_id: assetId, x, y });
  await place((await asset(label.tamsin, 'pc', false, [40, 90, 160])).id, 1, 1);
  await place((await asset(label.wren, 'pc', true, [40, 160, 90])).id, 2, 1);
  await place((await asset(label.goblin, 'monster', false, [160, 60, 40])).id, 6, 4);
  const ogre = await place((await asset(label.ogre, 'monster', true, [120, 40, 40])).id, 8, 4);
  await dm.reload();

  try {
    await tv.goto('/');
    await selectScene(dm, names);
    await liveBar(dm)
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await expect(panel(dm)).toHaveAttribute('data-mode', 'live');
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');

    // Start combat: the visible player character and the Enemies; Wren is hidden, so has no row.
    await initiativeTab(dm).click();
    await dm.getByRole('button', { name: 'Start combat' }).click();
    await expect(rows(dm)).toHaveText([label.tamsin, 'Enemies']);
    await expect(strip(tv)).toBeVisible();
    await expect(cards(tv)).toHaveText([label.tamsin, 'Enemies']);
    await expect(initiativeTab(dm)).toHaveText('Initiative · R1');

    // A tie at 12: the Enemies dragged above Tamsin, which stands until a number is typed again.
    await field(dm, label.tamsin).fill('12');
    await field(dm, label.tamsin).press('Enter');
    await field(dm, 'Enemies').fill('12');
    await field(dm, 'Enemies').press('Enter');
    await expect(rows(dm)).toHaveText([label.tamsin, 'Enemies']);
    await dm.locator('.eg-initiative__row[data-kind="dm"]').dragTo(dm.locator('.eg-initiative__row[data-kind="pc"]'));
    await expect(rows(dm)).toHaveText(['Enemies', label.tamsin]);
    await expect(cards(tv)).toHaveText(['Enemies', label.tamsin]);

    // Turns with Enter and Shift+Enter across rounds; a click on the round heading takes focus off the field.
    await dm.locator('.eg-initiative__round').click();
    await expect(currentRow(dm)).toHaveText(label.tamsin);
    await dm.keyboard.press('Enter');
    await expect(currentRow(dm)).toHaveText('Enemies');
    await expect(dm.locator('.eg-initiative__round')).toHaveText('Round 2');
    await expect(stripTurn(tv)).toHaveText('Enemies');
    await expect(strip(tv)).toContainText('Round 2');
    await dm.keyboard.press('Enter');
    await dm.keyboard.press('Enter');
    await expect(dm.locator('.eg-initiative__round')).toHaveText('Round 3');
    await dm.keyboard.press('Shift+Enter');
    await expect(dm.locator('.eg-initiative__round')).toHaveText('Round 2');
    await expect(currentRow(dm)).toHaveText(label.tamsin);

    // The ogre has stayed off the TV; revealed mid-fight it joins the Enemies' members, which the TV never names.
    expect(tvFrames.join('')).not.toContain(ogre.token.id);
    await selectTokenRow(dm, label.ogre);
    await tokenPopover(dm)
      .getByRole('button', { name: `Reveal token ${label.ogre}` })
      .click();
    await initiativeTab(dm).click();
    await dm.locator('.eg-initiative__round').click();
    await dm.keyboard.press('Enter');
    await expect(currentRow(dm)).toHaveText('Enemies');
    await expect(dm.locator('.eg-initiative__members')).toContainText(label.goblin);
    await expect(dm.locator('.eg-initiative__members')).toContainText(label.ogre);

    // Wren revealed: offered for the order, added at the end, and on the TV.
    await selectTokenRow(dm, label.wren);
    await tokenPopover(dm)
      .getByRole('button', { name: `Reveal token ${label.wren}` })
      .click();
    await initiativeTab(dm).click();
    await expect(dm.getByText(`Add ${label.wren} to initiative?`)).toBeVisible();
    await dm.locator('.eg-initiative__offer').getByRole('button', { name: 'Add', exact: true }).click();
    await expect(rows(dm)).toHaveText(['Enemies', label.tamsin, label.wren]);
    await expect(cards(tv)).toHaveText(['Enemies', label.tamsin, label.wren]);

    // The TV reloads: the strip comes back from its snapshot, in the same order and turn.
    await tv.reload();
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    await expect(cards(tv)).toHaveText(['Enemies', label.tamsin, label.wren]);
    await expect(stripTurn(tv)).toHaveText('Enemies');

    // Every enemy dies; when the Enemies' turn comes again, the DM is asked, and ends combat.
    for (const enemy of [label.goblin, label.ogre]) {
      await selectTokenRow(dm, enemy);
      await tokenPopover(dm).getByRole('button', { name: 'Dead', exact: true }).click();
      await expect(tokenPopover(dm).getByRole('button', { name: 'Dead', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    }
    await initiativeTab(dm).click();
    await dm.locator('.eg-initiative__round').click();
    await dm.keyboard.press('Enter');
    await dm.keyboard.press('Enter');
    await dm.keyboard.press('Enter');
    await expect(currentRow(dm)).toHaveText('Enemies');
    const prompt = dm.locator('.eg-initiative__prompt');
    await expect(prompt).toHaveText(/No enemies left\. End combat\?/);
    await prompt.getByRole('button', { name: 'End combat' }).click();
    await expect(dm.getByRole('button', { name: 'Start combat' })).toBeVisible();
    await expect(strip(tv)).toHaveCount(0);

    // Nothing the TV received named an enemy's initiative or carried a number of the order.
    const received = tvFrames.join('');
    expect(received).not.toContain('"initiative"');
    expect(received).not.toContain('enemies_seen');
  } finally {
    await liveBar(dm)
      .getByRole('button', { name: 'Go idle' })
      .click()
      .catch(() => undefined);
    const summary = await dm.request.get(`/api/campaigns/${campaignId}/deletion`);
    if (summary.ok()) {
      await dm.request.delete(`/api/campaigns/${campaignId}`, { data: { confirm: (await summary.json()) as object } });
    }
    for (const id of assets) await dm.request.delete(`/api/assets/${id}`);
    await dmContext.close();
    await playerContext.close();
  }
});
