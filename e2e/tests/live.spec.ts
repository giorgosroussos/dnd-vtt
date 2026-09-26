import { expect, test, type Page } from '@playwright/test';
import { openWorkspace, seedCampaign } from './dm.js';
import { solidPng } from './png.js';
import { commandFromPage, snapshotsOf } from './socket.js';

// LIV-01: the live connection of both views against the production server (specs/04-live-sync.md
// §1, §5, §6, specs/07-security-and-access.md §2). The player view's `data-live` and
// `data-snapshots` attributes say how its connection stands; what it draws is player.spec.ts's.

const liveBar = (page: Page) => page.getByRole('region', { name: 'Live scene' }).getByRole('status');
const player = (page: Page) => page.locator('main[data-view="player"]');

/** The rooms of the snapshots a page receives over its WebSocket, in order. */
function roomsOf(page: Page): string[] {
  const rooms: string[] = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      const match = /"role":"(dm|players)"/.exec(String(payload));
      if (match) rooms.push(match[1]!);
    });
  });
  return rooms;
}

test('a DM view and a player view connect side by side, each to its own room', async ({ browser }) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const tv = await playerContext.newPage();
  const dmRooms = roomsOf(dm);
  const tvRooms = roomsOf(tv);

  await openWorkspace(dm);
  await tv.goto('/');
  await expect(player(tv)).toHaveAttribute('data-live', 'connected');
  await expect(player(tv)).toHaveAttribute('data-snapshots', '1');
  await expect(player(tv)).toHaveText('Emberglass');
  // Each received the snapshot of its own room, from the session cookie alone.
  await expect.poll(() => dmRooms).toEqual(['dm']);
  await expect.poll(() => tvRooms).toEqual(['players']);
  await expect(dm.getByRole('navigation', { name: 'Campaigns, sessions and scenes' })).toBeVisible();

  await dmContext.close();
  await playerContext.close();
});

test('a player view opened in the DM browser still joins the players room (D-105)', async ({ browser }) => {
  // The DM's laptop drives the TV from a second window of the same browser, with the DM cookie.
  const context = await browser.newContext();
  const dm = await context.newPage();
  await openWorkspace(dm);
  const tv = await context.newPage();
  const tvRooms = roomsOf(tv);
  await tv.goto('/');
  await expect(player(tv)).toHaveAttribute('data-snapshots', '1');
  await expect.poll(() => tvRooms).toEqual(['players']);
  // The DM view in the same browser keeps its workspace.
  await expect(dm.getByRole('navigation', { name: 'Campaigns, sessions and scenes' })).toBeVisible();
  await context.close();
});

test('a player view taken offline reconnects by itself and resynchronises from a fresh snapshot', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const tv = await context.newPage();
  await tv.goto('/');
  await expect(player(tv)).toHaveAttribute('data-snapshots', '1');

  await context.setOffline(true);
  await expect(player(tv)).toHaveAttribute('data-live', 'reconnecting');
  // The TV keeps its picture and shows no message or control meanwhile (Q-025).
  await expect(player(tv)).toHaveText('Emberglass');

  await context.setOffline(false);
  await expect(player(tv)).toHaveAttribute('data-live', 'connected', { timeout: 15_000 });
  await expect(player(tv)).toHaveAttribute('data-snapshots', '2');
  await context.close();
});

test('a DM view taken offline says it is reconnecting and comes back without asking for the PIN', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const dm = await context.newPage();
  await openWorkspace(dm);
  await expect(liveBar(dm)).not.toHaveText('Loading…');
  const before = await liveBar(dm).textContent();

  await context.setOffline(true);
  await expect(liveBar(dm)).toHaveText('The connection to the server was lost. Reconnecting…');
  await context.setOffline(false);
  await expect(liveBar(dm)).toHaveText(before!, { timeout: 15_000 });
  await expect(dm.getByRole('heading', { name: 'Enter the DM PIN' })).toHaveCount(0);
  await expect(dm.getByRole('navigation', { name: 'Campaigns, sessions and scenes' })).toBeVisible();
  await context.close();
});

test('a DM view whose session is ended elsewhere goes back to the PIN form at once', async ({ browser }) => {
  const context = await browser.newContext();
  const dm = await context.newPage();
  await openWorkspace(dm);
  await expect(liveBar(dm)).not.toHaveText('Loading…');
  // The same browser's session ended from outside the page, as a PIN change on another device
  // would end it: the server drops its socket, and the view learns so without any action here.
  expect((await dm.request.delete('/api/auth')).status()).toBe(204);
  await expect(dm.getByRole('heading', { name: 'Enter the DM PIN' })).toBeVisible();
  await context.close();
});

// LIV-02: a live command from the DM view's browser over the real socket (specs/04-live-sync.md
// §2, §3, §4). The DM page speaks the Socket.io wire protocol itself (socket.ts), so the command and
// what the player socket receives are checked frame by frame; its WebSocket carries the page's DM
// cookie and Origin, as the view's own does. The DM view's own controls are live-mode.spec.ts's (LIV-04). What the player view received is read here from its WebSocket frames; what it
// draws from them is player.spec.ts's (LIV-03).

test('a DM context activates a scene through the socket and a player context receives its snapshot, visible tokens only', async ({
  browser,
}) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const tv = await playerContext.newPage();
  await openWorkspace(dm);

  // A scene with a map, a visible token and a hidden one, prepared over REST.
  const upload = async (colour: [number, number, number]) =>
    (await (
      await dm.request.post('/api/images', {
        data: solidPng(64, 48, colour),
        headers: { 'content-type': 'application/octet-stream' },
      })
    ).json()) as { id: string };
  const campaignId = await seedCampaign(dm, 'Live campaign LIV-02', ['Live night']);
  const [session] = (await (await dm.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as { id: string }[];
  const scene = (await (
    await dm.request.post(`/api/sessions/${session!.id}/scenes`, { data: { name: 'Hidden lair' } })
  ).json()) as { id: string };
  const map = await upload([20, 60, 20]);
  expect((await dm.request.patch(`/api/scenes/${scene.id}`, { data: { map_image_id: map.id } })).ok()).toBe(true);
  const asset = async (name: string, colour: [number, number, number], hidden: boolean) =>
    (await (
      await dm.request.post('/api/assets', {
        data: {
          name,
          image_id: (await upload(colour)).id,
          category: 'monster',
          size: 'medium',
          default_hidden: hidden,
        },
      })
    ).json()) as { id: string; image_id: string };
  const knight = await asset('Knight of LIV-02', [200, 200, 30], false);
  const lurker = await asset('Lurker of LIV-02', [90, 10, 90], true);
  const place = async (assetId: string) =>
    (
      (await (
        await dm.request.post(`/api/scenes/${scene.id}/tokens`, { data: { asset_id: assetId, x: 1, y: 1 } })
      ).json()) as { token: { id: string } }
    ).token.id;
  const visibleId = await place(knight.id);
  const hiddenId = await place(lurker.id);

  // Whatever fails, nothing stays live for the specs after this one: they share the server.
  try {
    const snapshots = snapshotsOf(tv);
    await tv.goto('/');
    await expect(player(tv)).toHaveAttribute('data-snapshots', '1');

    expect(await commandFromPage(dm, 'scene.activate', { scene_id: scene.id })).toEqual({ ok: true });
    await expect(player(tv)).toHaveAttribute('data-snapshots', '2');
    await expect.poll(() => snapshots.length).toBe(2);
    const live = snapshots[1] as { role: string; scene: { map: { id: string }; tokens: { id: string }[] } };
    expect(live.role).toBe('players');
    expect(live.scene.map.id).toBe(map.id);
    expect(live.scene.tokens.map((token) => token.id)).toEqual([visibleId]);
    const text = JSON.stringify(snapshots);
    for (const secret of [hiddenId, lurker.id, lurker.image_id, 'Lurker', scene.id, 'Hidden lair']) {
      expect(text, secret).not.toContain(secret);
    }
    // The player view's browser, with no DM session, fetches the live map's display version and
    // the visible token's image only.
    expect((await tv.request.get(`/images/${map.id}/display`)).status()).toBe(200);
    expect((await tv.request.get(`/images/${knight.image_id}/display`)).status()).toBe(200);
    expect((await tv.request.get(`/images/${lurker.image_id}/display`)).status()).toBe(404);
    expect((await tv.request.get(`/images/${map.id}/original`)).status()).toBe(404);

    // A command from the player view's browser is refused, and the scene stays live.
    expect(await commandFromPage(tv, 'scene.deactivate', {})).toMatchObject({ error: { code: 'forbidden' } });
    expect((await tv.request.get(`/images/${map.id}/display`)).status()).toBe(200);
    expect(await commandFromPage(dm, 'scene.deactivate', {})).toEqual({ ok: true });
    await expect.poll(async () => (await tv.request.get(`/images/${map.id}/display`)).status()).toBe(404);
  } finally {
    await commandFromPage(dm, 'scene.deactivate', {}).catch(() => undefined);
    await dmContext.close();
    await playerContext.close();
  }
});
