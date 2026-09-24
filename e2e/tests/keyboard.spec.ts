import { expect, test, type Page } from '@playwright/test';
import { openWorkspace, seedCampaign } from './dm.js';

// Keyboard-operability smoke test of the DM view (FND-04, specs/08-ux-journeys.md
// §8, D-072). It is generic: every element sequential navigation can reach in the
// DM view is walked, so each control a later package adds is covered without
// changing this file. For each one it proves that Tab alone reaches it, that it
// then shows a visible focus indicator, and that the keyboard operates it.

// Kept equal to FOCUSABLE in client/src/ui/testing/render.ts.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

// The walk covers the signed-in workspace, where the DM's controls are (D-086).
// Operating Sign out ends the session, so every opening signs in again first.
async function openDm(page: Page): Promise<void> {
  await openWorkspace(page);
  await expect(page.locator('main[data-view="dm"]')).toBeVisible();
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

    // Operated by keyboard: Enter activates links and buttons, Space buttons too.
    const tag = await element.evaluate((e) => e.tagName.toLowerCase());
    const keys = tag === 'button' ? ['Enter', 'Space'] : ['Enter'];
    for (const key of keys) {
      if (key !== keys[0]) {
        await openDm(page);
        for (let presses = 0; presses <= index; presses++) await page.keyboard.press('Tab');
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

// Readable contrast of what is actually rendered (specs/08-ux-journeys.md §8):
// every element with text of its own against its effective background.
async function contrastFailures(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const parse = (value: string): number[] | null => {
      const match = /rgba?\(([^)]+)\)/.exec(value);
      if (!match) return null;
      const parts = match[1]!
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      return parts.length === 3 ? [...parts, 1] : parts;
    };
    const luminance = ([r, g, b]: number[]) =>
      [r!, g!, b!]
        .map((c) => c / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
    const background = (element: Element | null): number[] => {
      for (let node = element; node; node = node.parentElement) {
        const colour = parse(getComputedStyle(node).backgroundColor);
        if (colour && colour[3]! > 0) return colour;
      }
      return [255, 255, 255, 1];
    };
    const failures: string[] = [];
    for (const element of document.body.querySelectorAll('*')) {
      const ownText = [...element.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
      if (!ownText) continue;
      const text = parse(getComputedStyle(element).color)!;
      const [a, b] = [luminance(text), luminance(background(element))].sort((x, y) => y - x);
      const ratio = (a! + 0.05) / (b! + 0.05);
      if (ratio < 4.5) failures.push(`${element.tagName} "${element.textContent?.trim()}": ${ratio.toFixed(2)}:1`);
    }
    return failures;
  });
}

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
});
