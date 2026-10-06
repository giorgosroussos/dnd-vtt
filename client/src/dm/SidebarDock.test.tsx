// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../ui/messages.js';
import { render, type Rendered } from '../ui/testing/render.js';
import { SIDEBAR_CLOSE_MS, SIDEBAR_KEY, SidebarDock } from './SidebarDock.js';

// The scene sidebar's dock (UXR-01, specs/08-ux-journeys.md §14, Q-121): collapsed by default, opened by
// hover or by its toggle, closed on leaving, docked by the pin, which the browser remembers.

let rendered: Rendered | undefined;
beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  vi.useRealTimers();
});

const RAIL = [
  { id: 'a', name: 'Cave', thumbnail: '/a.png', live: true, selected: false },
  { id: 'b', name: 'Hall', thumbnail: undefined, live: false, selected: true },
];
const mount = () => {
  rendered = render(
    createElement(SidebarDock, {
      scenes: RAIL,
      children: (pinControl: ReactNode) =>
        createElement('div', null, pinControl, createElement('button', { type: 'button' }, t('next.heading'))),
    }),
  );
  return rendered.container;
};
const dock = (view: HTMLElement) => view.querySelector<HTMLElement>('.eg-dock')!;
const state = (view: HTMLElement) => dock(view).dataset.sidebar;
const edge = (view: HTMLElement) => view.querySelector<HTMLButtonElement>('.eg-dock__toggle');
const pin = (view: HTMLElement) =>
  view.querySelector<HTMLButtonElement>(
    `button[aria-label="${t('sidebar.pin')}"], button[aria-label="${t('sidebar.unpin')}"]`,
  )!;
const sidebar = (view: HTMLElement) => view.querySelector<HTMLElement>('.eg-workspace__sidebar')!;
const fire = (target: Element, type: string) => {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true }));
  });
};

describe('the scene sidebar', () => {
  it('starts collapsed, closed to the keyboard, its toggle naming what it does', () => {
    const view = mount();
    expect(state(view)).toBe('collapsed');
    expect(sidebar(view).hasAttribute('inert')).toBe(true);
    expect(edge(view)!.getAttribute('aria-expanded')).toBe('false');
    expect(edge(view)!.getAttribute('aria-label')).toBe(t('sidebar.show'));
    expect(edge(view)!.getAttribute('aria-controls')).toBe(sidebar(view).id);
  });

  it('draws the session’s scenes small on the collapsed rail, the shown one ringed and the live one marked', () => {
    const view = mount();
    const scenes = [...view.querySelectorAll<HTMLElement>('.eg-dock__scenes li')];
    expect(view.querySelector('.eg-dock__scenes')!.getAttribute('aria-hidden')).toBe('true');
    expect(scenes).toHaveLength(2);
    expect(scenes[0]!.dataset.live).toBe('true');
    expect(scenes[0]!.querySelector('img')!.getAttribute('src')).toBe('/a.png');
    expect(scenes[1]!.classList).toContain('eg-dock__scene--selected');
    // Pinned, the rail gives way to the sidebar in its column.
    act(() => pin(view).click());
    expect(view.querySelector('.eg-dock__rail')).toBeNull();
  });

  it('opens on hover and closes a moment after the pointer leaves', () => {
    const view = mount();
    fire(edge(view)!, 'pointerover');
    expect(state(view)).toBe('open');
    expect(sidebar(view).hasAttribute('inert')).toBe(false);
    fire(dock(view), 'pointerout');
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_CLOSE_MS - 1);
    });
    expect(state(view)).toBe('open');
    fire(dock(view), 'pointerover');
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_CLOSE_MS);
    });
    expect(state(view)).toBe('open');
    fire(dock(view), 'pointerout');
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_CLOSE_MS);
    });
    expect(state(view)).toBe('collapsed');
  });

  it('opened by a click stays open when the pointer leaves, until the toggle, Escape or a press elsewhere', () => {
    const view = mount();
    act(() => edge(view)!.click());
    expect(state(view)).toBe('open');
    expect(edge(view)!.getAttribute('aria-label')).toBe(t('sidebar.hide'));
    fire(dock(view), 'pointerout');
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_CLOSE_MS * 2);
    });
    expect(state(view)).toBe('open');
    act(() => edge(view)!.click());
    expect(state(view)).toBe('collapsed');

    act(() => edge(view)!.click());
    act(() => {
      sidebar(view).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(state(view)).toBe('collapsed');
    expect(document.activeElement).toBe(edge(view));

    act(() => edge(view)!.click());
    fire(document.body, 'pointerdown');
    expect(state(view)).toBe('collapsed');
  });

  it('stays open by hover during a drag that started in it', () => {
    const view = mount();
    fire(edge(view)!, 'pointerover');
    fire(sidebar(view), 'dragstart');
    fire(dock(view), 'pointerout');
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_CLOSE_MS);
    });
    expect(state(view)).toBe('open');
    fire(sidebar(view), 'dragend');
    fire(dock(view), 'pointerout');
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_CLOSE_MS);
    });
    expect(state(view)).toBe('collapsed');
  });

  it('the pin docks it in its column, remembered by the browser, and unpinning collapses it', () => {
    const view = mount();
    act(() => edge(view)!.click());
    act(() => pin(view).click());
    expect(state(view)).toBe('pinned');
    expect(edge(view)).toBeNull();
    expect(pin(view).getAttribute('aria-pressed')).toBe('true');
    expect(pin(view).getAttribute('aria-label')).toBe(t('sidebar.unpin'));
    expect(window.localStorage.getItem(SIDEBAR_KEY)).toBe('pinned');

    rendered!.unmount();
    const again = mount();
    expect(state(again)).toBe('pinned');
    act(() => pin(again).click());
    expect(state(again)).toBe('collapsed');
    expect(window.localStorage.getItem(SIDEBAR_KEY)).toBeNull();
    expect(document.activeElement).toBe(edge(again));
  });

  it('starts collapsed when the browser refuses its storage', () => {
    const refused = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('refused');
    });
    const view = mount();
    expect(state(view)).toBe('collapsed');
    refused.mockRestore();
  });
});
