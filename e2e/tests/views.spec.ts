import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// Every request a context makes, to assert that both views load from the
// server alone (specs/02-architecture.md §6).
function recordRequests(context: BrowserContext): string[] {
  const urls: string[] = [];
  context.on('request', (request) => urls.push(request.url()));
  return urls;
}

async function open(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage();
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
  return page;
}

test('a DM view and a player view open side by side from one server', async ({ browser, baseURL }) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const dmRequests = recordRequests(dmContext);
  const playerRequests = recordRequests(playerContext);

  const dm = await open(dmContext, '/dm');
  const player = await open(playerContext, '/');

  await expect(dm.locator('main[data-view="dm"]')).toHaveCount(1);
  await expect(dm.locator('main[data-view="player"]')).toHaveCount(0);
  await expect(player.locator('main[data-view="player"]')).toHaveCount(1);
  await expect(player.locator('main[data-view="dm"]')).toHaveCount(0);

  const origin = new URL(baseURL!).origin;
  for (const url of [...dmRequests, ...playerRequests]) {
    expect(new URL(url).origin, url).toBe(origin);
  }

  await dmContext.close();
  await playerContext.close();
});

test('the player view does not load the DM view code', async ({ browser }) => {
  const context = await browser.newContext();
  const requests = recordRequests(context);
  await open(context, '/');

  const dmScripts = requests.filter((url) => /DmView/.test(url));
  expect(dmScripts).toEqual([]);
  await context.close();
});
