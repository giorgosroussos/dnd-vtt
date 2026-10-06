// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIT_CAMERA, SOCKET_CHANNELS, type Grid, type PlayerSnapshot } from '@emberglass/shared';
import { t } from '../ui/messages.js';
import { installCanvas2d, installImageLoading, installResizeObserver } from '../ui/testing/canvas2d.js';
import { settle } from '../ui/testing/fakeServer.js';
import { installFakeSockets } from '../ui/testing/fakeSocket.js';
import { render, type Rendered } from '../ui/testing/render.js';
import { CONTROLS_IDLE_MS, handheldLabelScaleFor, PlayerView } from './PlayerView.js';
import { HANDHELD_QUERY } from './useHandheld.js';

// The player view on a phone or a tablet (UXR-05, specs/08-ux-journeys.md §7, §9, §14, Q-125): a fullscreen button
// where the browser can, the screen's own pinch zoom and pan with its reset, and no size reported. A TV keeps no
// controls at all, which PlayerView.test.tsx proves.

const GRID: Grid = {
  type: 'square',
  size: 100,
  offset_x: 0,
  offset_y: 0,
  visible: true,
  feet_per_square: 5,
  columns: 40,
  rows: 30,
};
const MAP = { id: 'c'.repeat(64), width: 4000, height: 3000, variants: { display: { width: 2000, height: 1500 } } };
const snapshot = (name = 'Crypt'): PlayerSnapshot => ({
  role: 'players',
  scene: { name, map: MAP, grid: GRID, tokens: [], camera: FIT_CAMERA, ruler: null, fog: [], encounter: null },
});

let fake: ReturnType<typeof installFakeSockets>;
let rendered: Rendered | undefined;
let requested: HTMLElement[];

function handheld(fullscreen = true) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === HANDHELD_QUERY,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  Object.defineProperty(document, 'fullscreenEnabled', { value: fullscreen, configurable: true });
  requested = [];
  HTMLElement.prototype.requestFullscreen = function (this: HTMLElement) {
    requested.push(this);
    return Promise.resolve();
  };
}

beforeEach(() => {
  installCanvas2d();
  installResizeObserver({ width: 800, height: 400 });
  installImageLoading();
  fake = installFakeSockets();
});

afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  fake.restore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mount(first: PlayerSnapshot = snapshot()) {
  rendered = render(PlayerView);
  act(() => fake.sockets[0]!.open(first));
  await settle();
  return rendered.container;
}
const view = (container: HTMLElement) => container.querySelector<HTMLElement>('.eg-canvas--player')!;
const scale = (container: HTMLElement) => Number(view(container).dataset.cameraScale);
const button = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
let pointer = 0;
function touch(target: HTMLElement, type: string, id: number, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.assign(event, { pointerId: id, pointerType: 'touch' });
  act(() => {
    target.dispatchEvent(event);
  });
}
function pinchOut(target: HTMLElement) {
  const a = ++pointer;
  const b = ++pointer;
  touch(target, 'pointerdown', a, 300, 200);
  touch(target, 'pointerdown', b, 500, 200);
  touch(target, 'pointermove', b, 700, 200);
  touch(target, 'pointerup', a, 300, 200);
  touch(target, 'pointerup', b, 700, 200);
}

describe('the player view on a handheld (UXR-05)', () => {
  it('offers full screen, puts the whole view in it, and reports no size', async () => {
    handheld();
    const container = await mount();
    expect(container.querySelector('main')!.dataset.handheld).toBe('true');
    const full = button(container, t('player.fullscreen'))!;
    expect(full).not.toBeNull();
    act(() => full.click());
    expect(requested).toEqual([container.querySelector('main')]);
    expect(fake.sockets[0]!.emitted.filter(({ event }) => event === SOCKET_CHANNELS.viewport)).toEqual([]);
    expect(view(container).classList).toContain('eg-canvas--touch');
  });

  it('has no fullscreen button where the browser cannot (an iPhone)', async () => {
    handheld(false);
    const container = await mount();
    expect(button(container, t('player.fullscreen'))).toBeNull();
  });

  it('zooms by a pinch on that screen only, and returns to the table view by its button and by a double tap', async () => {
    handheld();
    const container = await mount();
    const fitted = scale(container);
    expect(button(container, t('player.reset'))).toBeNull();
    pinchOut(view(container));
    // The fingers moved from 200 to 400 px apart: twice the DM camera.
    expect(scale(container)).toBeCloseTo(fitted * 2, 6);
    expect(fake.sockets[0]!.emitted.filter(({ event }) => event === SOCKET_CHANNELS.command)).toEqual([]);
    act(() => button(container, t('player.reset'))!.click());
    expect(scale(container)).toBeCloseTo(fitted, 9);
    expect(button(container, t('player.reset'))).toBeNull();

    pinchOut(view(container));
    const id = ++pointer;
    touch(view(container), 'pointerdown', id, 400, 200);
    touch(view(container), 'pointerup', id, 400, 200);
    touch(view(container), 'pointerdown', id, 402, 201);
    expect(scale(container)).toBeCloseTo(fitted, 9);
  });

  it('pans by a drag, and starts at the DM camera again when another scene goes live', async () => {
    handheld();
    const container = await mount();
    pinchOut(view(container));
    const x = Number(view(container).dataset.cameraX);
    const id = ++pointer;
    touch(view(container), 'pointerdown', id, 400, 200);
    touch(view(container), 'pointermove', id, 350, 200);
    expect(Number(view(container).dataset.cameraX)).toBeCloseTo(x - 50, 6);
    touch(view(container), 'pointerup', id, 350, 200);
    act(() => fake.sockets[0]!.deliver({ type: 'scene.snapshot', version: 2, payload: { ...snapshot('Bridge') } }));
    await settle();
    expect(button(container, t('player.reset'))).toBeNull();
  });

  it('fades its buttons a few seconds after the last touch, and a touch brings them back', async () => {
    handheld();
    const container = await mount();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const controls = () => container.querySelector('.eg-player__controls')!;
    // A touch starts the wait afresh, under the test's clock.
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerdown'));
    });
    act(() => {
      vi.advanceTimersByTime(CONTROLS_IDLE_MS - 1);
    });
    expect(controls().classList).not.toContain('eg-player__controls--faded');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(controls().classList).toContain('eg-player__controls--faded');
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerdown'));
    });
    expect(controls().classList).not.toContain('eg-player__controls--faded');
  });

  it('sizes labels by the shorter side, never below the DM view’s', () => {
    expect(handheldLabelScaleFor(390, 844)).toBe(1);
    expect(handheldLabelScaleFor(1024, 768)).toBeCloseTo((2.55 * 768) / 1080, 9);
  });
});
