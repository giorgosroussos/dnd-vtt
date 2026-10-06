import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openTree, selectScene, selectTokenRow, tokenPopover, tree } from './canvas-view.js';
import { openWorkspace, seedCampaign, signIn } from './dm.js';
import { solidPng } from './png.js';
import { framesOf, startOwnServer } from './journeys/support.js';
import { seedLargeScene } from '../fixtures/large-scene.js';

// DMT-05 and Phase 7's exit (specs/13-implementation-plan.md §12, specs/09-operations.md §9, specs/08-ux-journeys.md
// §13, Q-115): a campaign prepared and played on this server, with a running encounter, fog, hit points and notes, is
// exported from the DM view, imported from the DM view of a second server on its own data directory, and runs there:
// the scene goes live on that server's TV and a round of combat passes. And the large-scene fixture makes the same
// trip and reads back unchanged.

const player = (page: Page) => page.locator('main[data-view="player"]');
const panel = (page: Page) => page.locator('main.eg-scene');
const liveBar = (page: Page) => page.getByRole('region', { name: 'Live scene' });
const initiativeTab = (page: Page) => page.getByRole('tab', { name: /^Initiative/ });
const rows = (page: Page) => page.locator('.eg-initiative__row .eg-initiative__line .eg-initiative__name');
const currentRow = (page: Page) =>
  page.locator('.eg-initiative__row--current .eg-initiative__line .eg-initiative__name');
const cards = (page: Page) => page.locator('.eg-player__initiative-card .eg-player__initiative-name');
const stripTurn = (page: Page) => page.locator('.eg-player__initiative-card--current .eg-player__initiative-name');
const field = (page: Page, name: string) =>
  page.locator('.eg-initiative__list').getByRole('textbox', { name: `Initiative of ${name}`, exact: true });
const next = async (page: Page) => {
  await page.locator('.eg-initiative__round').click();
  await page.keyboard.press('Enter');
};

interface TokenRead {
  label: string;
  x: number;
  y: number;
  hidden: boolean;
  markers: unknown[];
  hp_current: number | null;
  hp_max: number | null;
  hp_temp: number | null;
  ac: number | null;
  notes: string;
  asset_id: string;
}
/** A scene's tokens as the DM reads them, without the identifiers an import renews. */
const tokensOf = async (page: Page, sceneId: string) =>
  ((await (await page.request.get(`/api/scenes/${sceneId}/tokens`)).json()) as TokenRead[])
    .map(({ label, x, y, hidden, markers, hp_current, hp_max, hp_temp, ac, notes, asset_id }) => ({
      label,
      x,
      y,
      hidden,
      markers,
      hp_current,
      hp_max,
      hp_temp,
      ac,
      notes,
      asset_id,
    }))
    .sort((a, b) => `${a.label} ${a.x} ${a.y}`.localeCompare(`${b.label} ${b.x} ${b.y}`));

test('a campaign with a running combat, fog, hit points and notes, exported here, imported on another data directory and played there', async ({
  browser,
}, info) => {
  test.setTimeout(180_000);
  const dmContext = await browser.newContext({ acceptDownloads: true });
  const dm = await dmContext.newPage();
  await openWorkspace(dm);
  const stamp = Date.now();
  const names = { campaign: `Export DMT-05 ${stamp}`, session: 'Night at the ford', scene: 'The ford' };
  const campaignId = await seedCampaign(dm, names.campaign, [names.session]);
  const [session] = (await (await dm.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as { id: string }[];
  const post = async <T>(url: string, data: unknown, binary = false): Promise<T> => {
    const response = await dm.request.post(
      url,
      binary ? { data, headers: { 'content-type': 'application/octet-stream' } } : { data },
    );
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()) as T;
  };
  const map = await post<{ id: string }>('/api/images', solidPng(600, 400, [70, 60, 50]), true);
  const scene = await post<{ id: string }>(`/api/sessions/${session!.id}/scenes`, {
    name: names.scene,
    map_image_id: map.id,
  });
  const assets: string[] = [];
  const asset = async (name: string, category: 'pc' | 'monster', colour: [number, number, number], fields = {}) => {
    const image = await post<{ id: string }>('/api/images', solidPng(64, 64, colour), true);
    const made = await post<{ id: string }>('/api/assets', {
      name,
      category,
      image_id: image.id,
      size: 'medium',
      default_hidden: false,
      ...fields,
    });
    assets.push(made.id);
    return made;
  };
  const place = async (assetId: string, x: number, y: number) =>
    (await post<{ token: { id: string } }>(`/api/scenes/${scene.id}/tokens`, { asset_id: assetId, x, y })).token.id;
  const hero = `Hero ${stamp}`;
  const mage = `Mage ${stamp}`;
  await place((await asset(hero, 'pc', [40, 90, 160])).id, 1, 1);
  await place((await asset(mage, 'pc', [90, 40, 160])).id, 2, 1);
  const bandit = await asset(`Bandit ${stamp}`, 'monster', [160, 60, 40], { hp_max: 11, ac: 12 });
  const bandits = [await place(bandit.id, 6, 4), await place(bandit.id, 8, 4)];
  // Hit points, notes and fog, all of the scene's state an export must carry.
  await dm.request.patch(`/api/tokens/${bandits[0]}`, { data: { hp_current: 4 } });
  await dm.request.put(`/api/tokens/${bandits[0]}/notes`, { data: { notes: 'Wounded; flees at 2.' } });
  await dm.request.put(`/api/scenes/${scene.id}/notes`, { data: { notes: 'The ford floods at dusk.' } });
  const fog = await dm.request.post(`/api/scenes/${scene.id}/fog`, {
    data: { stroke: { mode: 'paint', radius: 1.5, points: [{ x: 12, y: 8 }] } },
  });
  expect(fog.ok(), await fog.text()).toBe(true);
  const tokens = (await (await dm.request.get(`/api/scenes/${scene.id}/tokens`)).json()) as {
    id: string;
    label: string;
  }[];
  const labelOf = (id: string): string => tokens.find((token) => token.id === id)!.label;
  const b1 = labelOf(bandits[0]!);
  const b2 = labelOf(bandits[1]!);
  await dm.reload();

  const own = await startOwnServer();
  const base = `http://127.0.0.1:${own.port}`;
  const otherDmContext = await browser.newContext({ baseURL: base });
  const otherTvContext = await browser.newContext({ baseURL: base });
  try {
    // Combat runs here, numbers typed and a turn passed, and the scene goes idle with the encounter still on.
    await selectScene(dm, names);
    await liveBar(dm)
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await expect(panel(dm)).toHaveAttribute('data-mode', 'live');
    await initiativeTab(dm).click();
    await dm.getByRole('button', { name: 'Start combat' }).click();
    for (const [name, value] of [
      [hero, '17'],
      [mage, '9'],
      [b1, '14'],
      [b2, '3'],
    ] as const) {
      await field(dm, name).fill(value);
      await field(dm, name).press('Enter');
    }
    const order = [hero, b1, mage, b2];
    await expect(rows(dm)).toHaveText(order);
    await next(dm);
    await expect(currentRow(dm)).toHaveText(b1);
    await liveBar(dm).getByRole('button', { name: 'Go idle' }).click();
    await expect(panel(dm)).toHaveAttribute('data-mode', 'prep');

    // Export from the campaign's row of the tree: a download named by the campaign and the date.
    await openTree(dm);
    const downloading = dm.waitForEvent('download');
    await tree(dm)
      .getByRole('link', { name: `Export ${names.campaign}` })
      .click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(new RegExp(`^Export DMT-05 ${stamp}-\\d{4}-\\d{2}-\\d{2}\\.zip$`));
    const file = info.outputPath('campaign.zip');
    await download.saveAs(file);
    expect(readFileSync(file).subarray(0, 2).toString()).toBe('PK');

    // The other server: a first run on an empty data directory, then Import from its DM view.
    const other = await otherDmContext.newPage();
    const tv = await otherTvContext.newPage();
    const tvFrames = framesOf(tv);
    await signIn(other);
    await openWorkspace(other);
    await openTree(other);
    await tree(other).getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = other.getByRole('dialog', { name: 'Import' });
    await dialog.locator('input[type="file"]').setInputFiles(file);
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText(
      `Imported ${names.campaign}: 1 session, 1 scene, 4 tokens · 3 new assets, 0 reused · 0 images reused, 4 new`,
    );
    await dialog.getByRole('button', { name: 'Close' }).click();

    // Everything came: the tokens with their hit points and notes, the scene's notes, the fog.
    const copy = (await (await other.request.get('/api/campaigns')).json()) as { id: string; name: string }[];
    const copied = copy.find((campaign) => campaign.name === names.campaign)!;
    const [copiedSession] = (await (await other.request.get(`/api/campaigns/${copied.id}/sessions`)).json()) as {
      id: string;
    }[];
    const [copiedScene] = (await (await other.request.get(`/api/sessions/${copiedSession!.id}/scenes`)).json()) as {
      id: string;
      notes: string;
    }[];
    expect(copiedScene!.id).not.toBe(scene.id);
    expect(copiedScene!.notes).toBe('The ford floods at dusk.');
    expect(await tokensOf(other, copiedScene!.id)).toEqual(await tokensOf(dm, scene.id));
    expect(await (await other.request.get(`/api/scenes/${copiedScene!.id}/fog`)).json()).toEqual(
      await (await dm.request.get(`/api/scenes/${scene.id}/fog`)).json(),
    );

    // It runs there: live on that server's TV, the combat where it was left, and a whole round passed.
    await tv.goto('/');
    await other.reload();
    await selectScene(other, names);
    await selectTokenRow(other, b1);
    await expect(tokenPopover(other).locator('[data-hp]')).toHaveText('4 / 11');
    await liveBar(other)
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await expect(panel(other)).toHaveAttribute('data-mode', 'live');
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    await initiativeTab(other).click();
    await expect(rows(other)).toHaveText(order);
    await expect(currentRow(other)).toHaveText(b1);
    await expect(cards(tv)).toHaveText(order);
    await expect(stripTurn(tv)).toHaveText(b1);
    await expect(initiativeTab(other)).toHaveText('Initiative · R1');
    for (const expected of [mage, b2, hero, b1]) {
      await next(other);
      await expect(currentRow(other)).toHaveText(expected);
      await expect(stripTurn(tv)).toHaveText(expected);
    }
    await expect(initiativeTab(other)).toHaveText('Initiative · R2');
    // The other TV, too, received no hit point, note or initiative number.
    const received = tvFrames.join('');
    for (const word of ['"hp_', '"notes"', '"initiative"', 'Wounded', 'floods']) expect(received).not.toContain(word);
  } finally {
    // Already idle unless a step failed while the scene was live.
    await liveBar(dm)
      .getByRole('button', { name: 'Go idle' })
      .click({ timeout: 2_000 })
      .catch(() => undefined);
    const summary = await dm.request.get(`/api/campaigns/${campaignId}/deletion`);
    if (summary.ok()) {
      await dm.request.delete(`/api/campaigns/${campaignId}`, { data: { confirm: (await summary.json()) as object } });
    }
    for (const id of assets) await dm.request.delete(`/api/assets/${id}`);
    await otherDmContext.close();
    await otherTvContext.close();
    await dmContext.close();
    await own.stop();
  }
});

test('the large-scene fixture makes the trip to another data directory and reads back unchanged', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const dmContext = await browser.newContext();
  const dm = await dmContext.newPage();
  await signIn(dm);
  const stamp = Date.now();
  const campaignId = await seedCampaign(dm, `Large trip ${stamp}`, ['Session']);
  const [session] = (await (await dm.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as { id: string }[];
  const fixture = await seedLargeScene(dm.request, session!.id, String(stamp));
  const own = await startOwnServer();
  const otherContext = await browser.newContext({ baseURL: `http://127.0.0.1:${own.port}` });
  try {
    const exported = await dm.request.get(`/api/export/campaigns/${campaignId}`, { timeout: 120_000 });
    expect(exported.status()).toBe(200);
    const archive = await exported.body();
    const other = await otherContext.newPage();
    await signIn(other);
    const imported = await other.request.post('/api/import', {
      data: archive,
      headers: { 'content-type': 'application/zip' },
      timeout: 180_000,
    });
    expect(imported.status(), await imported.text()).toBe(200);
    const summary = (await imported.json()) as { campaign: { id: string } };
    expect(summary).toMatchObject({ scenes: 2, tokens: 50, assets: { added: 5 }, images: { added: 6 } });

    // The same tree, scenes and tokens, read as the DM view reads them; only the identifiers are new.
    const scenesOf = async (page: Page, campaign: string) => {
      const [first] = (await (await page.request.get(`/api/campaigns/${campaign}/sessions`)).json()) as {
        id: string;
      }[];
      return (await (await page.request.get(`/api/sessions/${first!.id}/scenes`)).json()) as {
        id: string;
        name: string;
        map_image_id: string | null;
        grid: unknown;
        notes: string;
      }[];
    };
    const original = await scenesOf(dm, campaignId);
    const copy = await scenesOf(other, summary.campaign.id);
    const shape = (scenes: typeof original) =>
      scenes.map(({ name, map_image_id, grid, notes }) => ({ name, map_image_id, grid, notes }));
    expect(shape(copy)).toEqual(shape(original));
    for (const [index, scene] of original.entries()) {
      expect(await tokensOf(other, copy[index]!.id)).toEqual(await tokensOf(dm, scene.id));
    }
    // The map with its calibration preset, and its display version made again on the other server.
    const image = async (page: Page) =>
      (await (await page.request.get(`/api/images/${fixture.mapImageId}`)).json()) as {
        width: number;
        height: number;
        grid_preset: unknown;
        variants: { display?: { width: number } };
      };
    const there = await image(other);
    const here = await image(dm);
    expect({ ...there, variants: undefined }).toEqual({ ...here, variants: undefined });
    expect(there.variants.display?.width).toBe(here.variants.display?.width);
    const display = await other.request.get(`/images/${fixture.mapImageId}/display`);
    expect(display.status()).toBe(200);
    expect(display.headers()['content-type']).toBe('image/webp');
  } finally {
    const deletion = await dm.request.get(`/api/campaigns/${campaignId}/deletion`);
    if (deletion.ok()) {
      await dm.request.delete(`/api/campaigns/${campaignId}`, { data: { confirm: (await deletion.json()) as object } });
    }
    for (const { id } of fixture.assets) await dm.request.delete(`/api/assets/${id}`);
    await otherContext.close();
    await dmContext.close();
    await own.stop();
  }
});
