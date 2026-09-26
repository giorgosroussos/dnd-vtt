// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from './ui/messages.js';
import { BOOT_RETRY_MS, BootScreen } from './ui/BootScreen.js';
import { render, type Rendered } from './ui/testing/render.js';
import { boot } from './boot.js';

// Each view's own loading and load-failure states, before and instead of its chunk (G-007, LIV-03, D-113).

let element: HTMLElement;
let rendered: Rendered | undefined;

beforeEach(() => {
  element = document.createElement('div');
  document.body.append(element);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  element.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

describe('the DM view before its code', () => {
  it('says it is loading at once, then shows the view when its code arrives', async () => {
    const chunk = deferred<() => React.ReactNode>();
    let started!: Promise<void>;
    act(() => {
      started = boot(element, '/dm', () => chunk.promise);
    });
    expect(element.querySelector('main')!.dataset.boot).toBe('loading');
    expect(element.querySelector('[role="status"]')!.textContent).toBe(t('boot.loading'));
    await act(async () => {
      chunk.resolve(() => createElement('p', { id: 'the-view' }));
      await started;
    });
    expect(element.querySelector('#the-view')).not.toBeNull();
    expect(element.querySelector('[data-boot]')).toBeNull();
  });

  it('says it could not load and offers Reload when its code cannot be fetched', async () => {
    await act(async () => {
      await boot(element, '/dm/anything', () =>
        Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
      );
    });
    expect(element.querySelector('main')!.dataset.boot).toBe('failed');
    expect(element.querySelector('[role="alert"]')!.textContent).toBe(t('boot.failed'));
    const reload = element.querySelector('button')!;
    expect(reload.textContent).toBe(t('boot.reload'));
    expect(reload.className).toContain('eg-button--primary');
  });

  it('reloads the page from its Reload button', () => {
    const reload = vi.fn();
    rendered = render(createElement(BootScreen, { view: 'dm', state: 'failed', reload }));
    act(() => rendered!.container.querySelector('button')!.click());
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe('the player view before its code', () => {
  it('keeps the idle screen’s look while loading and when its code cannot load, with no control', async () => {
    const chunk = deferred<() => React.ReactNode>();
    act(() => {
      void boot(element, '/', () => chunk.promise);
    });
    expect(element.querySelector('main')!.dataset.boot).toBe('loading');
    expect(element.textContent).toBe(t('app.name'));
    expect(element.querySelector('.eg-idle')).not.toBeNull();
    await act(async () => {
      chunk.reject(new TypeError('Failed to fetch dynamically imported module'));
      await chunk.promise.catch(() => undefined);
    });
    await flush();
    expect(element.querySelector('main')!.dataset.boot).toBe('failed');
    expect(element.textContent).toBe(t('app.name'));
    expect(element.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0);
  });

  it('asks the server again every few seconds after a failure, and reloads once it answers', async () => {
    vi.useFakeTimers();
    const answers = [
      new TypeError('offline'),
      new Response(null, { status: 503 }),
      new Response(null, { status: 200 }),
    ];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      const next = answers.shift()!;
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    });
    const reload = vi.fn();
    rendered = render(createElement(BootScreen, { view: 'player', state: 'failed', reload }));
    await act(async () => vi.advanceTimersByTimeAsync(BOOT_RETRY_MS - 1));
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenLastCalledWith('/', { method: 'HEAD', cache: 'no-store' });
    await act(async () => vi.advanceTimersByTimeAsync(BOOT_RETRY_MS));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(BOOT_RETRY_MS));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does not ask the server while it is only loading', async () => {
    vi.useFakeTimers();
    const fetch = vi.spyOn(globalThis, 'fetch');
    rendered = render(createElement(BootScreen, { view: 'player', state: 'loading', reload: vi.fn() }));
    await act(async () => vi.advanceTimersByTimeAsync(BOOT_RETRY_MS * 3));
    expect(fetch).not.toHaveBeenCalled();
  });
});
