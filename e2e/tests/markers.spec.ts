import { expect, test, type Page } from '@playwright/test';
import { selectScene, selectTokenRow, tokenPopover, viewport } from './canvas-view.js';
import { openWorkspace, seedCampaign } from './dm.js';
import { solidPng } from './png.js';
import { framesOf } from './journeys/support.js';

// TBL-02 and TBL-05: condition markers against the production server (specs/03-domain-model.md §1, specs/04-live-sync.md
// §2, §4, §8, specs/08-ux-journeys.md §11, Q-099). A DM context and a player context at once: a marker
// toggled in the popover on the live scene shows on the TV, is undone and redone, and survives both views
// reloading; a hidden token's marker reaches the TV not at all, until it is revealed with it.

const player = (page: Page) => page.locator('main[data-view="player"]');
const tvCanvas = (page: Page) => page.locator('main[data-view="player"] .eg-canvas--player');
const panel = (page: Page) => page.locator('main.eg-scene');
const liveBar = (page: Page) => page.getByRole('region', { name: 'Live scene' });
const rail = (page: Page) => page.getByRole('toolbar', { name: 'Tools' });

type Drawn = { id: string; label: string; markers: { id: string; level?: number }[]; hidden?: boolean }[];
const drawn = async (locator: ReturnType<typeof viewport>): Promise<Drawn> =>
  JSON.parse((await locator.getAttribute('data-tokens')) ?? '[]') as Drawn;
// A token's markers by id, Exhaustion with its level ("exhaustion:2"), in the order applied.
const markersOn = async (locator: ReturnType<typeof viewport>, label: string) =>
  (await drawn(locator))
    .find((token) => token.label === label)
    ?.markers.map((marker) => (marker.level === undefined ? marker.id : `${marker.id}:${marker.level}`));
const chip = (page: Page, name: string) => tokenPopover(page).getByRole('button', { name, exact: true });

test('a marker set on the live scene shows on the TV, is undone and redone, survives a reload, and a hidden token’s stays off the TV', async ({
  browser,
}) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const tv = await playerContext.newPage();
  const tvFrames = framesOf(tv);
  await openWorkspace(dm);

  const stamp = Date.now();
  const names = { campaign: `Markers TBL-02 ${stamp}`, session: 'Battle night', scene: 'Bridge fight' };
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
  const asset = async (name: string, hidden: boolean) => {
    const image = await post<{ id: string }>('/api/images', solidPng(64, 64, [90, 40, 30]), true);
    return post<{ id: string }>('/api/assets', {
      name,
      category: 'monster',
      image_id: image.id,
      size: 'medium',
      default_hidden: hidden,
    });
  };
  const ogre = await asset(`Ogre ${stamp}`, false);
  const shade = await asset(`Shade ${stamp}`, true);
  await dm.request.post(`/api/scenes/${scene.id}/tokens`, { data: { asset_id: ogre.id, x: 3, y: 3 } });
  await dm.request.post(`/api/scenes/${scene.id}/tokens`, { data: { asset_id: shade.id, x: 6, y: 3 } });
  const ogreLabel = `Ogre ${stamp}`;
  const shadeLabel = `Shade ${stamp}`;
  await dm.reload();

  try {
    await tv.goto('/');
    await selectScene(dm, names);
    await liveBar(dm)
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await expect(panel(dm)).toHaveAttribute('data-mode', 'live');
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');

    // Bloodied and concentrating on the visible ogre: on the DM's canvas and on the TV.
    await selectTokenRow(dm, ogreLabel);
    await chip(dm, 'Bloodied').click();
    await expect(chip(dm, 'Bloodied')).toHaveAttribute('aria-pressed', 'true');
    await chip(dm, 'Concentrating').click();
    await expect.poll(() => markersOn(tvCanvas(tv), ogreLabel)).toEqual(['bloodied', 'concentrating']);
    await expect.poll(() => markersOn(viewport(dm), ogreLabel)).toEqual(['bloodied', 'concentrating']);
    await expect(dm.locator('.eg-token-row', { hasText: ogreLabel }).locator('.eg-token-row__status')).toHaveText(
      'Monster · Bloodied, Concentrating',
    );

    // Undo takes the last off, redo puts it back.
    await rail(dm).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => markersOn(tvCanvas(tv), ogreLabel)).toEqual(['bloodied']);
    await rail(dm).getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(() => markersOn(tvCanvas(tv), ogreLabel)).toEqual(['bloodied', 'concentrating']);

    // The hidden shade marked dead: the TV hears nothing of it.
    await selectTokenRow(dm, shadeLabel);
    const before = tvFrames.length;
    await chip(dm, 'Dead').click();
    await expect.poll(() => markersOn(viewport(dm), shadeLabel)).toEqual(['dead']);
    await dm.waitForTimeout(300);
    expect(tvFrames.slice(before).join('')).not.toContain('dead');
    expect((await drawn(tvCanvas(tv))).map((token) => token.label)).toEqual([ogreLabel]);

    // Both views reload: the markers are stored.
    await tv.reload();
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    await expect.poll(() => markersOn(tvCanvas(tv), ogreLabel)).toEqual(['bloodied', 'concentrating']);
    await dm.reload();
    await expect.poll(() => markersOn(viewport(dm), shadeLabel)).toEqual(['dead']);

    // Revealed, the shade reaches the TV with its marker.
    await selectTokenRow(dm, shadeLabel);
    await tokenPopover(dm)
      .getByRole('button', { name: `Reveal token ${shadeLabel}` })
      .click();
    await expect.poll(() => markersOn(tvCanvas(tv), shadeLabel)).toEqual(['dead']);

    // TBL-05: the other sixteen conditions on the ogre, the pinned ones from their chips and the rest from
    // More…, each reaching the TV in the order applied; Exhaustion stepped to 2; a reloaded TV gets them all
    // from its snapshot; undo takes every change back one at a time and redo puts them all back.
    await selectTokenRow(dm, ogreLabel);
    const expected = ['bloodied', 'concentrating'];
    for (const name of ['Unconscious', 'Dead', 'Prone', 'Poisoned']) {
      await chip(dm, name).click();
      expected.push(name.toLowerCase());
      await expect.poll(() => markersOn(tvCanvas(tv), ogreLabel)).toEqual(expected);
    }
    for (const name of [
      'Blinded',
      'Charmed',
      'Deafened',
      'Exhaustion',
      'Frightened',
      'Grappled',
      'Incapacitated',
      'Invisible',
      'Paralyzed',
      'Petrified',
      'Restrained',
      'Stunned',
    ]) {
      await tokenPopover(dm).getByRole('button', { name: 'More conditions' }).click();
      // The list opens inside the popover, under the chips: never wider than it, so it never scrolls sideways.
      expect(await tokenPopover(dm).evaluate((popover) => popover.scrollWidth - popover.clientWidth)).toBe(0);
      await tokenPopover(dm).getByRole('combobox', { name: 'Search conditions' }).fill(name.slice(0, 4));
      await tokenPopover(dm).getByRole('option', { name, exact: true }).click();
      expected.push(name === 'Exhaustion' ? 'exhaustion:1' : name.toLowerCase());
      await expect.poll(() => markersOn(tvCanvas(tv), ogreLabel)).toEqual(expected);
      // Chosen from the list, it shows as a pressed chip in the popover.
      await expect(chip(dm, name)).toHaveAttribute('aria-pressed', 'true');
    }
    await tokenPopover(dm)
      .getByRole('button', { name: `Raise exhaustion of ${ogreLabel}` })
      .click();
    const all = expected.map((id) => (id === 'exhaustion:1' ? 'exhaustion:2' : id));
    await expect.poll(() => markersOn(tvCanvas(tv), ogreLabel)).toEqual(all);
    expect(all).toHaveLength(18);
    await tv.reload();
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    await expect.poll(() => markersOn(tvCanvas(tv), ogreLabel)).toEqual(all);
    const undo = rail(dm).getByRole('button', { name: 'Undo', exact: true });
    const redo = rail(dm).getByRole('button', { name: 'Redo', exact: true });
    await undo.click();
    await expect.poll(() => markersOn(tvCanvas(tv), ogreLabel)).toEqual(expected);
    for (let left = expected.length - 1; left >= 2; left--) {
      await undo.click();
      await expect.poll(() => markersOn(tvCanvas(tv), ogreLabel)).toEqual(expected.slice(0, left));
    }
    for (let count = 3; count <= expected.length; count++) {
      await redo.click();
      await expect.poll(() => markersOn(tvCanvas(tv), ogreLabel)).toEqual(expected.slice(0, count));
    }
    await redo.click();
    await expect.poll(() => markersOn(tvCanvas(tv), ogreLabel)).toEqual(all);
  } finally {
    await liveBar(dm)
      .getByRole('button', { name: 'Go idle' })
      .click()
      .catch(() => undefined);
    const summary = await dm.request.get(`/api/campaigns/${campaignId}/deletion`);
    if (summary.ok()) {
      await dm.request.delete(`/api/campaigns/${campaignId}`, { data: { confirm: (await summary.json()) as object } });
    }
    for (const id of [ogre.id, shade.id]) await dm.request.delete(`/api/assets/${id}`);
    await dmContext.close();
    await playerContext.close();
  }
});
