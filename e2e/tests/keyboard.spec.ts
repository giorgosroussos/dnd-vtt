import { expect, test, type Page } from '@playwright/test';
import { contrastFailures } from './contrast.js';
import { openWorkspace, seedCampaign } from './dm.js';
import { commandFromPage } from './socket.js';

// Keyboard-operability smoke test of the DM view (FND-04, specs/08-ux-journeys.md
// §8, D-072). It is generic: every element sequential navigation can reach in the
// DM view is walked, so each control a later package adds is covered without
// changing this file. For each one it proves that Tab alone reaches it, that it
// then shows a visible focus indicator, and that the keyboard operates it.

// Kept equal to FOCUSABLE in client/src/ui/testing/render.ts.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

// The walk covers the signed-in workspace, where the DM's controls are (D-086).
// Operating Sign out ends the session, so every opening signs in again first. It
// waits until the tree and the library have loaded, so that the elements Tab walks
// are those the walk counted, not the ones that happened to arrive first (D-092).
async function openDm(page: Page): Promise<void> {
  await openWorkspace(page);
  await expect(page.locator('main[data-view="dm"]')).toBeVisible();
  await expect(page.getByText('Loading…', { exact: true })).toHaveCount(0);
}

// One campaign, so the walk reaches a tree item's controls as well as the
// workspace's own.
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await openWorkspace(page);
  await seedCampaign(page, 'Keyboard campaign', ['Keyboard session']);
  await page.close();
});

interface Ring {
  outline: string;
  width: number;
  shadow: string;
}

async function ringOf(page: Page, index: number): Promise<Ring> {
  return page
    .locator(FOCUSABLE)
    .nth(index)
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        outline: style.outlineStyle,
        width: parseFloat(style.outlineWidth) || 0,
        shadow: style.boxShadow,
      };
    });
}

test('every interactive element of the DM view is reached, shown and operated by keyboard alone', async ({ page }) => {
  // The walk reopens the view once per element, and every campaign the earlier specs seed adds
  // elements: 19 s on a quiet machine, 28.6 s under load while PRP-04 was verified, against the
  // 30 s default. The budget grows; what is checked does not (D-100).
  test.setTimeout(90_000);
  // Activations are recorded in the test process, not in the page, so that a
  // link which loads another page still counts as operated.
  let activations = 0;
  await page.exposeFunction('egActivated', () => {
    activations++;
  });
  await openDm(page);
  const count = await page.locator(FOCUSABLE).count();
  expect(count, 'the DM view has no interactive element to test').toBeGreaterThan(0);
  // DOM order is Tab order only without positive tabindex values.
  const positive = await page
    .locator('[tabindex]')
    .evaluateAll((all) => all.filter((e) => (e as HTMLElement).tabIndex > 0).length);
  expect(positive).toBe(0);

  for (let index = 0; index < count; index++) {
    await openDm(page);
    const element = page.locator(FOCUSABLE).nth(index);
    const name = await element.evaluate((e) => `${e.tagName.toLowerCase()} "${e.textContent?.trim() ?? ''}"`);

    const unfocused = await ringOf(page, index);
    for (let presses = 0; presses <= index; presses++) await page.keyboard.press('Tab');
    await expect(element, `Tab did not reach ${name}`).toBeFocused();

    // Visible focus: a ring or shadow that the element does not have unfocused,
    // on an element that is on screen and has a size.
    const focused = await ringOf(page, index);
    const hasRing = (focused.outline !== 'none' && focused.width > 0) || focused.shadow !== 'none';
    expect(hasRing, `${name} shows no focus indicator`).toBe(true);
    expect(focused, `${name} looks the same focused and unfocused`).not.toEqual(unfocused);
    await expect(element, `${name} is not visible when focused`).toBeInViewport();

    // A field is operated by typing into it and a select by the arrow keys: the value
    // changes (D-088). A checkbox is a control Space toggles, like a button.
    const kind = await element.evaluate((e) => {
      if (e instanceof HTMLSelectElement) return 'select';
      if (e instanceof HTMLTextAreaElement) return 'text';
      if (e instanceof HTMLInputElement) {
        if (e.type === 'checkbox' || e.type === 'radio') return 'toggle';
        if (!['button', 'submit', 'reset', 'file', 'image'].includes(e.type)) return 'text';
      }
      return 'control';
    });
    if (kind === 'text' || kind === 'select') {
      const before = await element.inputValue();
      await page.keyboard.press(kind === 'text' ? 'x' : 'ArrowDown');
      await expect(element, `the keyboard did not change ${name}`).not.toHaveValue(before);
      continue;
    }

    // Operated by keyboard: Enter activates links and buttons, Space buttons and checkboxes too.
    const tag = await element.evaluate((e) => e.tagName.toLowerCase());
    const keys = kind === 'toggle' ? ['Space'] : tag === 'button' ? ['Enter', 'Space'] : ['Enter'];
    for (const key of keys) {
      if (key !== keys[0]) {
        await openDm(page);
        for (let presses = 0; presses <= index; presses++) await page.keyboard.press('Tab');
        await expect(element, `Tab did not reach ${name} again`).toBeFocused();
      }
      await element.evaluate((e) => {
        e.addEventListener(
          'click',
          () => void (window as unknown as { egActivated: () => Promise<void> }).egActivated(),
          {
            once: true,
          },
        );
      });
      const target = await element.getAttribute('href');
      const before = activations;
      await page.keyboard.press(key);
      await expect.poll(() => activations, `${key} did not operate ${name}`).toBe(before + 1);
      // An in-page link moves focus to what it names.
      if (target?.startsWith('#')) await expect(page.locator(target), `${name} did not move focus`).toBeFocused();
    }
  }
});

// Only the skip link's landmark hides its ring. A control focused by arrow keys,
// such as an item of a tree with a roving tabindex (specs/08-ux-journeys.md §1),
// has tabindex=-1 and must still show where the keyboard is.
test('an element outside the Tab order still shows the focus ring when the keyboard moves to it', async ({ page }) => {
  await openDm(page);
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => {
    const item = document.createElement('div');
    item.tabIndex = -1;
    document.querySelector('main')!.append(item);
    item.focus({ focusVisible: true });
    const style = getComputedStyle(item);
    return { visible: item.matches(':focus-visible'), outline: style.outlineStyle };
  });
  expect(ring).toEqual({ visible: true, outline: 'solid' });
});

test('every text in both views keeps readable contrast', async ({ page }) => {
  // The PIN form, as a browser without a session sees it.
  for (const path of ['/dm', '/']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(await contrastFailures(page), path).toEqual([]);
  }
  // The workspace with a campaign open, a create form and the delete dialog.
  await openWorkspace(page);
  const tree = page.getByRole('navigation', { name: 'Campaigns, sessions and scenes' });
  await tree.getByRole('button', { name: 'Keyboard campaign', exact: true }).click();
  await expect(tree.getByRole('button', { name: 'Keyboard session', exact: true })).toBeVisible();
  await tree.getByRole('button', { name: 'New session' }).click();
  expect(await contrastFailures(page), 'workspace').toEqual([]);
  await tree.getByRole('button', { name: 'Delete Keyboard session' }).click();
  await expect(page.getByRole('dialog')).toContainText('Scenes: 0');
  expect(await contrastFailures(page), 'delete dialog').toEqual([]);
  await page.keyboard.press('Escape');
  await page.getByRole('complementary', { name: 'Asset library' }).getByRole('button', { name: 'New asset' }).click();
  await expect(page.getByRole('dialog', { name: 'New asset' })).toBeVisible();
  expect(await contrastFailures(page), 'asset dialog').toEqual([]);
  await page.keyboard.press('Escape');
  // The Connect a screen panel (LIV-03).
  await page.getByRole('button', { name: 'Connect a screen' }).click();
  await expect(page.getByRole('dialog', { name: 'Connect a screen' })).toBeVisible();
  await expect(page.getByText('Finding the addresses of this PC…')).toHaveCount(0);
  expect(await contrastFailures(page), 'connect panel').toEqual([]);
});

// The DM view's load-failure state (G-007, D-113): its code cannot be fetched, as when the server
// stopped or restarted with a new build since the page arrived. The state is reached in the
// production build by refusing the view's chunk, and its one way out is operated by keyboard alone.
test('the DM view’s load-failure state is reached, shown and operated by keyboard alone', async ({ page }) => {
  await openWorkspace(page);
  const chunk = '**/assets/DmView-*.js';
  await page.route(chunk, (route) => route.abort());
  await page.goto('/dm');
  const failed = page.locator('main[data-view="boot"][data-boot="failed"]');
  await expect(failed).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText(
    'Emberglass could not load. The server may have stopped, or restarted with a new version.',
  );
  expect(await contrastFailures(page), 'load failure').toEqual([]);
  const reload = page.getByRole('button', { name: 'Reload' });
  expect(await page.locator(FOCUSABLE).count()).toBe(1);
  await page.keyboard.press('Tab');
  await expect(reload).toBeFocused();
  const ring = await reload.evaluate((element) => {
    const style = getComputedStyle(element);
    return (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none';
  });
  expect(ring, 'Reload shows no focus indicator').toBe(true);
  // The server can serve the view again: Enter reloads the page, which now loads it.
  await page.unroute(chunk);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Campaigns, sessions and scenes' })).toBeVisible();
  await expect(page.locator('main[data-view="boot"]')).toHaveCount(0);
});

/** Tabs from where focus is until `target` has it; fails when it is not reached within `limit` presses. */
async function tabTo(page: Page, target: ReturnType<Page['locator']>, limit = 200): Promise<void> {
  for (let presses = 0; presses < limit; presses++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error(`Tab did not reach ${await target.textContent()}`);
}

async function hasRing(target: ReturnType<Page['locator']>): Promise<boolean> {
  return target.evaluate((element) => {
    const style = getComputedStyle(element);
    return (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none';
  });
}

// The live controls appear only with a scene selected or a scene live, which the generic walk above
// does not reach (it walks the workspace as it opens): Go live, Show live scene and Blank TV
// (LIV-04, specs/08-ux-journeys.md §2, §8).
test('Go live, Show live scene and Blank TV are reached, shown and operated by keyboard alone', async ({ page }) => {
  await openWorkspace(page);
  const campaign = `Keyboard live ${Date.now()}`;
  const campaignId = await seedCampaign(page, campaign, ['Live session']);
  const [session] = (await (await page.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as {
    id: string;
  }[];
  for (const name of ['First hall', 'Second hall']) {
    expect((await page.request.post(`/api/sessions/${session!.id}/scenes`, { data: { name } })).ok()).toBe(true);
  }
  await page.reload();
  const tree = page.getByRole('navigation', { name: 'Campaigns, sessions and scenes' });
  const panel = page.locator('main .eg-scene');
  const bar = page.getByRole('region', { name: 'Live scene' });
  try {
    await tree.getByRole('button', { name: campaign, exact: true }).click();
    await tree.getByRole('button', { name: 'Live session', exact: true }).click();
    await tree.getByRole('button', { name: 'First hall', exact: true }).click();
    await expect(panel).toHaveAttribute('data-mode', 'prep');

    const goLive = bar.getByRole('button', { name: 'Go live: First hall' });
    await tabTo(page, goLive);
    expect(await hasRing(goLive), 'Go live shows no focus indicator').toBe(true);
    await page.keyboard.press('Enter');
    await expect(panel).toHaveAttribute('data-mode', 'live');
    expect(await contrastFailures(page), 'live mode').toEqual([]);

    await tree.getByRole('button', { name: 'Second hall', exact: true }).click();
    await expect(panel).toHaveAttribute('data-mode', 'prep');
    const showLive = bar.getByRole('button', { name: 'Show live scene' });
    await page.locator('#main').focus();
    await page.keyboard.press('Shift+Tab');
    await tabTo(page, showLive);
    expect(await hasRing(showLive), 'Show live scene shows no focus indicator').toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('First hall');
    await expect(panel).toHaveAttribute('data-mode', 'live');

    const blank = bar.getByRole('button', { name: 'Blank TV' });
    await tabTo(page, blank);
    expect(await hasRing(blank), 'Blank TV shows no focus indicator').toBe(true);
    await page.keyboard.press('Space');
    await expect(panel).toHaveAttribute('data-mode', 'prep');
    await expect(bar.getByRole('status')).toHaveText('Nothing is live. The TV shows the idle screen.');
  } finally {
    await commandFromPage(page, 'scene.deactivate', {}).catch(() => undefined);
  }
});
