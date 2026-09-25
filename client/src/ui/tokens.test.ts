import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Readable contrast of the shared palette (specs/08-ux-journeys.md §8, D-069):
// WCAG 2 contrast ratios, 4.5:1 for text and 3:1 for the focus indicator. The
// rendered pages are checked again in e2e/tests/keyboard.spec.ts.
const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const colours = new Map<string, string>(
  [...css.matchAll(/--(color-[\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((match) => [match[1]!, match[2]!]),
);

function colour(name: string): string {
  const value = colours.get(name);
  if (!value) throw new Error(`tokens.css defines no --${name}`);
  return value;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

// Every text colour on every background it is drawn on in tokens.css.
const TEXT_PAIRS: [string, string][] = [
  ['color-text', 'color-bg'],
  ['color-text', 'color-surface'],
  ['color-text-muted', 'color-bg'],
  ['color-text-muted', 'color-surface'],
  ['color-on-accent', 'color-accent'],
  ['color-danger', 'color-bg'],
  ['color-danger', 'color-surface'],
  // The live bar's connection warning (D-106).
  ['color-accent', 'color-bg'],
  // The danger button: dark text on the danger colour (D-085).
  ['color-on-accent', 'color-danger'],
];

describe('the palette', () => {
  it('defines every colour the pairs use', () => {
    for (const name of [...TEXT_PAIRS.flat(), 'color-focus']) expect(colours.get(name), name).toMatch(/^#/);
  });

  it('computes contrast the way WCAG does', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it.each(TEXT_PAIRS)('keeps %s readable on %s (at least 4.5:1)', (text, background) => {
    expect(contrast(colour(text), colour(background))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['color-bg', 'color-surface'])('shows the focus ring on %s (at least 3:1)', (background) => {
    expect(contrast(colour('color-focus'), colour(background))).toBeGreaterThanOrEqual(3);
  });
});
