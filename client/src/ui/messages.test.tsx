// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import { DmView } from '../dm/DmView.js';
import { ScenePanel } from '../dm/ScenePanel.js';
import { PlayerView } from '../player/PlayerView.js';
import { BootScreen } from './BootScreen.js';
import { DmErrorScreen } from './ErrorScreen.js';
import { IdleScreen } from './IdleScreen.js';
import { catalogue, t } from './messages.js';
import { button, click, FakeServer, installDialog, settle } from './testing/fakeServer.js';
import { installCanvas2d, installImageLoading, installResizeObserver } from './testing/canvas2d.js';
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
    expect(t('signIn.lockedOut', { seconds: 30 })).toBe(
      'Too many wrong PINs from this device. Try again in 30 seconds.',
    );
    expect(t('signIn.lockedOut')).toBe('Too many wrong PINs from this device. Try again in {seconds} seconds.');
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
    ['the DM view while it loads', DmView],
    ['the player view', PlayerView],
    ['the DM error screen', () => createElement(DmErrorScreen, { reload: () => undefined })],
    ['the player error screen', IdleScreen],
    ['the DM view before its code arrives', () => createElement(BootScreen, { view: 'dm', state: 'loading' })],
    ['the DM view when its code cannot load', () => createElement(BootScreen, { view: 'dm', state: 'failed' })],
    ['the player view before its code arrives', () => createElement(BootScreen, { view: 'player', state: 'loading' })],
    [
      'the player view when its code cannot load',
      () => createElement(BootScreen, { view: 'player', state: 'failed', reload: () => undefined }),
    ],
  ])('show only catalogue text: %s', (_name, View) => {
    const { container, unmount } = render(View);
    expectCatalogueOnly(container);
    unmount();
  });

  // Each screen the DM view can show once the server has answered (PRP-01, D-085).
  it.each<[string, (server: FakeServer) => void]>([
    ['setup on the server PC', (server) => Object.assign(server, { pinSet: false, signedIn: false })],
    ['setup elsewhere', (server) => Object.assign(server, { pinSet: false, local: false, signedIn: false })],
    ['PIN entry', (server) => Object.assign(server, { signedIn: false })],
    ['the empty workspace', () => undefined],
    [
      'the workspace with a live scene and an asset whose texts are catalogue texts',
      (server) => {
        const session = server.addSession(server.addCampaign(t('app.name')).id, t('app.name'));
        server.liveSceneId = server.addScene(session.id, t('app.name')).id;
        server.addAsset({ name: t('app.name'), tags: [] });
      },
    ],
  ])('show only catalogue text: the DM view, %s', async (_name, arrange) => {
    const server = new FakeServer();
    arrange(server);
    server.install();
    try {
      const { container, unmount } = render(DmView);
      await settle();
      expectCatalogueOnly(container);
      unmount();
    } finally {
      server.uninstall();
    }
  });
});

// The dialogs of the workspace, opened as the DM opens them.
it('show only catalogue text: the new-asset dialog, and a refused asset deletion with its scenes', async () => {
  installDialog();
  const server = new FakeServer();
  const asset = server.addAsset({ name: t('app.name') });
  server.usages[asset.id] = [
    {
      scene_id: '00000000-0000-4000-8000-0000000000a1',
      scene_name: t('app.name'),
      session_id: '00000000-0000-4000-8000-0000000000a2',
      session_title: t('app.name'),
      campaign_id: '00000000-0000-4000-8000-0000000000a3',
      campaign_name: t('app.name'),
      tokens: 2,
    },
  ];
  server.install();
  try {
    const { container, unmount } = render(DmView);
    await settle();
    await click(button(container, t('library.new')));
    expectCatalogueOnly(container.querySelector('dialog')!);
    await click(button(container.querySelector('dialog')!, t('assetForm.cancel')));
    await click(button(container, t('library.deleteOf', { name: t('app.name') })));
    await click(button(container.querySelector('dialog')!, t('assetDelete.confirm')));
    expect(container.querySelector('dialog')!.textContent).toContain(t('assetDelete.close'));
    expectCatalogueOnly(container.querySelector('dialog')!);
    unmount();
  } finally {
    server.uninstall();
  }
});

// The Connect a screen panel (LIV-03), with addresses that are catalogue texts, then with none.
it('show only catalogue text: the Connect a screen panel, with addresses and without', async () => {
  installDialog();
  const server = new FakeServer();
  server.connect = {
    addresses: [
      { address: t('app.name'), url: t('app.name'), private: true },
      { address: t('dm.role'), url: t('dm.role'), private: false },
    ],
    qr: server.connect.qr,
  };
  server.install();
  try {
    const { container, unmount } = render(DmView);
    await settle();
    await click(button(container, t('connect.open')));
    await settle();
    expect(container.querySelector('dialog svg')).not.toBeNull();
    expectCatalogueOnly(container.querySelector('dialog')!);
    await click(button(container.querySelector('dialog')!, t('connect.close')));
    server.connect = { addresses: [], qr: null };
    await click(button(container, t('connect.open')));
    await settle();
    expectCatalogueOnly(container.querySelector('dialog')!);
    unmount();
  } finally {
    server.uninstall();
  }
});

// The selected scene with its setup, its canvas and an upload in progress (PRP-02).
it('show only catalogue text: a selected scene with its map controls, its canvas and an upload in progress', async () => {
  installCanvas2d();
  installResizeObserver({ width: 800, height: 600 });
  installImageLoading();
  const server = new FakeServer();
  const session = server.addSession(server.addCampaign(t('app.name')).id, t('app.name'));
  const scene = server.addScene(session.id, t('app.name'));
  server.uploadProgress = [0.5];
  server.before = (call) => (call.path === '/api/images' ? new Promise(() => undefined) : undefined);
  server.install();
  try {
    const { container, unmount } = render(
      createElement(ScenePanel, { sceneId: scene.id, name: scene.name, uploadLimit: 1 }),
    );
    await settle();
    expectCatalogueOnly(container);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['xx'], 'map.png')] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(container.querySelector('.eg-field__error')).not.toBeNull();
    expectCatalogueOnly(container);
    unmount();
    const big = render(createElement(ScenePanel, { sceneId: scene.id, name: scene.name, uploadLimit: 1024 }));
    await settle();
    const bigInput = big.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(bigInput, 'files', { configurable: true, value: [new File(['xx'], 'map.png')] });
    bigInput.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    big.container.querySelector('form')!.requestSubmit();
    await settle();
    expect(big.container.querySelector('progress')).not.toBeNull();
    expectCatalogueOnly(big.container);
    big.unmount();
  } finally {
    server.uninstall();
  }
});

function expectCatalogueOnly(container: HTMLElement): void {
  const texts = uiTexts(container);
  expect(texts.length).toBeGreaterThan(0);
  for (const text of texts)
    expect(
      patterns.some((pattern) => pattern.test(text)),
      text,
    ).toBe(true);
}
