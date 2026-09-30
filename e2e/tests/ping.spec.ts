import { expect, test, type Page } from '@playwright/test';
import { selectScene, viewport } from './canvas-view.js';
import { openWorkspace, seedCampaign } from './dm.js';
import { solidPng } from './png.js';

// TBL-01: the ping against the production server (specs/04-live-sync.md §2, §3, §12, specs/08-ux-journeys.md
// §11, Q-099). A DM context and a player context at once: a click with the ping tool on the live scene
// marks the same point in grid units on both views for about two seconds, and nothing keeps it, so a TV
// reconnecting afterwards draws none; on a scene that is not live the tool is not offered.

const player = (page: Page) => page.locator('main[data-view="player"]');
const tvCanvas = (page: Page) => page.locator('main[data-view="player"] .eg-canvas--player');
const panel = (page: Page) => page.locator('main.eg-scene');
const liveBar = (page: Page) => page.getByRole('region', { name: 'Live scene' });

type Drawn = { x: number; y: number; left: number; top: number }[];
const pingsOf = async (locator: ReturnType<typeof viewport>): Promise<Drawn> =>
  JSON.parse((await locator.getAttribute('data-pings')) ?? '[]') as Drawn;

test('a ping on the live scene shows at the same point on the TV for about two seconds, and nothing keeps it', async ({
  browser,
}) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const tv = await playerContext.newPage();
  await openWorkspace(dm);

  const names = { campaign: `Ping TBL-01 ${Date.now()}`, session: 'Pinging night', scene: 'Market square' };
  const campaignId = await seedCampaign(dm, names.campaign, [names.session]);
  const [session] = (await (await dm.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as { id: string }[];
  const map = (await (
    await dm.request.post('/api/images', {
      data: solidPng(600, 400, [60, 50, 40]),
      headers: { 'content-type': 'application/octet-stream' },
    })
  ).json()) as { id: string };
  await dm.request.post(`/api/sessions/${session!.id}/scenes`, { data: { name: names.scene, map_image_id: map.id } });
  await dm.request.post(`/api/sessions/${session!.id}/scenes`, { data: { name: 'Back alley' } });
  await dm.reload();

  try {
    await tv.goto('/');
    await expect(player(tv)).toHaveAttribute('data-scene', 'idle');

    // Not live: the tool is shown and not offered.
    await selectScene(dm, names);
    const tool = dm.getByRole('button', { name: 'Ping, P' });
    await expect(tool).toHaveAttribute('aria-disabled', 'true');
    await expect(tool).toHaveAccessibleDescription('Pings show on the TV, so they work on the live scene only.');

    await liveBar(dm)
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await expect(panel(dm)).toHaveAttribute('data-mode', 'live');
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    await expect(tool).not.toHaveAttribute('aria-disabled');
    await tool.click();
    await expect(tool).toHaveAttribute('aria-pressed', 'true');
    await expect(viewport(dm)).toHaveAttribute('data-ping-tool', 'on');

    // A click on the map: both views draw the point, the same in grid units.
    const box = (await viewport(dm).boundingBox())!;
    const at = { x: box.width * 0.55, y: box.height * 0.5 };
    await viewport(dm).click({ position: at });
    await expect.poll(async () => (await pingsOf(tvCanvas(tv))).length).toBe(1);
    const [onTv] = await pingsOf(tvCanvas(tv));
    const [onDm] = await pingsOf(viewport(dm));
    expect(onDm).toMatchObject({ x: onTv!.x, y: onTv!.y });
    // Drawn where the DM clicked, within the viewport's border.
    expect(Math.abs(onDm!.left - at.x)).toBeLessThan(2);
    expect(Math.abs(onDm!.top - at.y)).toBeLessThan(2);
    // Then let go, on both, after about two seconds.
    await expect(tvCanvas(tv)).not.toHaveAttribute('data-pings', { timeout: 5_000 });
    await expect(viewport(dm)).not.toHaveAttribute('data-pings', { timeout: 5_000 });

    // Enter on the map pings the centre of the view; a TV connecting afterwards is given none.
    await viewport(dm).focus();
    await dm.keyboard.press('Enter');
    await expect.poll(async () => (await pingsOf(tvCanvas(tv))).length).toBe(1);
    const late = await playerContext.newPage();
    await late.goto('/');
    await expect(player(late)).toHaveAttribute('data-scene', 'live');
    await expect(tvCanvas(late)).not.toHaveAttribute('data-pings');
    await late.close();

    // Escape on the map stops pinging.
    await dm.keyboard.press('Escape');
    await expect(viewport(dm)).toHaveAttribute('data-ping-tool', 'off');
  } finally {
    await liveBar(dm)
      .getByRole('button', { name: 'Go idle' })
      .click()
      .catch(() => undefined);
    const summary = await dm.request.get(`/api/campaigns/${campaignId}/deletion`);
    if (summary.ok()) {
      await dm.request.delete(`/api/campaigns/${campaignId}`, { data: { confirm: (await summary.json()) as object } });
    }
    await dmContext.close();
    await playerContext.close();
  }
});
