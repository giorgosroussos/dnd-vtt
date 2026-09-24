// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import { DmView } from '../dm/DmView.js';
import { PlayerView } from '../player/PlayerView.js';
import { DmErrorScreen } from './ErrorScreen.js';
import { IdleScreen } from './IdleScreen.js';
import { catalogue, t } from './messages.js';
import { render } from './testing/render.js';
import { TEXT_ATTRIBUTES, scanIndexHtml, scanSource } from './testing/uiTextScan.js';

// The message catalogue is the only source of UI text (specs/08-ux-journeys.md §6, D-073).
// A string, not a URL: jsdom replaces the global URL class.
const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const srcRoot = path.join(clientRoot, 'src');

// Every client source file the product is built from: tests and the test tooling
// in ui/testing/ are not shipped and may hold literals.
function productSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return full === path.join(srcRoot, 'ui', 'testing') ? [] : productSources(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('the static scan for UI text outside the catalogue', () => {
  it.each([
    ['JSX text', '<p>Hello</p>'],
    ['a string child', "<p>{'Hello'}</p>"],
    ['a template child', '<p>{`Hello ${name}`}</p>'],
    ['a conditional child', "<p>{ok ? t('app.name') : 'Failed'}</p>"],
    ['a fallback child', "<p>{name ?? 'Nobody'}</p>"],
    ['a guarded child', "<p>{ok && 'Done'}</p>"],
    ['a concatenated child', "<p>{t('app.name') + ' rules'}</p>"],
    ['an aria-label', '<button aria-label="Close" />'],
    ['an aria-label expression', "<button aria-label={'Close'} />"],
    ['an alt text', '<img alt="Map" />'],
    ['a title', '<span title="Hint" />'],
    ['a placeholder', '<input placeholder="Name" />'],
    ['a label prop', '<TextField label="PIN" />'],
    ['an error prop', '<TextField label={t(\'app.name\')} error="Wrong PIN" />'],
    ['a children prop', '<Button children="Save" />'],
    ['a submit input value', '<input type="submit" value="Go" />'],
  ])('flags %s', (_kind, jsx) => {
    const findings = scanSource('planted.tsx', `export const X = () => ${jsx};`);
    expect(findings.length).toBeGreaterThan(0);
  });

  it.each([
    ['document.title', "document.title = 'Emberglass';"],
    ['textContent', "element.textContent = 'Hello';"],
    ['innerText', 'element.innerText = `Hello`;'],
    ['a dialog', "if (confirm('Delete the scene?')) remove();"],
    ['a window dialog', "window.alert('Saved');"],
    ['a createElement child', "createElement('p', null, 'Hello');"],
    ['a createElement children prop', "createElement(Button, { children: 'Save' });"],
    ['a createElement text prop', "createElement('img', { alt: 'Map' });"],
  ])('flags text given to %s in a .ts file', (_kind, statement) => {
    expect(scanSource('planted.ts', statement).length).toBeGreaterThan(0);
  });

  it.each([
    ['catalogue text', "<p>{t('dm.status')}</p>"],
    ['interpolated catalogue text', "<h1>{t('dm.heading', { appName })}</h1>"],
    ['whitespace between elements', "<p>{t('app.name')}{' '}{t('dm.role')}</p>"],
    ['class names and ids', '<main id="main" className="eg-dm__main" data-view="dm" />'],
    ['a link target', '<a href="#main">{label}</a>'],
    ['an error thrown to the console', "throw new Error('The page has no #root element.');"],
    ['a text input value', '<input type="text" value={pin} />'],
    ['element types and class names given to createElement', "createElement('main', { className: 'eg-dm__main' });"],
  ])('does not flag %s', (_kind, code) => {
    expect(scanSource('clean.tsx', `export const X = () => { ${code} };`)).toEqual([]);
  });

  it('knows the text-bearing attributes the components accept', () => {
    expect([...TEXT_ATTRIBUTES]).toEqual(expect.arrayContaining(['aria-label', 'alt', 'title', 'placeholder']));
  });

  it('finds no UI text outside the catalogue in the client sources', () => {
    const files = productSources(srcRoot);
    // The scan covered the views and the base components, not an empty tree.
    const relative = files.map((file) => path.relative(srcRoot, file).split(path.sep).join('/'));
    expect(relative).toEqual(expect.arrayContaining(['dm/DmView.tsx', 'player/PlayerView.tsx', 'ui/Button.tsx']));
    const findings = files.flatMap((file) => scanSource(path.relative(clientRoot, file), readFileSync(file, 'utf8')));
    expect(findings).toEqual([]);
  });

  it('flags a title or body text written into an HTML page', () => {
    expect(scanIndexHtml('x.html', '<html lang="en"><title>Emberglass</title><body>Hi</body></html>')).toHaveLength(3);
  });

  it('finds no UI text in index.html: the title and language come from the catalogue', () => {
    const file = path.join(clientRoot, 'index.html');
    expect(scanIndexHtml('index.html', readFileSync(file, 'utf8'))).toEqual([]);
  });
});

describe('the catalogue', () => {
  it('has a non-empty English text for every key', () => {
    for (const [key, value] of Object.entries(catalogue)) expect(value.trim(), key).not.toBe('');
  });

  it('never names the trademark the product must not carry (specs/01-product-scope.md §8)', () => {
    for (const [key, value] of Object.entries(catalogue)) {
      expect(value, key).not.toMatch(/D\s*&\s*D|Dungeons\s*(&|and)\s*Dragons/i);
    }
  });

  // A text made only of placeholders would match anything in the rendered-view
  // check below, which would then prove nothing.
  it('has literal text in every entry, not only placeholders', () => {
    for (const [key, value] of Object.entries(catalogue))
      expect(value.replace(/\{\w+\}/g, '').trim(), key).not.toBe('');
  });

  it('fills placeholders and leaves unknown ones visible', () => {
    expect(t('dm.heading', { appName: 'Emberglass' })).toBe('Welcome to Emberglass');
    expect(t('dm.heading')).toBe('Welcome to {appName}');
    expect(t('app.name')).toBe('Emberglass');
  });
});

// Each catalogue text as a pattern: a `{name}` placeholder matches any value.
const patterns = Object.values(catalogue).map(
  (value) =>
    new RegExp(
      `^${value
        .split(/\{\w+\}/)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.+')}$`,
    ),
);

function uiTexts(container: HTMLElement): string[] {
  const texts: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    if (text) texts.push(text);
  }
  for (const element of container.querySelectorAll('*')) {
    for (const name of TEXT_ATTRIBUTES) {
      const value = element.getAttribute(name)?.trim();
      if (value) texts.push(value);
    }
  }
  return texts;
}

describe('the rendered views', () => {
  it.each<[string, ComponentType]>([
    ['the DM view', DmView],
    ['the player view', PlayerView],
    ['the DM error screen', () => createElement(DmErrorScreen, { reload: () => undefined })],
    ['the player error screen', IdleScreen],
  ])('show only catalogue text: %s', (_name, View) => {
    const { container, unmount } = render(View);
    const texts = uiTexts(container);
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts)
      expect(
        patterns.some((pattern) => pattern.test(text)),
        text,
      ).toBe(true);
    unmount();
  });
});
