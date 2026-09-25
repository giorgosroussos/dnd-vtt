import { expect, test, type Page } from '@playwright/test';
import { openWorkspace } from './dm.js';

// LIV-01: the live connection of both views against the production server (specs/04-live-sync.md
// §1, §5, §6, specs/07-security-and-access.md §2). The player view shows the idle screen until
// LIV-03; its `data-live` and `data-snapshots` attributes say how its connection stands.

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
