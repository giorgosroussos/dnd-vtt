import { expect, test, type Locator, type Page } from '@playwright/test';
import { openLibrary, selectScene, viewport } from './canvas-view.js';
import { openWorkspace, seedCampaign } from './dm.js';
import { solidPng } from './png.js';
import { squareCentre, tokensOf } from './prep.js';

// UXR-03 (specs/05-assets-and-images.md §5, specs/08-ux-journeys.md §14, Q-124): a library asset dragged
// onto the map is placed where it is dropped, snapped to the square under the pointer, on a prepared
// scene over REST and on the live scene through token.add, which the TV draws.

const SQUARE = 30;
const tvTokens = async (page: Page): Promise<{ label: string }[]> =>
  JSON.parse((await page.locator('.eg-canvas--player').getAttribute('data-tokens')) ?? '[]') as { label: string }[];

async function dropOn(page: Page, item: Locator, gx: number, gy: number) {
  const [x, y] = await squareCentre(page, SQUARE, gx, gy);
  const box = (await viewport(page).boundingBox())!;
  await item.dragTo(viewport(page), { targetPosition: { x: x - box.x, y: y - box.y } });
}

test('a library asset dragged onto the map is placed on the square it is dropped on, prepared and live', async ({
  browser,
}) => {
  const dmContext = await browser.newContext();
  const tvContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const tv = await tvContext.newPage();
  try {
    await openWorkspace(dm);
    const stamp = Date.now();
    const names = { campaign: `Drag UXR-03 ${stamp}`, session: 'Night', scene: 'Crossroads' };
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
    const map = await upload(600, 390, [40, 60, 40]);
    const scene = (await (
      await dm.request.post(`/api/sessions/${session!.id}/scenes`, {
        data: { name: names.scene, map_image_id: map.id },
      })
    ).json()) as { id: string };
    await dm.request.patch(`/api/scenes/${scene.id}`, {
      data: { grid: { size: SQUARE, offset_x: 0, offset_y: 0, columns: 20, rows: 13 } },
    });
    // A player character: shown to players when placed (specs/05-assets-and-images.md §4).
    const name = `Ranger ${stamp}`;
    await dm.request.post('/api/assets', {
      data: { name, image_id: (await upload(64, 64, [150, 150, 150])).id, category: 'pc', size: 'medium' },
    });

    await dm.reload();
    await selectScene(dm, names);
    await openLibrary(dm);
    const library = dm.getByRole('tabpanel', { name: 'Library' });
    await library.getByLabel('Search names and tags').fill(name);
    const item = library.locator('.eg-library__item', { hasText: name });
    await expect(item).toHaveCount(1);

    // A prepared scene: the token lands on the square under the pointer, selected with its popover.
    await dropOn(dm, item, 4, 3);
    await expect.poll(async () => (await tokensOf(dm, scene.id)).map((token) => [token.x, token.y])).toEqual([[4, 3]]);
    await expect(dm.locator('.eg-popover')).toBeVisible();

    // The live scene: the TV draws the dropped token.
    await tv.goto('/');
    await dm
      .getByRole('region', { name: 'Live scene' })
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await expect(tv.locator('main[data-view="player"]')).toHaveAttribute('data-scene', 'live');
    await expect.poll(async () => (await tvTokens(tv)).length).toBe(1);
    // The first token's popover lets go of the map before the next drop.
    await viewport(dm).press('Escape');
    await expect(dm.locator('.eg-popover')).toHaveCount(0);
    await dropOn(dm, item, 10, 6);
    await expect.poll(async () => (await tvTokens(tv)).length).toBe(2);
    expect((await tokensOf(dm, scene.id)).map((token) => [token.x, token.y])).toContainEqual([10, 6]);
    await dm.getByRole('region', { name: 'Live scene' }).getByRole('button', { name: 'Go idle' }).click();
    await expect(tv.locator('main[data-view="player"]')).toHaveAttribute('data-scene', 'idle');
  } finally {
    await dmContext.close();
    await tvContext.close();
  }
});
