import { expect, test } from '@playwright/test';
// From the source, so the bound cannot drift from the heartbeat both ends keep.
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS } from '../../../shared/src/live.js';
import { selectScene } from '../canvas-view.js';
import { openWorkspace, seedCampaign, signIn } from '../dm.js';
import { solidPng } from '../png.js';
import { commandFromPage } from '../socket.js';
import { startRelay, type Relay } from './relay.js';
import { deleteAssets, deleteCampaign, liveBar, panel, player, tvTokens, unique } from './support.js';

// Journey 5, Recover (specs/10-testing-acceptance.md §5, specs/08-ux-journeys.md §10, specs/04-live-sync.md
// §5, §6, specs/07-security-and-access.md §2, Q-008): the network of the player device and of the DM laptop
// is killed while a scene is live, the game goes on from elsewhere, the network comes back, and both views
// return to the current state without a PIN prompt. Each view reaches the server through its own relay
// (relay.ts), which goes silent as a dropped Wi-Fi does, so each learns of the loss from the heartbeat
// alone, within its bound (G-026).

const BOUND_MS = HEARTBEAT_INTERVAL_MS + HEARTBEAT_TIMEOUT_MS;

test('Recover: the TV and the DM laptop lose the network and get it back, and both show the current state without a PIN prompt', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const server = new URL(baseURL!);
  const relays: Relay[] = [];
  const relay = async () => {
    const made = await startRelay({ host: server.hostname, port: Number(server.port) });
    relays.push(made);
    return made;
  };
  const laptopNet = await relay();
  const tvNet = await relay();
  // The game goes on from a browser whose network stays up: the server PC's own.
  const controlContext = await browser.newContext();
  const dmContext = await browser.newContext({ baseURL: laptopNet.origin });
  const tvContext = await browser.newContext({ baseURL: tvNet.origin });
  const control = await controlContext.newPage();
  const dm = await dmContext.newPage();
  const tv = await tvContext.newPage();
  await signIn(control);
  await control.goto('/dm');

  const upload = async (colour: [number, number, number], width = 64, height = 64) =>
    (await (
      await control.request.post('/api/images', {
        data: solidPng(width, height, colour),
        headers: { 'content-type': 'application/octet-stream' },
      })
    ).json()) as { id: string };
  const names = { campaign: unique(info, 'Recover journey'), session: 'Stormy night', scene: 'Lighthouse' };
  const campaignId = await seedCampaign(control, names.campaign, [names.session]);
  const [session] = (await (await control.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as {
    id: string;
  }[];
  const scene = (await (
    await control.request.post(`/api/sessions/${session!.id}/scenes`, { data: { name: names.scene } })
  ).json()) as { id: string };
  const map = await upload([20, 40, 60], 600, 400);
  expect((await control.request.patch(`/api/scenes/${scene.id}`, { data: { map_image_id: map.id } })).ok()).toBe(true);
  const asset = async (name: string, colour: [number, number, number], hidden: boolean) =>
    (await (
      await control.request.post('/api/assets', {
        data: {
          name,
          image_id: (await upload(colour)).id,
          category: 'monster',
          size: 'medium',
          default_hidden: hidden,
        },
      })
    ).json()) as { id: string };
  const keeper = await asset(unique(info, 'Keeper'), [200, 200, 200], false);
  const drowned = await asset(unique(info, 'Drowned'), [30, 90, 90], true);
  const place = async (assetId: string, x: number, y: number) =>
    (
      (await (
        await control.request.post(`/api/scenes/${scene.id}/tokens`, { data: { asset_id: assetId, x, y } })
      ).json()) as { token: { id: string } }
    ).token;
  const keeperToken = await place(keeper.id, 2, 2);
  const drownedToken = await place(drowned.id, 5, 4);

  try {
    // The DM laptop, through its network: signed in once, live on the scene; the TV shows it.
    await openWorkspace(dm);
    await tv.goto('/');
    await selectScene(dm, names);
    await liveBar(dm)
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await expect(panel(dm)).toHaveAttribute('data-mode', 'live');
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    await expect.poll(async () => (await tvTokens(tv)).map((each) => each.id)).toEqual([keeperToken.id]);

    // Both networks die. The DM view says it is reconnecting once its heartbeat notices, within the bound.
    const cutAt = Date.now();
    laptopNet.cut();
    tvNet.cut();
    await expect(liveBar(dm).getByText('The connection to the server was lost. Reconnecting…')).toBeVisible({
      timeout: BOUND_MS + 5_000,
    });
    // And so does the TV's, whose network died too (review M6).
    await expect(player(tv)).toHaveAttribute('data-live', 'reconnecting', { timeout: BOUND_MS + 5_000 });
    expect(Date.now() - cutAt).toBeLessThan(BOUND_MS + 5_000);

    // Meanwhile the game goes on: the keeper moves and the drowned one is revealed.
    expect(await commandFromPage(control, 'token.move', { token_id: keeperToken.id, x: 7, y: 3 })).toEqual({
      ok: true,
    });
    expect(await commandFromPage(control, 'token.setVisibility', { token_id: drownedToken.id, hidden: false })).toEqual(
      {
        ok: true,
      },
    );

    // The networks come back: both views are in step again by themselves, with no PIN asked.
    laptopNet.restore();
    tvNet.restore();
    await expect
      .poll(async () => (await tvTokens(tv)).map(({ id, x, y }) => ({ id, x, y })).sort((a, b) => a.x - b.x), {
        timeout: 20_000,
      })
      .toEqual([
        { id: drownedToken.id, x: 5, y: 4 },
        { id: keeperToken.id, x: 7, y: 3 },
      ]);
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    await expect(player(tv)).toHaveAttribute('data-live', 'connected');
    await expect(liveBar(dm).getByRole('status')).toHaveText(`Live: ${names.scene}`, { timeout: 20_000 });
    await expect(panel(dm)).toHaveAttribute('data-mode', 'live');
    await expect
      .poll(async () => {
        const drawn = JSON.parse(
          (await dm.locator('main [role="application"]').getAttribute('data-tokens')) ?? '[]',
        ) as {
          id: string;
          x: number;
          hidden: boolean;
        }[];
        return drawn.map(({ id, x, hidden }) => ({ id, x, hidden })).sort((a, b) => a.x - b.x);
      })
      .toEqual([
        { id: drownedToken.id, x: 5, hidden: false },
        { id: keeperToken.id, x: 7, hidden: false },
      ]);
    await expect(dm.getByRole('heading', { level: 1, name: 'Enter the DM PIN' })).toHaveCount(0);
    await expect(dm.getByRole('navigation', { name: 'Campaigns, sessions and scenes' })).toBeVisible();
    // And the laptop still commands: Blank TV from it reaches the TV.
    await liveBar(dm).getByRole('button', { name: 'Blank TV' }).click();
    await expect(player(tv)).toHaveAttribute('data-scene', 'idle');
  } finally {
    await commandFromPage(control, 'scene.deactivate', {}).catch(() => undefined);
    await deleteCampaign(control, campaignId);
    await deleteAssets(control, [keeper.id, drowned.id]);
    await controlContext.close();
    await dmContext.close();
    await tvContext.close();
    await Promise.all(relays.map((each) => each.close()));
  }
});
