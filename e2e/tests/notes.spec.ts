import { expect, test, type Page } from '@playwright/test';
import { sceneRow, selectScene, selectTokenRow, tokenPopover, viewport } from './canvas-view.js';
import { openWorkspace, seedCampaign } from './dm.js';
import { solidPng } from './png.js';
import { framesOf, liveBar, panel, player, tvCanvas } from './journeys/support.js';

// DMT-04: DM notes against the production server (specs/03-domain-model.md §10, specs/04-live-sync.md §4, §16,
// specs/08-ux-journeys.md §13, Q-114). A DM context and a player context at once, the scene live: the scene's notes
// written in the Notes tab reached with N, a token's in its popover beside its asset's, the badge on the map and the
// mark on its row, the notes opened again from the initiative order on the token's turn, everything still there
// after a reload; and the TV, which receives none of it.

type Drawn = { label: string; note?: boolean }[];
const drawn = async (page: Page) => JSON.parse((await viewport(page).getAttribute('data-tokens')) ?? '[]') as Drawn;
const saved = (page: Page, field: ReturnType<Page['locator']>) =>
  expect(field.locator('xpath=..').locator('.eg-notes__status')).toHaveText('Saved');

test('scene and token notes written while live, seen on the map and reopened on the token’s turn, never on the TV', async ({
  browser,
}) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const tv = await playerContext.newPage();
  const tvFrames = framesOf(tv);
  await openWorkspace(dm);

  const stamp = Date.now();
  const names = { campaign: `Notes DMT-04 ${stamp}`, session: 'Night of notes', scene: 'Toll bridge' };
  const campaignId = await seedCampaign(dm, names.campaign, [names.session]);
  const [session] = (await (await dm.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as { id: string }[];
  const post = async <T>(url: string, data: unknown, binary = false): Promise<T> =>
    (await (
      await dm.request.post(url, binary ? { data, headers: { 'content-type': 'application/octet-stream' } } : { data })
    ).json()) as T;
  const map = await post<{ id: string }>('/api/images', solidPng(600, 400, [40, 50, 60]), true);
  const scene = await post<{ id: string }>(`/api/sessions/${session!.id}/scenes`, {
    name: names.scene,
    map_image_id: map.id,
  });
  const image = await post<{ id: string }>('/api/images', solidPng(64, 64, [120, 40, 30]), true);
  const bandit = `Bandit ${stamp}`;
  const hero = `Wren ${stamp}`;
  const banditAsset = await post<{ id: string }>('/api/assets', {
    name: bandit,
    category: 'monster',
    image_id: image.id,
    size: 'medium',
    default_hidden: false,
    notes: 'Bandits: surrender when outnumbered.',
  });
  const heroAsset = await post<{ id: string }>('/api/assets', {
    name: hero,
    category: 'pc',
    image_id: image.id,
    size: 'medium',
    default_hidden: false,
  });
  await dm.request.post(`/api/scenes/${scene.id}/tokens`, { data: { asset_id: banditAsset.id, x: 4, y: 3 } });
  await dm.request.post(`/api/scenes/${scene.id}/tokens`, { data: { asset_id: heroAsset.id, x: 1, y: 1 } });
  await dm.reload();

  const sceneNote = `The bridge gives way on round 3 ${stamp}`;
  const tokenNote = `Leader: flees at half HP ${stamp}`;
  try {
    await tv.goto('/');
    await selectScene(dm, names);
    await liveBar(dm)
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await expect(panel(dm)).toHaveAttribute('data-mode', 'live');
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');

    // The scene's notes: N from the map opens the Notes tab with the cursor in them; saved as typed.
    await viewport(dm).focus();
    await dm.keyboard.press('n');
    const sceneField = dm.getByRole('textbox', { name: `Notes for ${names.scene}` });
    await expect(sceneField).toBeFocused();
    await dm.keyboard.type(`${sceneNote}\nThe troll takes gold.`);
    await saved(dm, sceneField);
    await expect(sceneRow(dm, names.scene).locator('[data-note-mark]')).toHaveCount(1);

    // A token's notes in its popover, its asset's under them, read-only.
    await dm.getByRole('tab', { name: 'In this scene' }).click();
    await selectTokenRow(dm, bandit);
    await expect(tokenPopover(dm)).toContainText(`From ${bandit} (library)`);
    await expect(tokenPopover(dm)).toContainText('Bandits: surrender when outnumbered.');
    const tokenField = tokenPopover(dm).getByRole('textbox', { name: `Notes for ${bandit}` });
    await tokenField.fill(tokenNote);
    await saved(dm, tokenField);

    // The badge on the map and the mark on the row; the hero, without notes, has neither.
    await expect.poll(async () => (await drawn(dm)).find((token) => token.label === bandit)?.note).toBe(true);
    await expect.poll(async () => (await drawn(dm)).find((token) => token.label === hero)?.note).toBe(false);
    await expect(dm.locator('.eg-token-row', { hasText: bandit }).locator('[data-note-mark]')).toHaveAttribute(
      'title',
      new RegExp(`^${tokenNote}`),
    );
    await expect(dm.locator('.eg-token-row', { hasText: hero }).locator('[data-note-mark]')).toHaveCount(0);

    // Combat, the bandit first: its turn's row opens its notes, the cursor in them.
    await dm.getByRole('tab', { name: /^Initiative/ }).click();
    await dm.getByRole('button', { name: 'Start combat' }).click();
    const number = (name: string) =>
      dm.locator('.eg-initiative__list').getByRole('textbox', { name: `Initiative of ${name}`, exact: true });
    await number(bandit).fill('18');
    await number(bandit).press('Enter');
    await number(hero).fill('7');
    await number(hero).press('Enter');
    // The turn passes to the bandit's row, whichever had it when the numbers sorted the order.
    const current = dm.locator('.eg-initiative__row--current .eg-initiative__line .eg-initiative__name');
    for (let turn = 0; turn < 2 && (await current.textContent()) !== bandit; turn++) {
      const was = (await current.textContent()) ?? '';
      await dm.getByRole('button', { name: 'Next turn' }).click();
      await expect(current).not.toHaveText(was);
    }
    await expect(current).toHaveText(bandit);
    await dm.getByRole('button', { name: `Open the notes of ${bandit}` }).click();
    await expect(tokenPopover(dm).getByRole('textbox', { name: `Notes for ${bandit}` })).toBeFocused();
    await expect(tokenPopover(dm).getByRole('textbox', { name: `Notes for ${bandit}` })).toHaveValue(tokenNote);
    await dm.getByRole('button', { name: 'Next turn' }).click();
    await expect(current).toHaveText(hero);
    await expect(dm.getByRole('button', { name: /^Open the notes of/ })).toHaveCount(0);

    // A reload keeps both: notes are stored, not held by the page.
    await dm.reload();
    await expect(panel(dm)).toHaveAttribute('data-mode', 'live');
    await dm.getByRole('tab', { name: 'Notes' }).click();
    await expect(dm.getByRole('textbox', { name: `Notes for ${names.scene}` })).toHaveValue(
      `${sceneNote}\nThe troll takes gold.`,
    );

    // The TV shows nothing of them, now or after a reload, and received none of them.
    await tv.reload();
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    await expect(tvCanvas(tv)).toBeVisible();
    for (const shown of ['round 3', 'flees at half HP', 'troll', 'surrender']) {
      await expect(tv.locator('body')).not.toContainText(shown);
    }
    const received = tvFrames.join('');
    for (const secret of [sceneNote, tokenNote, 'troll takes gold', 'surrender when outnumbered', '"notes"']) {
      expect(received, secret).not.toContain(secret);
    }
  } finally {
    await liveBar(dm)
      .getByRole('button', { name: 'Go idle' })
      .click()
      .catch(() => undefined);
    const summary = await dm.request.get(`/api/campaigns/${campaignId}/deletion`);
    if (summary.ok()) {
      await dm.request.delete(`/api/campaigns/${campaignId}`, { data: { confirm: (await summary.json()) as object } });
    }
    await dm.request.delete(`/api/assets/${banditAsset.id}`);
    await dm.request.delete(`/api/assets/${heroAsset.id}`);
    await dmContext.close();
    await playerContext.close();
  }
});
