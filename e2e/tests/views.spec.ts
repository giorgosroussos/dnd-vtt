import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// Both view shells from the production build (FND-04, specs/02-architecture.md §2).
// This is not the offline gate of REL-02 (specs/10-testing-acceptance.md §6): it
// shows what the pages ask for, not that they work with the network blocked.

interface Recorded {
  url: string;
  status: number;
}

// Every response a context receives, to assert that both views load from the
// server alone (specs/02-architecture.md §6).
function recordResponses(context: BrowserContext): Recorded[] {
  const seen: Recorded[] = [];
  context.on('request', (request) => seen.push({ url: request.url(), status: 0 }));
  context.on('response', (response) => {
    const entry = seen.find((item) => item.url === response.url() && item.status === 0);
    if (entry) entry.status = response.status();
  });
  return seen;
}

async function open(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage();
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  expect(errors).toEqual([]);
  return page;
}

test('a DM view and a player view open side by side from one server', async ({ browser }) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();

  const dm = await open(dmContext, '/dm');
  const player = await open(playerContext, '/');

  await expect(dm.locator('main[data-view="dm"]')).toHaveCount(1);
  await expect(dm.locator('main[data-view="player"]')).toHaveCount(0);
  // A browser without a DM session gets the PIN form (first-run.spec.ts set the PIN).
  await expect(dm.getByRole('heading', { level: 1 })).toHaveText('Enter the DM PIN');
  await expect(player.locator('main[data-view="player"]')).toHaveCount(1);
  await expect(player.locator('main[data-view="dm"]')).toHaveCount(0);

  // The title and language come from the catalogue, not from placeholders.
  for (const page of [dm, player]) {
    await expect(page).toHaveTitle('Emberglass');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  }

  await dmContext.close();
  await playerContext.close();
});

test('the player view is the idle screen: dark, the product name only, no control', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('main[data-view="player"]')).toHaveText('Emberglass');
  const focusable = await page
    .locator('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]')
    .count();
  expect(focusable).toBe(0);
  const background = await page.locator('.eg-idle').evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(background).toBe('rgb(20, 17, 15)');
  // The screen is filled and the name sits in its centre.
  const viewport = page.viewportSize()!;
  const idle = (await page.locator('.eg-idle').boundingBox())!;
  expect(idle).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });
  const name = (await page.locator('.eg-idle__name').boundingBox())!;
  expect(Math.abs(name.x + name.width / 2 - viewport.width / 2)).toBeLessThan(2);
  expect(Math.abs(name.y + name.height / 2 - viewport.height / 2)).toBeLessThan(2);
});

test('both views request nothing but the local origin, their font and icon included', async ({ browser, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  for (const path of ['/dm', '/']) {
    const context = await browser.newContext();
    const seen = recordResponses(context);
    const page = await open(context, path);

    for (const { url } of seen) expect(new URL(url).origin, `${path} requested ${url}`).toBe(origin);

    // Not vacuous: the bundled font was among the requests, came from the
    // server, and is the face the page renders with (specs/02-architecture.md §6).
    const fonts = seen.filter(({ url }) => url.endsWith('.woff2'));
    expect(fonts.length, `${path} loaded no font file`).toBeGreaterThan(0);
    for (const font of fonts) expect(font.status, font.url).toBe(200);
    const loaded = await page.evaluate(() =>
      [...document.fonts].some(
        (face) => face.family.replace(/["']/g, '') === 'Inter Variable' && face.status === 'loaded',
      ),
    );
    expect(loaded, `${path} does not render with the bundled font`).toBe(true);

    // The icon is declared, local and served. Headless Chromium does not fetch
    // favicons itself, so the test fetches the declared one.
    const icon = await page.locator('link[rel="icon"]').evaluate((link: HTMLLinkElement) => link.href);
    expect(new URL(icon).origin).toBe(origin);
    const response = await page.request.get(icon);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/svg+xml');

    await context.close();
  }
});

test('the player view does not load the DM view code', async ({ browser }) => {
  const context = await browser.newContext();
  const seen = recordResponses(context);
  await open(context, '/');

  const dmScripts = seen.filter(({ url }) => /DmView|ErrorScreen/.test(url));
  expect(dmScripts).toEqual([]);
  // By content too, whatever the bundler names the chunks: no script the player
  // view loaded carries the DM shell's or the DM error screen's markup.
  const scripts = seen.filter(({ url }) => url.endsWith('.js'));
  expect(scripts.length).toBeGreaterThan(0);
  for (const { url } of scripts) {
    const body = await (await context.request.get(url)).text();
    expect(body, url).not.toMatch(/eg-dm__|dm-error/);
  }
  await context.close();
});
