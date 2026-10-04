import { expect, test, type Page } from '@playwright/test';
import { selectScene, selectTokenRow, tokenPopover, viewport } from './canvas-view.js';
import { openWorkspace, seedCampaign } from './dm.js';
import { solidPng } from './png.js';
import { framesOf } from './journeys/support.js';

// DMT-01: hit points and armour class against the production server (specs/03-domain-model.md §9, specs/04-live-sync.md
// §2, §4, §15, specs/08-ux-journeys.md §13, Q-112, Q-116). A DM context and a player context at once: a token placed
// from an asset with defaults starts with them; damage typed in the popover brings it to Bloodied, then 0 and Dead,
// on both views; healing raises its hit points and takes Bloodied off but not Dead; the TV receives the markers and
// never a hit point or an armour class.

const player = (page: Page) => page.locator('main[data-view="player"]');
const tvCanvas = (page: Page) => page.locator('main[data-view="player"] .eg-canvas--player');
const panel = (page: Page) => page.locator('main.eg-scene');
const liveBar = (page: Page) => page.getByRole('region', { name: 'Live scene' });

type Drawn = { label: string; markers: { id: string }[] }[];
const markersOn = async (locator: ReturnType<typeof viewport>, label: string) =>
  (JSON.parse((await locator.getAttribute('data-tokens')) ?? '[]') as Drawn)
    .find((token) => token.label === label)
    ?.markers.map((marker) => marker.id);

test('a token placed from an asset with defaults is damaged to Bloodied and to 0, then healed, the TV seeing only its markers', async ({
  browser,
}) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const tv = await playerContext.newPage();
  const tvFrames = framesOf(tv);
  await openWorkspace(dm);

  const stamp = Date.now();
  const names = { campaign: `Hit points DMT-01 ${stamp}`, session: 'Battle night', scene: 'Ford' };
  const campaignId = await seedCampaign(dm, names.campaign, [names.session]);
  const [session] = (await (await dm.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as { id: string }[];
  const post = async <T>(url: string, data: unknown, binary = false): Promise<T> =>
    (await (
      await dm.request.post(url, binary ? { data, headers: { 'content-type': 'application/octet-stream' } } : { data })
    ).json()) as T;
  const map = await post<{ id: string }>('/api/images', solidPng(600, 400, [50, 60, 40]), true);
  const scene = await post<{ id: string }>(`/api/sessions/${session!.id}/scenes`, {
    name: names.scene,
    map_image_id: map.id,
  });
  const image = await post<{ id: string }>('/api/images', solidPng(64, 64, [100, 70, 30]), true);
  const label = `Ogre ${stamp}`;
  const ogre = await post<{ id: string }>('/api/assets', {
    name: label,
    category: 'monster',
    image_id: image.id,
    size: 'large',
    default_hidden: false,
    hp_max: 27,
    ac: 11,
  });
  await dm.request.post(`/api/scenes/${scene.id}/tokens`, { data: { asset_id: ogre.id, x: 3, y: 3 } });
  await dm.reload();

  try {
    await tv.goto('/');
    await selectScene(dm, names);
    await liveBar(dm)
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await expect(panel(dm)).toHaveAttribute('data-mode', 'live');
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');

    // The asset's defaults, copied to the token at full hit points.
    await selectTokenRow(dm, label);
    const hp = tokenPopover(dm).locator('[data-hp]');
    const field = tokenPopover(dm).getByRole('textbox', { name: `Damage, healing or hit points of ${label}` });
    await expect(hp).toHaveText('27 / 27');
    await expect(tokenPopover(dm).locator('[data-ac]')).toHaveText('11');
    await expect(dm.locator('.eg-token-row', { hasText: label }).locator('.eg-stats')).toContainText('27/27');

    // 14 damage: 13 of 27 is half rounded down, Bloodied on both views.
    await field.fill('-14');
    await field.press('Enter');
    await expect(hp).toHaveText('13 / 27');
    await expect.poll(() => markersOn(tvCanvas(tv), label)).toEqual(['bloodied']);
    await expect.poll(() => markersOn(viewport(dm), label)).toEqual(['bloodied']);

    // D reaches the field from the map; damage past 0 stops there and the monster is Dead.
    await viewport(dm).focus();
    await dm.keyboard.press('d');
    await expect(field).toBeFocused();
    await dm.keyboard.type('-50');
    await dm.keyboard.press('Enter');
    await expect(hp).toHaveText('0 / 27');
    await expect.poll(() => markersOn(tvCanvas(tv), label)).toEqual(['bloodied', 'dead']);

    // Healing above half takes Bloodied off and leaves Dead to the DM (Q-116).
    await field.fill('+20');
    await field.press('Enter');
    await expect(hp).toHaveText('20 / 27');
    await expect.poll(() => markersOn(tvCanvas(tv), label)).toEqual(['dead']);
    await expect.poll(() => markersOn(viewport(dm), label)).toEqual(['dead']);

    // A reloaded TV gets the markers from its snapshot; nothing the TV received names a hit point or an armour class.
    await tv.reload();
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    await expect.poll(() => markersOn(tvCanvas(tv), label)).toEqual(['dead']);
    const received = tvFrames.join('');
    expect(received).not.toContain('"hp_');
    expect(received).not.toContain('"ac"');
  } finally {
    await liveBar(dm)
      .getByRole('button', { name: 'Go idle' })
      .click()
      .catch(() => undefined);
    const summary = await dm.request.get(`/api/campaigns/${campaignId}/deletion`);
    if (summary.ok()) {
      await dm.request.delete(`/api/campaigns/${campaignId}`, { data: { confirm: (await summary.json()) as object } });
    }
    await dm.request.delete(`/api/assets/${ogre.id}`);
    await dmContext.close();
    await playerContext.close();
  }
});
