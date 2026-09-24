import type { Page } from '@playwright/test';

// Readable contrast of what is actually rendered (specs/08-ux-journeys.md §8):
// every element with text of its own against its effective background. Shared by
// keyboard.spec.ts and canvas.spec.ts (D-072).
export async function contrastFailures(page: Page): Promise<string[]> {
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
