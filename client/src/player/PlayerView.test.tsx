// @vitest-environment jsdom
import { act } from 'react';
import Konva from 'konva';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIT_CAMERA,
  imageFileUrl,
  SOCKET_CHANNELS,
  type DmSnapshot,
  type EventEnvelope,
  type Grid,
  type PlayerSnapshot,
  type PlayerToken,
} from '@emberglass/shared';
import { t } from '../ui/messages.js';
import { fitCamera } from '../canvas/geometry.js';
import { GLIDE_MS } from '../canvas/MapCanvas.js';
import { images, installCanvas2d, installImageLoading, installResizeObserver } from '../ui/testing/canvas2d.js';
import { settle } from '../ui/testing/fakeServer.js';
import { installFakeSockets } from '../ui/testing/fakeSocket.js';
import { FOCUSABLE, render, type Rendered } from '../ui/testing/render.js';
import { CURSOR_IDLE_MS, labelScaleFor, PlayerView } from './PlayerView.js';
import { VIEWPORT_SETTLE_MS } from './usePlayerLive.js';

// The player view (LIV-01, LIV-03; specs/08-ux-journeys.md §4, §9, specs/04-live-sync.md §4, §5,
// §6, §9, Q-025, Q-032, Q-038, Q-054, D-090, D-105, D-109), with a scripted socket and the real
// react-konva tree of the map canvas in its player mode.

const VIEWPORT = { width: 1280, height: 720 };
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
const IMAGE = 'd'.repeat(64);
// What the idle screen says (specs/08-ux-journeys.md §4, Q-100): the product name and the waiting line.
const IDLE_TEXT = t('app.name') + t('idle.line');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const token = (n: number, label: string, z_order: number, x = n): PlayerToken => ({
  id: id(n),
  x,
  y: 1,
  size: 'medium',
  image_id: IMAGE,
  z_order,
  label,
  category: 'monster',
  markers: [],
});

const snapshot = (tokens: PlayerToken[], grid: Grid = GRID): PlayerSnapshot => ({
  role: 'players',
  scene: { name: 'Crypt', map: MAP, grid, tokens, camera: FIT_CAMERA, ruler: null, fog: [], encounter: null },
});

let fake: ReturnType<typeof installFakeSockets>;
let rendered: Rendered;

beforeEach(() => {
  installCanvas2d();
  installResizeObserver(VIEWPORT);
  installImageLoading();
  fake = installFakeSockets();
  rendered = render(PlayerView);
});

afterEach(() => {
  rendered.unmount();
  fake.restore();
  vi.useRealTimers();
});

const main = () => rendered.container.querySelector<HTMLElement>('main[data-view="player"]')!;
const stage = () => Konva.stages.at(-1)!;
const drawnLabels = () =>
  stage()
    .find<Konva.Group>('.token')
    .map((group) => group.findOne<Konva.Text>('Text')?.text());
const drawnBoxes = () =>
  JSON.parse(main().querySelector<HTMLElement>('.eg-canvas--player')!.dataset.tokens!) as {
    id: string;
    label: string;
  }[];

async function open(first: PlayerSnapshot) {
  act(() => fake.sockets[0]!.open(first));
  await settle();
}

async function deliver(type: EventEnvelope['type'], version: number, payload: object) {
  act(() => fake.sockets[0]!.deliver({ type, version, payload: payload as Record<string, unknown> }));
  await settle();
}

describe('player view connection', () => {
  it('connects on opening and counts the snapshot every connection brings', async () => {
    expect(fake.sockets).toHaveLength(1);
    expect(fake.sockets[0]!.view).toBe('player');
    expect(main().getAttribute('data-live')).toBe('connecting');
    await open({ role: 'players', scene: null });
    expect(main().getAttribute('data-live')).toBe('connected');
    expect(main().getAttribute('data-snapshots')).toBe('1');
  });

  it('reconnects and resynchronises from a fresh snapshot, saying nothing meanwhile', async () => {
    const socket = fake.sockets[0]!;
    await open({ role: 'players', scene: null });
    act(() => socket.drop('transport close'));
    expect(main().getAttribute('data-live')).toBe('reconnecting');
    // Nobody operates the TV: no message, no control, the idle screen only (Q-025, Q-100).
    expect(main().textContent).toBe(IDLE_TEXT);
    expect(rendered.container.querySelectorAll(FOCUSABLE)).toHaveLength(0);
    act(() => socket.open(snapshot([token(1, 'Goblin', 0)])));
    await settle();
    expect(main().getAttribute('data-live')).toBe('connected');
    expect(main().getAttribute('data-snapshots')).toBe('2');
    expect(main().dataset.scene).toBe('live');
  });

  it('keeps its picture while the connection is lost', async () => {
    await open(snapshot([token(1, 'Goblin', 0)]));
    act(() => fake.sockets[0]!.drop('transport close'));
    await settle();
    expect(main().dataset.scene).toBe('live');
    expect(drawnLabels()).toEqual(['Goblin']);
  });

  it('closes its connection when it goes away', async () => {
    await open({ role: 'players', scene: null });
    rendered.unmount();
    expect(fake.sockets[0]!.connected).toBe(false);
    rendered = render(PlayerView);
  });
});

describe('what the player view draws (specs/08-ux-journeys.md §4)', () => {
  it('shows the dark idle screen with the product name and the waiting line only while nothing is live', async () => {
    await open({ role: 'players', scene: null });
    expect(main().dataset.scene).toBe('idle');
    expect(main().querySelector('.eg-idle')).not.toBeNull();
    expect(main().textContent).toBe(IDLE_TEXT);
    expect(main().querySelector('canvas')).toBeNull();
  });

  it('draws the live scene through the canvas in its player mode, fitted to the map, with the visible tokens and their labels', async () => {
    await open(snapshot([token(1, 'Goblin 1', 0), token(2, 'Goblin 2', 1)]));
    expect(main().dataset.scene).toBe('live');
    expect(main().querySelector('.eg-idle')).toBeNull();
    const canvas = main().querySelector<HTMLElement>('.eg-canvas--player')!;
    expect(canvas).not.toBeNull();
    // Fitted to the display version (specs/04-live-sync.md §9, Q-038).
    const fitted = fitCamera(MAP.variants.display, VIEWPORT);
    expect([stage().x(), stage().y(), stage().scaleX()]).toEqual([fitted.x, fitted.y, fitted.scale]);
    expect(Number(canvas.dataset.cameraScale)).toBe(fitted.scale);
    // Only display versions are requested: the map's and the tokens' images (specs/07-security-and-access.md §5).
    expect(images.requested).toContain(imageFileUrl(MAP.id, 'display'));
    expect(images.requested).toContain(imageFileUrl(IMAGE, 'display'));
    expect(images.requested.every((url) => url.endsWith('/display'))).toBe(true);
    expect(drawnLabels()).toEqual(['Goblin 1', 'Goblin 2']);
    expect(drawnBoxes().map((box) => box.label)).toEqual(['Goblin 1', 'Goblin 2']);
    expect(drawnBoxes().every((box) => !('hidden' in box))).toBe(true);
  });

  it('keeps the drawing in step with each players’ event, a reveal between visible tokens and a relabel included', async () => {
    await open(snapshot([token(1, 'Goblin', 0), token(3, 'Hero', 1)]));
    // A reveal between the two: inserted at rank 1 (D-109).
    await deliver('token.added', 2, { token: token(2, 'Assassin', 1), relabelled: [] });
    expect(drawnLabels()).toEqual(['Goblin', 'Assassin', 'Hero']);
    // A second goblin added live on top relabels the first (G-023).
    await deliver('token.added', 3, { token: token(4, 'Goblin 2', 3), relabelled: [token(1, 'Goblin 1', 0)] });
    expect(drawnLabels()).toEqual(['Goblin 1', 'Assassin', 'Hero', 'Goblin 2']);
    // A move replaces the token where it is drawn.
    await deliver('token.updated', 4, { token: token(3, 'Hero', 2, 9) });
    expect(
      stage()
        .findOne<Konva.Group>(`#token-${id(3)}`)!
        .x(),
    ).toBe(9 * 50);
    // A hide or deletion removes it.
    await deliver('token.removed', 5, { id: id(2) });
    expect(drawnLabels()).toEqual(['Goblin 1', 'Hero', 'Goblin 2']);
    // A fresh snapshot of the same moment draws the same.
    const kept = drawnBoxes();
    await open(snapshot([token(1, 'Goblin 1', 0), token(3, 'Hero', 1, 9), token(4, 'Goblin 2', 2)]));
    expect(drawnBoxes()).toEqual(kept);
  });

  it('returns to the idle screen on scene.cleared', async () => {
    await open(snapshot([token(1, 'Goblin', 0)]));
    await deliver('scene.cleared', 2, {});
    expect(main().dataset.scene).toBe('idle');
    expect(main().textContent).toBe(IDLE_TEXT);
    expect(main().querySelector('canvas')).toBeNull();
  });

  it('draws the grid only when the scene shows it to players (specs/04-live-sync.md §4)', async () => {
    await open(snapshot([], { ...GRID, visible: false }));
    expect(main().querySelector<HTMLElement>('.eg-canvas--player')!.dataset.grid).toBe('none');
    expect(stage().findOne('.grid')).toBeUndefined();
    await open(snapshot([], GRID));
    expect(main().querySelector<HTMLElement>('.eg-canvas--player')!.dataset.grid).toBe('shown');
    expect(stage().find('.grid-line').length).toBeGreaterThan(0);
  });

  it('never draws a DM snapshot, even if one reached it (D-105)', async () => {
    await open({ role: 'players', scene: null });
    const dm: DmSnapshot = {
      role: 'dm',
      scene: {
        scene: {} as never,
        map: null,
        tokens: [],
        camera: FIT_CAMERA,
        screen: null,
        history: { can_undo: false, can_redo: false },
        ruler: null,
        fog: [],
        encounter: null,
      },
    };
    act(() => fake.sockets[0]!.deliver({ type: 'scene.snapshot', version: 2, payload: dm }));
    await settle();
    expect(main().dataset.scene).toBe('idle');
    expect(main().getAttribute('data-snapshots')).toBe('1');
  });
});

describe('no controls, and the pointer hidden when still (specs/08-ux-journeys.md §9, Q-054)', () => {
  it('renders nothing that takes focus or listens, on the idle screen and on a live scene', async () => {
    await open({ role: 'players', scene: null });
    expect(rendered.container.querySelectorAll(FOCUSABLE)).toHaveLength(0);
    expect(rendered.container.querySelectorAll('button, [role="application"]')).toHaveLength(0);
    await open(snapshot([token(1, 'Goblin', 0)]));
    expect(rendered.container.querySelectorAll(FOCUSABLE)).toHaveLength(0);
    expect(rendered.container.querySelectorAll('button, [role="application"]')).toHaveLength(0);
    expect(stage().listening()).toBe(false);
  });

  it('hides the pointer after two seconds without movement, and shows it again when it moves', () => {
    rendered.unmount();
    vi.useFakeTimers();
    rendered = render(PlayerView);
    expect(main().dataset.cursor).toBe('shown');
    act(() => {
      vi.advanceTimersByTime(CURSOR_IDLE_MS - 1);
    });
    expect(main().dataset.cursor).toBe('shown');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(main().dataset.cursor).toBe('hidden');
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove'));
    });
    expect(main().dataset.cursor).toBe('shown');
    act(() => {
      vi.advanceTimersByTime(CURSOR_IDLE_MS - 500);
    });
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove'));
    });
    act(() => {
      vi.advanceTimersByTime(CURSOR_IDLE_MS - 1);
    });
    expect(main().dataset.cursor).toBe('shown');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(main().dataset.cursor).toBe('hidden');
    expect(CURSOR_IDLE_MS).toBe(2_000);
  });

  it('leaves no timer or listener behind once it is gone', () => {
    rendered.unmount();
    vi.useFakeTimers();
    rendered = render(PlayerView);
    rendered.unmount();
    expect(vi.getTimerCount()).toBe(0);
    window.dispatchEvent(new PointerEvent('pointermove'));
    expect(vi.getTimerCount()).toBe(0);
    rendered = render(PlayerView);
  });

  it('shows the pointer again on a pointer movement too', () => {
    rendered.unmount();
    vi.useFakeTimers();
    rendered = render(PlayerView);
    act(() => {
      vi.advanceTimersByTime(CURSOR_IDLE_MS);
    });
    expect(main().dataset.cursor).toBe('hidden');
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove'));
    });
    expect(main().dataset.cursor).toBe('shown');
  });
});

describe('ordering and replacement', () => {
  it('draws nothing from an event that arrives before the first snapshot', async () => {
    act(() => {
      fake.sockets[0]!.open();
      fake.sockets[0]!.deliver({
        type: 'token.added',
        version: 1,
        payload: { token: token(1, 'Early', 0), relabelled: [] },
      });
    });
    await settle();
    expect(main().dataset.scene).toBe('idle');
    await open(snapshot([]));
    expect(drawnBoxes()).toEqual([]);
  });

  it('replaces the drawing when a snapshot of another scene arrives: its map only, its tokens only, fitted again', async () => {
    await open(snapshot([token(1, 'Goblin', 0)]));
    const other = {
      id: 'e'.repeat(64),
      width: 1000,
      height: 1000,
      variants: { display: { width: 1000, height: 1000 } },
    };
    images.requested = [];
    act(() =>
      fake.sockets[0]!.open(
        {
          role: 'players',
          scene: {
            name: 'Lair',
            map: other,
            grid: GRID,
            tokens: [token(7, 'Dragon', 0)],
            camera: FIT_CAMERA,
            ruler: null,
            fog: [],
            encounter: null,
          },
        },
        5,
      ),
    );
    await settle();
    expect(images.requested).toContain(imageFileUrl(other.id, 'display'));
    expect(images.requested).not.toContain(imageFileUrl(MAP.id, 'display'));
    expect(drawnBoxes().map((box) => box.label)).toEqual(['Dragon']);
    const fitted = fitCamera(other.variants.display, VIEWPORT);
    expect([stage().x(), stage().y(), stage().scaleX()]).toEqual([fitted.x, fitted.y, fitted.scale]);
  });
});

describe('the player camera (LIV-06; specs/04-live-sync.md §5, §9, Q-038, D-119)', () => {
  const canvas = () => main().querySelector<HTMLElement>('.eg-canvas--player')!;
  const drawnCamera = () => {
    const { cameraX, cameraY, cameraScale } = canvas().dataset;
    return { x: Number(cameraX), y: Number(cameraY), scale: Number(cameraScale) };
  };
  const steered = { centre_x: 0.25, centre_y: 0.5, width: 0.5, height: 0.5 };
  const reports = () =>
    fake.sockets[0]!.emitted.filter(({ event }) => event === SOCKET_CHANNELS.viewport).map(({ args }) => args[0]);

  it('draws the camera its snapshot carries, then each camera.player, and fits again on the next activation', async () => {
    await open({ role: 'players', scene: { ...snapshot([token(1, 'Goblin', 0)]).scene!, camera: steered } });
    // 1000 × 750 world pixels in 1280 × 720: scaled to fit the height, centred on (500, 750).
    expect(drawnCamera().scale).toBeCloseTo(720 / 750, 9);
    expect(drawnCamera().x).toBeCloseTo(640 - 500 * (720 / 750), 6);
    const from = drawnCamera();
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const frames = (ms: number) =>
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    try {
      await deliver('camera.player', 2, { camera: { centre_x: 0.5, centre_y: 0.5, width: 0.25, height: 0.25 } });
      // It glides there in GLIDE_MS (DMT-03), so a TV following the DM's view does not step.
      expect(drawnCamera()).toEqual(from);
      frames(GLIDE_MS / 2);
      expect(drawnCamera().scale).toBeGreaterThan(from.scale);
      expect(drawnCamera().scale).toBeLessThan(720 / 375);
      frames(GLIDE_MS);
      expect(drawnCamera().scale).toBeCloseTo(720 / 375, 9);
      expect(drawnCamera().x).toBeCloseTo(640 - 1000 * (720 / 375), 6);
      // An activation's snapshot is fitted to the map (Q-038).
      await deliver('scene.snapshot', 3, snapshot([]));
      frames(GLIDE_MS * 2);
      expect(drawnCamera()).toEqual(fitCamera(MAP.variants.display, VIEWPORT));
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes a new camera at once when the viewer asks for reduced motion (DMT-03)', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: query.includes('reduce'), media: query }),
    });
    try {
      await open({ role: 'players', scene: { ...snapshot([token(1, 'Goblin', 0)]).scene!, camera: steered } });
      await deliver('camera.player', 2, { camera: { centre_x: 0.5, centre_y: 0.5, width: 0.25, height: 0.25 } });
      expect(drawnCamera().scale).toBeCloseTo(720 / 375, 9);
    } finally {
      if (original) Object.defineProperty(window, 'matchMedia', original);
      else Reflect.deleteProperty(window, 'matchMedia');
    }
  });

  it('reports its window’s size once connected, and again once a resize has settled', async () => {
    await open({ role: 'players', scene: null });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    expect(reports()).toEqual([{ width: window.innerWidth, height: window.innerHeight }]);
    const [width, height] = [window.innerWidth, window.innerHeight];
    act(() => {
      Object.assign(window, { innerWidth: 1920, innerHeight: 1080 });
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('resize'));
    });
    expect(reports()).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(VIEWPORT_SETTLE_MS);
    });
    expect(reports()).toEqual([
      { width, height },
      { width: 1920, height: 1080 },
    ]);
    Object.assign(window, { innerWidth: width, innerHeight: height });
    // Nothing the TV shows came from its own report: it has no controls and draws what it is sent.
    expect(rendered.container.querySelectorAll(FOCUSABLE)).toHaveLength(0);
  });
});

describe('the ruler on the TV (LIV-07, specs/04-live-sync.md §11, Q-027)', () => {
  const measurement = { from: { column: 1, row: 2 }, to: { column: 4, row: 2 }, feet: 15 };
  const drawnRuler = () =>
    JSON.parse(rendered.container.querySelector<HTMLElement>('[data-ruler]')?.dataset.ruler ?? 'null') as {
      from: unknown;
      to: unknown;
      feet: number;
    } | null;
  const distanceText = () =>
    Konva.stages.at(-1)!.findOne<Konva.Label>('.ruler-distance')?.findOne<Konva.Text>('Text')!.text();

  it('draws the measurement its snapshot carries, then each ruler.shown, and clears it on ruler.cleared', async () => {
    await open({ role: 'players', scene: { ...snapshot([]).scene!, ruler: measurement } });
    expect(drawnRuler()).toMatchObject(measurement);
    expect(distanceText()).toBe(t('canvas.rulerDistance', { feet: '15' }));
    const moved = { ...measurement, to: { column: 4, row: 6 }, feet: 20 };
    await deliver('ruler.shown', 2, { ruler: moved });
    expect(drawnRuler()).toMatchObject(moved);
    expect(distanceText()).toBe(t('canvas.rulerDistance', { feet: '20' }));
    await deliver('ruler.cleared', 3, {});
    expect(drawnRuler()).toBeNull();
    expect(distanceText()).toBeUndefined();
    // A malformed event changes nothing, and the TV still has no control.
    await deliver('ruler.shown', 4, { ruler: { feet: 5 } });
    expect(drawnRuler()).toBeNull();
    expect(rendered.container.querySelectorAll(FOCUSABLE)).toHaveLength(0);
  });

  it('draws none after an activation whose snapshot carries none', async () => {
    await open({ role: 'players', scene: { ...snapshot([]).scene!, ruler: measurement } });
    await deliver('scene.snapshot', 2, snapshot([]));
    expect(drawnRuler()).toBeNull();
  });
});

describe('the redesign on the TV (UIX-01, specs/08-ux-journeys.md §11)', () => {
  it('shows the live scene’s name at the bottom left over a vignette, and nothing of them while idle', async () => {
    await open(snapshot([token(1, 'Goblin', 0)]));
    expect(main().querySelector('.eg-player__plate')!.textContent).toBe('Crypt');
    expect(main().querySelector('.eg-player__vignette')).not.toBeNull();
    await deliver('scene.cleared', 2, {});
    expect(main().querySelector('.eg-player__plate')).toBeNull();
    expect(main().querySelector('.eg-player__vignette')).toBeNull();
  });

  it('fades in anew for another scene, and not for an event on the same one', async () => {
    await open(snapshot([token(1, 'Goblin', 0)]));
    const first = main().querySelector('.eg-player__fade');
    await deliver('token.removed', 2, { id: id(1) });
    expect(main().querySelector('.eg-player__fade')).toBe(first);
    act(() => fake.sockets[0]!.open({ role: 'players', scene: { ...snapshot([]).scene!, name: 'Bridge' } }, 3));
    await settle();
    expect(main().querySelector('.eg-player__fade')).not.toBe(first);
    expect(main().querySelector('.eg-player__plate')!.textContent).toBe('Bridge');
  });

  it('draws labels to be read across a room: in proportion to the screen, never below 1.6 times the DM’s', () => {
    expect(labelScaleFor(1080)).toBeCloseTo(2.55, 6);
    expect(labelScaleFor(2160)).toBeCloseTo(5.1, 6);
    expect(labelScaleFor(720)).toBeCloseTo(1.7, 6);
    expect(labelScaleFor(288)).toBe(1.6);
  });
});

describe('pings on the TV (TBL-01, specs/04-live-sync.md §12)', () => {
  const drawnPings = () => {
    const state = main().querySelector<HTMLElement>('.eg-canvas--player')!.dataset.pings;
    return state === undefined ? [] : (JSON.parse(state) as { x: number; y: number }[]);
  };

  it('draws each ping at its point in grid units, over the tokens, and lets every ping go on a snapshot', async () => {
    await open(snapshot([token(1, 'Goblin', 0)]));
    expect(drawnPings()).toEqual([]);
    await deliver('ping', 2, { x: 4.5, y: 2.5 });
    await deliver('ping', 3, { x: 10, y: 8 });
    expect(drawnPings()).toMatchObject([
      { x: 4.5, y: 2.5 },
      { x: 10, y: 8 },
    ]);
    const layers = stage().getLayers();
    const pingLayer = stage().findOne<Konva.Layer>('.ping-layer')!;
    expect(layers.indexOf(pingLayer)).toBeGreaterThan(layers.findIndex((layer) => layer.findOne('.token')));
    expect(pingLayer.find('.ping')).toHaveLength(2);
    // Drawn where the grid puts the point: the map's squares are 50 display pixels at this grid.
    expect(pingLayer.find('.ping')[0]!.position()).toEqual({ x: 225, y: 125 });
    // A malformed ping is skipped; the TV still has no control.
    await deliver('ping', 4, { x: 'left', y: 1 });
    expect(drawnPings()).toHaveLength(2);
    expect(rendered.container.querySelectorAll(FOCUSABLE)).toHaveLength(0);
    await deliver('scene.snapshot', 5, snapshot([]));
    expect(drawnPings()).toEqual([]);
    expect(stage().findOne('.ping-layer')).toBeUndefined();
  });
});

describe('the initiative strip (TBL-06, DMT-02, specs/08-ux-journeys.md §12)', () => {
  const pc = (n: number, label: string, z: number): PlayerToken => ({ ...token(n, label, z), category: 'pc' });
  const strip = () => main().querySelector<HTMLElement>('.eg-player__initiative');
  const cards = () =>
    [...main().querySelectorAll<HTMLElement>('.eg-player__initiative-card')].map((card) => [
      card.querySelector('.eg-player__initiative-name')!.textContent,
      card.classList.contains('eg-player__initiative-card--current')
        ? 'now'
        : card.classList.contains('eg-player__initiative-card--next')
          ? 'next'
          : '',
    ]);
  const encounter = (current: number, next: number | null, round = 1) => ({
    round,
    entries: [
      { id: id(101), kind: 'pc', token_id: id(1) },
      { id: id(103), kind: 'monster', token_id: id(3) },
      { id: id(102), kind: 'pc', token_id: id(2) },
    ],
    current,
    next,
  });

  it('shows the order, the turn, the next and the round while combat runs, and fades away when it ends', async () => {
    const tokens = [pc(1, 'Tamsin', 0), pc(2, 'Wren', 1), token(3, 'Goblin', 2)];
    await open(snapshot(tokens));
    expect(strip()).toBeNull();
    await deliver('encounter.updated', 2, { encounter: encounter(0, 1) });
    expect(cards()).toEqual([
      ['Tamsin', 'now'],
      ['Goblin', 'next'],
      ['Wren', ''],
    ]);
    expect(strip()!.textContent).toContain(t('initiative.tvRound', { round: 1 }));
    // Portraits are the display version players may fetch of tokens they see.
    expect(strip()!.querySelector('img')!.getAttribute('src')).toBe(imageFileUrl(IMAGE, 'display'));
    // The monster's card is its token's label, in the monster ring colour (Q-111).
    expect(strip()!.querySelectorAll('.eg-player__initiative-card--monster')).toHaveLength(1);
    expect(strip()!.querySelectorAll('.eg-player__initiative-card--pc')).toHaveLength(2);
    // Nothing on the strip takes focus: the TV has no controls.
    expect(strip()!.querySelectorAll(FOCUSABLE)).toHaveLength(0);
    await deliver('encounter.updated', 3, { encounter: encounter(2, 0, 3) });
    expect(cards()).toEqual([
      ['Tamsin', 'next'],
      ['Goblin', ''],
      ['Wren', 'now'],
    ]);
    expect(strip()!.textContent).toContain(t('initiative.tvRound', { round: 3 }));
    // A Dead goblin stays on the strip, greyed (Q-118).
    expect(strip()!.querySelector('[data-dead]')).toBeNull();
    await deliver('token.updated', 4, {
      token: { ...token(3, 'Goblin', 2), markers: [{ id: 'dead' }] },
      relabelled: [],
    });
    expect(strip()!.querySelector('[data-dead]')?.textContent).toContain('Goblin');
    expect(strip()!.querySelector('[data-dead]')!.classList).toContain('eg-player__initiative-card--dead');
    vi.useFakeTimers();
    await act(async () => {
      fake.sockets[0]!.deliver({ type: 'encounter.updated', version: 5, payload: { encounter: null } });
      await Promise.resolve();
    });
    expect(strip()!.dataset.initiative).toBe('leaving');
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(strip()).toBeNull();
  });

  it('comes back with a reconnecting TV’s snapshot, and skips a malformed event', async () => {
    const tokens = [pc(1, 'Tamsin', 0), pc(2, 'Wren', 1), token(3, 'Goblin', 2)];
    await open({ ...snapshot(tokens), scene: { ...snapshot(tokens).scene!, encounter: encounter(1, 2) as never } });
    expect(cards()).toEqual([
      ['Tamsin', ''],
      ['Goblin', 'now'],
      ['Wren', 'next'],
    ]);
    await deliver('encounter.updated', 2, { encounter: { round: 0, entries: 'many' } });
    expect(cards()).toHaveLength(3);
  });
});
