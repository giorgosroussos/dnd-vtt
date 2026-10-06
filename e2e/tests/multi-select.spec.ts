import { expect, test, type Page } from '@playwright/test';
import { selectScene, viewport } from './canvas-view.js';
import { openWorkspace, seedCampaign } from './dm.js';
import { solidPng } from './png.js';
import { dragBy, drawn } from './prep.js';

// UXR-02 (specs/08-ux-journeys.md §14, specs/04-live-sync.md §2, §8, Q-122, Q-123): Ctrl and a click build a
// selection on the live scene's map; dragging one of it moves the group, which the TV draws; one Ctrl+Z takes the
// whole move back; the group bar hides them all in one step, undone in one step too.

interface TvToken {
  id: string;
  label: string;
  x: number;
  y: number;
}
const tvTokens = async (page: Page): Promise<TvToken[]> =>
  JSON.parse((await page.locator('.eg-canvas--player').getAttribute('data-tokens')) ?? '[]') as TvToken[];
const at = async (page: Page, label: string) => {
  const token = (await drawn(page)).find((each) => each.label === label)!;
  const box = (await viewport(page).boundingBox())!;
  return [box.x + 1 + token.left + token.side / 2, box.y + 1 + token.top + token.side / 2] as const;
};
const positions = async (page: Page, labels: string[]) =>
  (await tvTokens(page))
    .filter((token) => labels.includes(token.label))
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((token) => [token.label, token.x, token.y]);

test('Ctrl and a click select several tokens, a drag moves them together on the TV, and one undo takes it back', async ({
  browser,
}) => {
  const dmContext = await browser.newContext();
  const tvContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const tv = await tvContext.newPage();
  try {
    await openWorkspace(dm);
    const stamp = Date.now();
    const names = { campaign: `Group UXR-02 ${stamp}`, session: 'Night', scene: 'Ambush' };
    const campaignId = await seedCampaign(dm, names.campaign, [names.session]);
    const [session] = (await (await dm.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as {
      id: string;
    }[];
    const upload = async (width: number, height: number, colour: [number, number, number]) =>
      (await (
        await dm.request.post('/api/images', {
          data: solidPng(width, height, colour),
          headers: { 'content-type': 'application/octet-stream' },
        })
      ).json()) as { id: string };
    const scene = (await (
      await dm.request.post(`/api/sessions/${session!.id}/scenes`, {
        data: { name: names.scene, map_image_id: (await upload(600, 390, [50, 40, 30])).id },
      })
    ).json()) as { id: string };
    await dm.request.patch(`/api/scenes/${scene.id}`, {
      data: { grid: { size: 30, offset_x: 0, offset_y: 0, columns: 20, rows: 13 } },
    });
    const pc = async (name: string, colour: [number, number, number]) =>
      (await (
        await dm.request.post('/api/assets', {
          data: { name, image_id: (await upload(64, 64, colour)).id, category: 'pc', size: 'medium' },
        })
      ).json()) as { id: string };
    const labels = [`Ash ${stamp}`, `Birch ${stamp}`, `Cedar ${stamp}`];
    for (const [index, name] of labels.entries()) {
      const asset = await pc(name, [60 * (index + 1), 90, 120]);
      await dm.request.post(`/api/scenes/${scene.id}/tokens`, { data: { asset_id: asset.id, x: 2 + 2 * index, y: 2 } });
    }

    await tv.goto('/');
    await dm.reload();
    await selectScene(dm, names);
    await dm
      .getByRole('region', { name: 'Live scene' })
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await expect.poll(async () => (await tvTokens(tv)).length).toBe(3);
    const start = await positions(tv, labels);

    // Ctrl and a click on Ash, then on Birch: two selected, the group bar says so, no popover.
    await dm.keyboard.down('Control');
    await dm.mouse.click(...(await at(dm, labels[0]!)));
    await dm.mouse.click(...(await at(dm, labels[1]!)));
    await dm.keyboard.up('Control');
    const bar = dm.getByRole('group', { name: '2 selected tokens' });
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('2 selected');
    await expect(dm.locator('.eg-popover')).toHaveCount(0);

    // A drag of Birch moves Ash too, three squares down; Cedar stays.
    await dragBy(dm, labels[1]!, 0, 3);
    await expect
      .poll(() => positions(tv, labels))
      .toEqual([
        [labels[0], start[0]![1], (start[0]![2] as number) + 3],
        [labels[1], start[1]![1], (start[1]![2] as number) + 3],
        start[2],
      ]);

    // One Ctrl+Z takes the whole group back.
    await viewport(dm).focus();
    await dm.keyboard.press('Control+z');
    await expect.poll(() => positions(tv, labels)).toEqual(start);

    // Hide all from the bar: both leave the TV in one step, and one undo brings both back.
    await bar.getByRole('button', { name: /Hide all/ }).click();
    await expect.poll(async () => (await tvTokens(tv)).map((token) => token.label)).toEqual([labels[2]]);
    await viewport(dm).focus();
    await dm.keyboard.press('Control+z');
    await expect.poll(async () => (await tvTokens(tv)).length).toBe(3);

    // Escape lets the group go.
    await viewport(dm).press('Escape');
    await expect(bar).toHaveCount(0);
    await dm.getByRole('region', { name: 'Live scene' }).getByRole('button', { name: 'Go idle' }).click();
    await expect(tv.locator('main[data-view="player"]')).toHaveAttribute('data-scene', 'idle');
  } finally {
    await dmContext.close();
    await tvContext.close();
  }
});
