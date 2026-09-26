// @vitest-environment jsdom
import { act } from 'react';
import Konva from 'konva';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  imageFileUrl,
  type DmSnapshot,
  type EventEnvelope,
  type Grid,
  type PlayerSnapshot,
  type PlayerToken,
} from '@emberglass/shared';
import { fitCamera } from '../canvas/geometry.js';
import { images, installCanvas2d, installImageLoading, installResizeObserver } from '../ui/testing/canvas2d.js';
import { settle } from '../ui/testing/fakeServer.js';
import { installFakeSockets } from '../ui/testing/fakeSocket.js';
import { FOCUSABLE, render, type Rendered } from '../ui/testing/render.js';
import { CURSOR_IDLE_MS, PlayerView } from './PlayerView.js';

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
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const token = (n: number, label: string, z_order: number, x = n): PlayerToken => ({
  id: id(n),
  x,
  y: 1,
  size: 'medium',
  image_id: IMAGE,
  z_order,
  label,
});

const snapshot = (tokens: PlayerToken[], grid: Grid = GRID): PlayerSnapshot => ({
  role: 'players',
  scene: { map: MAP, grid, tokens },
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
    // Nobody operates the TV: no message, no control, the product name only (Q-025).
    expect(main().textContent).toBe('Emberglass');
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
  it('shows the dark idle screen with the product name only while nothing is live', async () => {
    await open({ role: 'players', scene: null });
    expect(main().dataset.scene).toBe('idle');
    expect(main().querySelector('.eg-idle')).not.toBeNull();
    expect(main().textContent).toBe('Emberglass');
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
    expect(main().textContent).toBe('Emberglass');
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
});
