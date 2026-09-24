// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DmView } from '../dm/DmView.js';
import { PlayerView } from '../player/PlayerView.js';
import { loadGuardedView } from '../views.js';
import { Button } from './Button.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { DmErrorScreen } from './ErrorScreen.js';
import { IdleScreen } from './IdleScreen.js';
import { Notice } from './Notice.js';
import { SkipLink } from './SkipLink.js';
import { TextField } from './TextField.js';
import { t } from './messages.js';
import { FOCUSABLE, render, type Rendered } from './testing/render.js';

// Base components, focus and error patterns (FND-04, D-069). Test inputs are
// catalogue texts, so the rendered result stays inside the catalogue too.
let rendered: Rendered | undefined;
afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  vi.restoreAllMocks();
});

describe('Button', () => {
  it('is a native button that does not submit unless asked', () => {
    rendered = render(createElement(Button, { children: t('error.reload') }));
    const button = rendered.container.querySelector('button')!;
    expect(button.type).toBe('button');
    expect(button.className).toContain('eg-button--secondary');
  });
});

describe('TextField', () => {
  it('labels its input', () => {
    rendered = render(createElement(TextField, { label: t('app.name') }));
    const input = rendered.container.querySelector('input')!;
    const label = rendered.container.querySelector('label')!;
    expect(label.htmlFor).toBe(input.id);
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();
  });

  it('ties a refusal to its input so that it is announced with it', () => {
    rendered = render(createElement(TextField, { label: t('app.name'), error: t('error.heading') }));
    const input = rendered.container.querySelector('input')!;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const error = document.getElementById(input.getAttribute('aria-describedby')!);
    expect(error?.textContent).toBe(t('error.heading'));
  });
});

describe('Notice', () => {
  it('is announced when it appears', () => {
    rendered = render(createElement(Notice, { children: t('error.body') }));
    expect(rendered.container.querySelector('[role="alert"]')?.textContent).toBe(t('error.body'));
  });
});

describe('SkipLink', () => {
  it('moves keyboard focus to its target', () => {
    rendered = render(
      createElement('div', {
        children: [
          createElement(SkipLink, { key: 'link', targetId: 'target', label: t('dm.skipToMain') }),
          createElement('main', { key: 'main', id: 'target', tabIndex: -1 }),
        ],
      }),
    );
    const link = rendered.container.querySelector('a')!;
    act(() => link.click());
    expect(document.activeElement?.id).toBe('target');
  });
});

describe('ErrorBoundary', () => {
  function Broken(): never {
    throw new Error('secret internal detail /home/dm/campaigns.db');
  }

  it('replaces a failing view with its fallback and never shows the error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    rendered = render(
      createElement(ErrorBoundary, {
        fallback: createElement(DmErrorScreen, { reload: () => undefined }),
        children: createElement(Broken),
      }),
    );
    const text = rendered.container.textContent ?? '';
    expect(text).toContain(t('error.heading'));
    expect(text).not.toContain('secret');
    expect(text).not.toContain('campaigns.db');
  });

  it('shows the view itself while nothing fails', () => {
    rendered = render(
      createElement(ErrorBoundary, { fallback: createElement(IdleScreen), children: createElement(DmView) }),
    );
    expect(rendered.container.querySelector('[data-view="dm"]')).not.toBeNull();
  });
});

describe('DmErrorScreen', () => {
  it('offers one way out: its Reload button reloads the view', () => {
    const reload = vi.fn();
    rendered = render(createElement(DmErrorScreen, { reload }));
    const button = rendered.container.querySelector('button')!;
    expect(button.textContent).toBe(t('error.reload'));
    act(() => button.click());
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe('the view shells', () => {
  it('the DM shell starts the Tab order with the skip link to its main landmark', () => {
    rendered = render(DmView);
    const focusable = [...rendered.container.querySelectorAll(FOCUSABLE)];
    expect(focusable[0]?.textContent).toBe(t('dm.skipToMain'));
    const main = rendered.container.querySelector('main')!;
    expect(main.id).toBe('main');
    expect(main.tabIndex).toBe(-1);
  });

  // The TV has no controls (specs/08-ux-journeys.md §9, D-031): nothing on the
  // player view, working or failed, can be reached or operated.
  it.each([
    ['the player view', PlayerView],
    ['its fallback', IdleScreen],
  ])('%s has no control and shows the product name only', (_name, View) => {
    rendered = render(View);
    expect(rendered.container.querySelectorAll(FOCUSABLE)).toHaveLength(0);
    expect(rendered.container.textContent).toBe(t('app.name'));
  });

  it('each path loads its own view inside an error boundary', async () => {
    const Player = await loadGuardedView('/');
    const Dm = await loadGuardedView('/dm');
    rendered = render(Player);
    expect(rendered.container.querySelector('[data-view="player"]')).not.toBeNull();
    rendered.unmount();
    rendered = render(Dm);
    expect(rendered.container.querySelector('[data-view="dm"]')).not.toBeNull();
  });
});
