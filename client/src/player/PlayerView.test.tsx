// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeSockets } from '../ui/testing/fakeSocket.js';
import { FOCUSABLE, render, type Rendered } from '../ui/testing/render.js';
import { PlayerView } from './PlayerView.js';

// The player view's live connection (LIV-01, specs/04-live-sync.md §5, §6, specs/08-ux-journeys.md §4).

let fake: ReturnType<typeof installFakeSockets>;
let rendered: Rendered;

beforeEach(() => {
  fake = installFakeSockets();
  rendered = render(PlayerView);
});

afterEach(() => {
  rendered.unmount();
  fake.restore();
});

const main = () => rendered.container.querySelector('main[data-view="player"]')!;

describe('player view connection', () => {
  it('connects on opening and counts the snapshot every connection brings', () => {
    expect(fake.sockets).toHaveLength(1);
    expect(main().getAttribute('data-live')).toBe('connecting');
    act(() => fake.sockets[0]!.open({ role: 'players', scene: null }));
    expect(main().getAttribute('data-live')).toBe('connected');
    expect(main().getAttribute('data-snapshots')).toBe('1');
  });

  it('reconnects and resynchronises from a fresh snapshot, showing only the idle screen throughout', () => {
    const socket = fake.sockets[0]!;
    act(() => socket.open({ role: 'players', scene: null }));
    act(() => socket.drop('transport close'));
    expect(main().getAttribute('data-live')).toBe('reconnecting');
    // Nobody operates the TV: no message, no control, the product name only (Q-025).
    expect(main().textContent).toBe('Emberglass');
    expect(rendered.container.querySelectorAll(FOCUSABLE)).toHaveLength(0);
    act(() => socket.open({ role: 'players', scene: null }));
    expect(main().getAttribute('data-live')).toBe('connected');
    expect(main().getAttribute('data-snapshots')).toBe('2');
  });

  it('closes its connection when it goes away', () => {
    act(() => fake.sockets[0]!.open({ role: 'players', scene: null }));
    rendered.unmount();
    expect(fake.sockets[0]!.connected).toBe(false);
    rendered = render(PlayerView);
  });
});
