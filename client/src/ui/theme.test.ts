import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEME, THEME_VARIABLES } from './theme.js';

// The canvas's palette repeats tokens.css (UIX-01): every value must equal its variable, so the palette is
// defined once in effect and a change to one without the other fails here.
const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const variables = new Map<string, string>(
  [...css.matchAll(/(--color-[\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((match) => [match[1]!, match[2]!.toLowerCase()]),
);

describe('the canvas palette', () => {
  it.each(Object.entries(THEME_VARIABLES))('repeats %s as %s', (key, variable) => {
    expect(variables.get(variable), variable).toBe(THEME[key as keyof typeof THEME]);
  });

  it('names a variable for every value', () => {
    expect(Object.keys(THEME_VARIABLES).sort()).toEqual(Object.keys(THEME).sort());
  });
});
