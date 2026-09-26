import { expect, test, type Page } from '@playwright/test';
import { openWorkspace, seedCampaign } from './dm.js';
import { solidPng } from './png.js';
import { commandFromPage } from './socket.js';

// LIV-03: the player view draws the live scene and keeps it in step, and the DM view's "Connect a
// screen" panel shows its URL and QR code (specs/08-ux-journeys.md §4, §5, §9, specs/04-live-sync.md
// §3, §4, §9, Q-025, Q-026, Q-032, Q-053, Q-054, D-109, D-112), against the production server.

const player = (page: Page) => page.locator('main[data-view="player"]');
const canvas = (page: Page) => page.locator('main[data-view="player"] .eg-canvas--player');

interface Box {
  id: string;
  label: string;
  x: number;
  y: number;
  left: number;
  top: number;
  side: number;
}

async function drawnTokens(page: Page): Promise<Box[]> {
  const raw = await canvas(page).getAttribute('data-tokens');
  return raw ? (JSON.parse(raw) as Box[]) : [];
}

/** The colour a canvas layer drew at screen point (x, y) of the player view: 0 the map, 2 the tokens. */
async function pixel(page: Page, layer: number, x: number, y: number): Promise<number[]> {
  return canvas(page).evaluate(
    (element, { layer, x, y }) => {
      const target = element.querySelectorAll('canvas')[layer]!;
      const ratio = window.devicePixelRatio;
      return [...target.getContext('2d')!.getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data];
    },
    { layer, x, y },
  );
}

const near = (actual: number[], expected: number[], tolerance = 12) =>
  expected.every((value, index) => Math.abs(actual[index]! - value) <= tolerance);

test('a player context draws the scene a DM context activates, visible tokens only, and follows every live change', async ({
  browser,
}) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const tv = await playerContext.newPage();
  await openWorkspace(dm);

  const upload = async (width: number, height: number, colour: [number, number, number]) =>
    (await (
      await dm.request.post('/api/images', {
        data: solidPng(width, height, colour),
        headers: { 'content-type': 'application/octet-stream' },
      })
    ).json()) as { id: string };
  const campaignId = await seedCampaign(dm, 'Player view LIV-03', ['Table night']);
  const [session] = (await (await dm.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as { id: string }[];
  const scene = (await (
    await dm.request.post(`/api/sessions/${session!.id}/scenes`, { data: { name: 'Crypt of secrets' } })
  ).json()) as { id: string };
  const map = await upload(600, 400, [20, 60, 20]);
  // 20 squares across a 600 px map: 30 px a square.
  expect(
    (
      await dm.request.patch(`/api/scenes/${scene.id}`, {
        data: { map_image_id: map.id, grid: { size: 30, offset_x: 0, offset_y: 0, columns: 20, rows: 13 } },
      })
    ).ok(),
  ).toBe(true);
  const asset = async (name: string, colour: [number, number, number], hidden: boolean) =>
    (await (
      await dm.request.post('/api/assets', {
        data: {
          name,
          image_id: (await upload(64, 64, colour)).id,
          category: 'monster',
          size: 'large',
          default_hidden: hidden,
        },
      })
    ).json()) as { id: string; image_id: string };
  const knight = await asset('Knight of LIV-03', [230, 200, 30], false);
  const wraith = await asset('Wraith of LIV-03', [120, 20, 160], true);
  const brute = await asset('Brute of LIV-03', [200, 40, 40], false);
  const place = async (assetId: string, x: number, y: number) =>
    (
      (await (
        await dm.request.post(`/api/scenes/${scene.id}/tokens`, { data: { asset_id: assetId, x, y } })
      ).json()) as { token: { id: string; label: string } }
    ).token;
  const knightToken = await place(knight.id, 1, 1);
  const wraithToken = await place(wraith.id, 6, 1);
  const bruteToken = await place(brute.id, 11, 1);

  // Every image the TV's browser asks for, and every frame its socket receives.
  const requested: string[] = [];
  tv.on('request', (request) => requested.push(new URL(request.url()).pathname));
  const frames: string[] = [];
  tv.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => frames.push(String(payload))));

  try {
    await tv.goto('/');
    await expect(player(tv)).toHaveAttribute('data-scene', 'idle');
    await expect(player(tv)).toHaveText('Emberglass');

    // Activation: the map fitted, the visible tokens with their labels, no hidden one.
    expect(await commandFromPage(dm, 'scene.activate', { scene_id: scene.id })).toEqual({ ok: true });
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    await expect
      .poll(async () => (await drawnTokens(tv)).map((box) => box.label))
      .toEqual([knightToken.label, bruteToken.label]);
    // Fitted once the canvas has measured its viewport; until then the camera is the identity,
    // so everything read from screen positions waits for the fit (a slow runner measures late).
    const viewport = tv.viewportSize()!;
    const fitted = Math.min(viewport.width / 600, viewport.height / 400);
    await expect
      .poll(async () => Math.abs(Number(await canvas(tv).getAttribute('data-camera-scale')) - fitted))
      .toBeLessThan(1e-5);
    const scale = Number(await canvas(tv).getAttribute('data-camera-scale'));
    await expect(canvas(tv)).toHaveAttribute('data-grid', 'shown');
    // The map's colour away from the tokens, and each token's image in its square.
    const [knightBox, bruteBox] = await drawnTokens(tv);
    await expect
      .poll(async () => near(await pixel(tv, 0, viewport.width / 2, viewport.height - 5), [20, 60, 20, 255]))
      .toBe(true);
    await expect
      .poll(async () =>
        near(
          await pixel(tv, 2, knightBox!.left + knightBox!.side / 2, knightBox!.top + knightBox!.side / 2),
          [230, 200, 30, 255],
        ),
      )
      .toBe(true);
    await expect
      .poll(async () =>
        near(
          await pixel(tv, 2, bruteBox!.left + bruteBox!.side / 2, bruteBox!.top + bruteBox!.side / 2),
          [200, 40, 40, 255],
        ),
      )
      .toBe(true);
    // Where the hidden token lies, the map shows through: nothing is drawn there.
    const wraithAt = {
      x: knightBox!.left + 5 * 30 * scale + knightBox!.side / 2,
      y: knightBox!.top + knightBox!.side / 2,
    };
    expect((await pixel(tv, 2, wraithAt.x, wraithAt.y))[3]).toBe(0);

    // A reveal between the two: drawn between them, in its place in the stack.
    expect(await commandFromPage(dm, 'token.setVisibility', { token_id: wraithToken.id, hidden: false })).toEqual({
      ok: true,
    });
    await expect
      .poll(async () => (await drawnTokens(tv)).map((box) => box.label))
      .toEqual([knightToken.label, wraithToken.label, bruteToken.label]);
    await expect.poll(async () => near(await pixel(tv, 2, wraithAt.x, wraithAt.y), [120, 20, 160, 255])).toBe(true);

    // Hiding one, moving one and deleting one each change the drawing.
    expect(await commandFromPage(dm, 'token.setVisibility', { token_id: knightToken.id, hidden: true })).toEqual({
      ok: true,
    });
    await expect
      .poll(async () => (await drawnTokens(tv)).map((box) => box.id))
      .toEqual([wraithToken.id, bruteToken.id]);
    expect(await commandFromPage(dm, 'token.move', { token_id: bruteToken.id, x: 4, y: 8 })).toEqual({ ok: true });
    await expect
      .poll(async () => (await drawnTokens(tv)).find((box) => box.id === bruteToken.id))
      .toMatchObject({ x: 4, y: 8 });
    expect(await commandFromPage(dm, 'token.delete', { token_id: wraithToken.id })).toEqual({ ok: true });
    await expect.poll(async () => (await drawnTokens(tv)).map((box) => box.id)).toEqual([bruteToken.id]);

    // Deactivating shows the idle screen again.
    expect(await commandFromPage(dm, 'scene.deactivate', {})).toEqual({ ok: true });
    await expect(player(tv)).toHaveAttribute('data-scene', 'idle');
    await expect(player(tv)).toHaveText('Emberglass');

    // Only display versions, and never the image of a token while hidden: the wraith's image was
    // fetched only once it was revealed, which the socket frames show came first.
    const images = requested.filter((path) => path.startsWith('/images/'));
    expect(images.length).toBeGreaterThan(0);
    expect(images.every((path) => path.endsWith('/display'))).toBe(true);
    const beforeReveal = frames.slice(
      0,
      frames.findIndex((frame) => frame.includes(wraithToken.id)),
    );
    for (const secret of [wraithToken.id, wraith.image_id, 'Wraith', scene.id, 'Crypt of secrets']) {
      expect(beforeReveal.join('\n'), secret).not.toContain(secret);
    }
    // No control on the TV at any point.
    await expect(tv.locator('button, a[href], input, [tabindex]')).toHaveCount(0);
  } finally {
    await commandFromPage(dm, 'scene.deactivate', {}).catch(() => undefined);
    await dmContext.close();
    await playerContext.close();
  }
});

test('the player view hides the pointer after two seconds without movement', async ({ page }) => {
  await page.goto('/');
  await expect(player(page)).toHaveAttribute('data-live', 'connected');
  await page.mouse.move(200, 200);
  await page.mouse.move(210, 205);
  await expect(player(page)).toHaveAttribute('data-cursor', 'shown');
  const cursor = () => page.locator('.eg-idle__name').evaluate((element) => getComputedStyle(element).cursor);
  expect(await cursor()).not.toBe('none');
  await expect(player(page)).toHaveAttribute('data-cursor', 'hidden', { timeout: 3_500 });
  expect(await cursor()).toBe('none');
  await page.mouse.move(300, 300);
  await expect(player(page)).toHaveAttribute('data-cursor', 'shown');
});

test('the DM view’s Connect a screen panel shows the player view’s URL and its QR code, never the DM view', async ({
  page,
  baseURL,
}) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Connect a screen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect a screen' });
  await expect(dialog).toBeVisible();
  const info = (await (await page.request.get('/api/connect')).json()) as {
    addresses: { url: string }[];
    qr: { size: number } | null;
  };
  const port = new URL(baseURL!).port;
  if (info.addresses.length === 0) {
    // A runner with no network address: the panel says so and shows no code.
    await expect(dialog).toContainText('This PC has no network address.');
    await expect(dialog.locator('svg')).toHaveCount(0);
  } else {
    const url = info.addresses[0]!.url;
    expect(new URL(url).pathname).toBe('/');
    expect(new URL(url).port).toBe(port);
    await expect(dialog.locator('.eg-connect__url')).toHaveText(url);
    const qr = dialog.getByRole('img', { name: `QR code that opens ${url}` });
    await expect(qr).toBeVisible();
    await expect(qr).toHaveAttribute('data-size', String(info.qr!.size));
    const box = (await qr.boundingBox())!;
    expect(box.width).toBeGreaterThan(150);
  }
  await expect(dialog).not.toContainText('/dm');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
  // A browser without a DM session learns nothing from it.
  const stranger = await page.context().browser()!.newContext();
  expect((await stranger.request.get(`${baseURL}/api/connect`)).status()).toBe(401);
  await stranger.close();
});

test('the player view keeps the idle look when its code cannot load, and comes back by itself after the server restarts', async ({
  page,
}) => {
  const chunk = '**/assets/PlayerView-*.js';
  await page.route(chunk, (route) => route.abort());
  await page.goto('/');
  const boot = page.locator('main[data-view="boot"]');
  await expect(boot).toHaveAttribute('data-boot', 'failed');
  await expect(boot).toHaveText('Emberglass');
  await expect(page.locator('button, a[href], input, [tabindex]')).toHaveCount(0);
  // The server is unreachable for one of the TV's checks, as while it restarts (D-114).
  const isPage = (url: URL) => url.pathname === '/';
  let refused = 0;
  await page.route(isPage, (route) => {
    refused++;
    return route.abort();
  });
  await expect.poll(() => refused, { timeout: 10_000 }).toBeGreaterThan(0);
  await page.unroute(isPage);
  await page.unroute(chunk);
  // At its next check the server answers again, and the TV reloads into the player view.
  await expect(player(page)).toHaveAttribute('data-live', 'connected', { timeout: 15_000 });
});
