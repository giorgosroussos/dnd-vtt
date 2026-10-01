import { expect, test, type Page } from '@playwright/test';
import { selectScene, viewport } from './canvas-view.js';
import { openWorkspace, seedCampaign } from './dm.js';
import { solidPng } from './png.js';
import { framesOf } from './journeys/support.js';

// TBL-04: painted fog against the production server (specs/04-live-sync.md §2, §4, §13, specs/07-security-
// and-access.md §5, specs/08-ux-journeys.md §11, Q-101). A DM context and a player context at once: fog
// painted with the brush over a visible token covers that part of the TV's map in black and takes the token
// off it, its image refused to the TV; the fog survives the TV reconnecting; erasing it brings the token
// back, and undo fogs it again.

const player = (page: Page) => page.locator('main[data-view="player"]');
const tvCanvas = (page: Page) => page.locator('main[data-view="player"] .eg-canvas--player');
const panel = (page: Page) => page.locator('main.eg-scene');
const liveBar = (page: Page) => page.getByRole('region', { name: 'Live scene' });

type Drawn = { id: string; label: string; left: number; top: number; side: number }[];
const tokensOn = async (page: Page): Promise<Drawn> =>
  JSON.parse((await tvCanvas(page).getAttribute('data-tokens')) ?? '[]') as Drawn;
const fogOn = async (page: Page): Promise<unknown[]> =>
  JSON.parse((await tvCanvas(page).getAttribute('data-fog')) ?? '[]') as unknown[];
const dmFog = async (page: Page): Promise<unknown[]> =>
  JSON.parse((await viewport(page).getAttribute('data-fog')) ?? '[]') as unknown[];

/** The colour the TV's fog layer drew at screen point (x, y). */
async function fogPixel(page: Page, x: number, y: number): Promise<number[]> {
  return tvCanvas(page).evaluate(
    (element, { x, y }) => {
      const canvases = [...element.querySelectorAll('canvas')];
      const ratio = window.devicePixelRatio;
      // The layers in order: map, grid, fog, tokens; the fog's is the one with pixels here.
      const fog = canvases[2]!;
      return [...fog.getContext('2d')!.getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data];
    },
    { x, y },
  );
}

test('fog painted on the live scene blacks out that part of the TV and the token under it, until erased', async ({
  browser,
}) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const tv = await playerContext.newPage();
  const tvFrames = framesOf(tv);
  await openWorkspace(dm);

  const stamp = Date.now();
  const names = { campaign: `Fog TBL-04 ${stamp}`, session: 'Dark night', scene: 'Old manor' };
  const campaignId = await seedCampaign(dm, names.campaign, [names.session]);
  const [session] = (await (await dm.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as { id: string }[];
  const post = async <T>(url: string, data: unknown, binary = false): Promise<T> =>
    (await (
      await dm.request.post(url, binary ? { data, headers: { 'content-type': 'application/octet-stream' } } : { data })
    ).json()) as T;
  const map = await post<{ id: string }>('/api/images', solidPng(600, 400, [200, 180, 150]), true);
  const scene = await post<{ id: string }>(`/api/sessions/${session!.id}/scenes`, {
    name: names.scene,
    map_image_id: map.id,
  });
  const image = await post<{ id: string }>('/api/images', solidPng(64, 64, [30, 140, 60]), true);
  const ghoul = await post<{ id: string }>('/api/assets', {
    name: `Ghoul ${stamp}`,
    category: 'monster',
    image_id: image.id,
    size: 'medium',
    default_hidden: false,
  });
  await dm.request.post(`/api/scenes/${scene.id}/tokens`, { data: { asset_id: ghoul.id, x: 3, y: 3 } });
  await dm.reload();

  try {
    await tv.goto('/');
    await selectScene(dm, names);
    await liveBar(dm)
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await expect(panel(dm)).toHaveAttribute('data-mode', 'live');
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    await expect.poll(async () => (await tokensOn(tv)).length).toBe(1);
    const [ghoulOnTv] = await tokensOn(tv);
    expect((await tv.request.get(`/images/${image.id}/display`)).status()).toBe(200);

    // The fog brush: a drag across the ghoul's square, from square (2, 2) to square (5, 5).
    await dm.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Fog brush, F' }).click();
    await expect(viewport(dm)).toHaveAttribute('data-fog-tool', 'on');
    await expect(viewport(dm)).toHaveAttribute('data-fog-brush', 'paint 1');
    const dmTokens = JSON.parse((await viewport(dm).getAttribute('data-tokens'))!) as Drawn;
    const box = (await viewport(dm).boundingBox())!;
    const square = dmTokens[0]!.side;
    const origin = { x: box.x + dmTokens[0]!.left - square / 2, y: box.y + dmTokens[0]!.top - square / 2 };
    const stroke = async () => {
      await dm.mouse.move(origin.x, origin.y);
      await dm.mouse.down();
      await dm.mouse.move(origin.x + 1.5 * square, origin.y + 1.5 * square, { steps: 6 });
      await dm.mouse.move(origin.x + 3 * square, origin.y + 3 * square, { steps: 6 });
      await dm.mouse.up();
    };
    await stroke();

    // The TV: the fog, black where the ghoul stood, and the ghoul gone with its image.
    await expect.poll(async () => (await fogOn(tv)).length).toBeGreaterThan(0);
    await expect.poll(() => dmFog(dm)).toEqual(await fogOn(tv));
    await expect.poll(async () => (await tokensOn(tv)).length).toBe(0);
    const middle = { x: ghoulOnTv!.left + ghoulOnTv!.side / 2, y: ghoulOnTv!.top + ghoulOnTv!.side / 2 };
    await expect.poll(async () => (await fogPixel(tv, middle.x, middle.y)).slice(0, 3)).toEqual([10, 8, 6]);
    expect((await tv.request.get(`/images/${image.id}/display`)).status()).toBe(404);
    await expect(dm.locator('.eg-fog-row')).toContainText('Fog painted · 1 token under it players cannot see');
    const painted = await fogOn(tv);
    // For comparison with the design: the DM's hatch, the TV's mask.
    for (const [page, name] of [
      [dm, 'dm-fogged'],
      [tv, 'tv-fogged'],
    ] as const) {
      const path = test.info().outputPath(`${name}.png`);
      await page.screenshot({ path });
      await test.info().attach(name, { path, contentType: 'image/png' });
    }

    // The TV reconnects: the fog comes back with its snapshot.
    await tv.reload();
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    await expect.poll(() => fogOn(tv)).toEqual(painted);
    expect(await tokensOn(tv)).toEqual([]);

    // Erased along the same line with a brush twice as wide, ] four times: the fog lifts and the ghoul is
    // back. (The same width would leave slivers where the two strokes' points differ.)
    await dm.getByRole('group', { name: 'Fog brush' }).getByRole('button', { name: 'Erase' }).click();
    for (let i = 0; i < 4; i++) await dm.keyboard.press(']');
    await expect(viewport(dm)).toHaveAttribute('data-fog-brush', 'erase 2');
    await stroke();
    await expect.poll(() => fogOn(tv)).toEqual([]);
    await expect.poll(async () => (await tokensOn(tv)).length).toBe(1);
    expect((await tv.request.get(`/images/${image.id}/display`)).status()).toBe(200);
    // And undone: fogged again, as it was.
    await dm.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => fogOn(tv)).toEqual(painted);
    await expect.poll(async () => (await tokensOn(tv)).length).toBe(0);

    // The fog reached the TV, and nothing in what it received names a scene or says what is hidden.
    expect(tvFrames.join('')).toContain('fog.updated');
    for (const secret of ['"scene_id"', '"hidden"']) expect(tvFrames.join('')).not.toContain(secret);
  } finally {
    await liveBar(dm)
      .getByRole('button', { name: 'Go idle' })
      .click()
      .catch(() => undefined);
    const summary = await dm.request.get(`/api/campaigns/${campaignId}/deletion`);
    if (summary.ok()) {
      await dm.request.delete(`/api/campaigns/${campaignId}`, { data: { confirm: (await summary.json()) as object } });
    }
    await dm.request.delete(`/api/assets/${ghoul.id}`);
    await dmContext.close();
    await playerContext.close();
  }
});
