// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from './ui/messages.js';
import { BOOT_FALLBACK_MS, BOOT_RELOADS_KEY, BOOT_RETRY_MS, BootScreen } from './ui/BootScreen.js';
import { CURSOR_IDLE_MS } from './ui/useIdleCursor.js';
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

  // The page this document was loaded from names its build by its entry script.
  const PAGE = (entry: string) => `<!doctype html><script type="module" crossorigin src="${entry}"></script>`;
  const ok = (entry = '/assets/index-a.js') => new Response(PAGE(entry), { status: 200 });

  function scriptedFetch(answers: (Response | Error)[]) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      const next = answers.shift() ?? ok();
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    });
  }

  beforeEach(() => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = '/assets/index-a.js';
    script.id = 'entry';
    document.head.append(script);
    window.sessionStorage.clear();
  });
  afterEach(() => document.getElementById('entry')?.remove());

  const tick = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));

  it('reloads once the server answers again after having been unreachable (it restarted)', async () => {
    vi.useFakeTimers();
    const fetch = scriptedFetch([new TypeError('offline'), new Response(null, { status: 503 }), ok()]);
    const reload = vi.fn();
    rendered = render(createElement(BootScreen, { view: 'player', state: 'failed', reload }));
    await tick(BOOT_RETRY_MS - 1);
    expect(fetch).not.toHaveBeenCalled();
    await tick(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenLastCalledWith('/', { cache: 'no-store' });
    await tick(BOOT_RETRY_MS);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
    await tick(BOOT_RETRY_MS);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(reload).toHaveBeenCalledOnce();
    // A reload that could help does not lengthen the next wait.
    expect(window.sessionStorage.getItem(BOOT_RELOADS_KEY)).toBeNull();
  });

  it('reloads at the first answer that names another build', async () => {
    vi.useFakeTimers();
    scriptedFetch([ok('/assets/index-b.js')]);
    const reload = vi.fn();
    rendered = render(createElement(BootScreen, { view: 'player', state: 'failed', reload }));
    await tick(BOOT_RETRY_MS);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does not loop when the same build keeps failing with the server up: it waits, doubling each time, up to five minutes', async () => {
    vi.useFakeTimers();
    const fetch = scriptedFetch([]);
    for (const [index, wait] of [...BOOT_FALLBACK_MS, 300_000].entries()) {
      const reload = vi.fn();
      rendered = render(createElement(BootScreen, { view: 'player', state: 'failed', reload }));
      await tick(wait - BOOT_RETRY_MS);
      expect(reload, `reload ${index}`).not.toHaveBeenCalled();
      await tick(BOOT_RETRY_MS);
      expect(reload, `reload ${index}`).toHaveBeenCalledOnce();
      expect(window.sessionStorage.getItem(BOOT_RELOADS_KEY)).toBe(String(index + 1));
      rendered.unmount();
      rendered = undefined;
    }
    expect(fetch.mock.calls.length).toBeGreaterThan(10);
  });

  it('starts from the shortest wait again once a view has loaded', async () => {
    window.sessionStorage.setItem(BOOT_RELOADS_KEY, '3');
    await act(async () => {
      await boot(element, '/', () => Promise.resolve(() => createElement('p')));
    });
    expect(window.sessionStorage.getItem(BOOT_RELOADS_KEY)).toBeNull();
  });

  it('stops asking once it is gone, even with an answer on its way', async () => {
    vi.useFakeTimers();
    let answer: (response: Response) => void = () => {};
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => new Promise<Response>((resolve) => (answer = resolve)));
    const reload = vi.fn();
    rendered = render(createElement(BootScreen, { view: 'player', state: 'failed', reload }));
    await tick(BOOT_RETRY_MS);
    expect(fetch).toHaveBeenCalledOnce();
    rendered.unmount();
    rendered = undefined;
    answer(ok('/assets/index-b.js'));
    await tick(BOOT_RETRY_MS * 3);
    expect(reload).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    // Gone before the first attempt: it never asks.
    rendered = render(createElement(BootScreen, { view: 'player', state: 'failed', reload }));
    rendered.unmount();
    rendered = undefined;
    await tick(BOOT_RETRY_MS * 3);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('hides the pointer after two seconds still, on its loading and failure states', async () => {
    vi.useFakeTimers();
    scriptedFetch([]);
    rendered = render(createElement(BootScreen, { view: 'player', state: 'failed', reload: vi.fn() }));
    const main = () => rendered!.container.querySelector('main')!;
    expect(main().dataset.cursor).toBe('shown');
    await tick(CURSOR_IDLE_MS);
    expect(main().dataset.cursor).toBe('hidden');
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove'));
    });
    expect(main().dataset.cursor).toBe('shown');
  });

  it('does not ask the server while it is only loading', async () => {
    vi.useFakeTimers();
    const fetch = vi.spyOn(globalThis, 'fetch');
    rendered = render(createElement(BootScreen, { view: 'player', state: 'loading', reload: vi.fn() }));
    await tick(BOOT_RETRY_MS * 3);
    expect(fetch).not.toHaveBeenCalled();
  });
});
