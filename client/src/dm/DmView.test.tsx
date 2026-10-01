// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { t } from '../ui/messages.js';
import { CONNECTION_NOTICE_DELAY_MS } from './LiveBar.js';
import {
  button,
  click,
  FakeServer,
  installDialog,
  liveText,
  openSwitcher,
  settle,
  submit,
  type,
} from '../ui/testing/fakeServer.js';
import { render, type Rendered } from '../ui/testing/render.js';
import { DmView } from './DmView.js';
import { lockedOutText, pinRefusalText, serverPcAddress, waitText } from './SignIn.js';

// The DM view's screens (PRP-01, specs/07-security-and-access.md §1, §2, §6,
// specs/08-ux-journeys.md §1, D-085), against a scripted server behind fetch.

let server: FakeServer;
let rendered: Rendered | undefined;

beforeEach(() => {
  installDialog();
  server = new FakeServer().install();
});

afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  server.uninstall();
});

async function open(): Promise<HTMLElement> {
  rendered = render(DmView);
  await settle();
  return rendered.container;
}

const heading = (container: HTMLElement) => container.querySelector('h1')?.textContent;
const inputs = (container: HTMLElement) => [...container.querySelectorAll('input')];

/** Signs out from the Settings dialog, where Sign out is since the redesign (UIX-01). */
async function signOut(view: HTMLElement): Promise<void> {
  if (!view.querySelector('dialog[open]')) await click(button(view, t('settings.open')));
  await click(button(view.querySelector('dialog')!, t('dm.signOut')));
}

describe('first run (specs/07-security-and-access.md §1)', () => {
  it('offers setup to a browser on the server PC while no PIN exists, and signs it in', async () => {
    server.pinSet = false;
    server.signedIn = false;
    const view = await open();
    expect(heading(view)).toBe(t('setup.heading'));
    const [pin, again] = inputs(view);
    expect(pin!.type).toBe('password');
    await type(pin, '482613');
    await type(again, '482613');
    await submit(view.querySelector('form'));
    expect(server.calls).toContainEqual({ method: 'POST', path: '/api/setup', body: { pin: '482613' } });
    expect(view.querySelector('nav')).not.toBeNull();
    expect(heading(view)).toBe(t('workspace.noScene'));
  });

  it('refuses a PIN that is not 4 to 8 digits, or a confirmation that differs, before sending anything', async () => {
    server.pinSet = false;
    server.signedIn = false;
    const view = await open();
    const [pin, again] = inputs(view);
    for (const [first, second, message] of [
      ['123', '123', 'setup.pinInvalid'],
      ['123456789', '123456789', 'setup.pinInvalid'],
      ['12a4', '12a4', 'setup.pinInvalid'],
      ['4826', '4827', 'setup.mismatch'],
    ] as const) {
      await type(pin, first);
      await type(again, second);
      await submit(view.querySelector('form'));
      expect(view.textContent).toContain(t(message));
    }
    expect(server.writes()).toEqual([]);
  });

  it('shows a LAN browser only that setup happens on the server PC, with nothing to fill in', async () => {
    server.pinSet = false;
    server.local = false;
    server.signedIn = false;
    const view = await open();
    expect(heading(view)).toBe(t('setupElsewhere.heading'));
    expect(view.textContent).toContain(t('setupElsewhere.body'));
    expect(view.querySelector('main')!.querySelectorAll('input, button, form')).toHaveLength(0);
  });

  it('sends a browser whose setup lost the race to the PIN form', async () => {
    server.pinSet = false;
    server.signedIn = false;
    const view = await open();
    server.pinSet = true;
    const [pin, again] = inputs(view);
    await type(pin, '4826');
    await type(again, '4826');
    await submit(view.querySelector('form'));
    expect(heading(view)).toBe(t('signIn.heading'));
  });
});

describe('PIN entry and sign-out (specs/07-security-and-access.md §2, §6)', () => {
  beforeEach(() => {
    server.signedIn = false;
  });

  it('opens the workspace for the right PIN', async () => {
    const view = await open();
    expect(heading(view)).toBe(t('signIn.heading'));
    await type(inputs(view)[0], '4826');
    await submit(view.querySelector('form'));
    expect(view.querySelector('nav')).not.toBeNull();
  });

  it('says a PIN is wrong next to the field and clears it', async () => {
    const view = await open();
    await type(inputs(view)[0], '1111');
    await submit(view.querySelector('form'));
    const input = inputs(view)[0]!;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(view.textContent).toContain(t('error.code.pin_incorrect'));
    expect(input.value).toBe('');
    expect(view.querySelector('nav')).toBeNull();
  });

  it('names the wait of a lockout from Retry-After', async () => {
    server.lockedFor = 480;
    const view = await open();
    await type(inputs(view)[0], '4826');
    await submit(view.querySelector('form'));
    // In minutes once that reads better (REL-01 review U-L6).
    expect(view.querySelector('[role="alert"]')!.textContent).toBe(t('signIn.lockedOut', { wait: '8 minutes' }));
    expect(view.querySelector('nav')).toBeNull();
  });

  it('names a long wait in hours (G-042)', async () => {
    server.lockedFor = 640 * 60;
    const view = await open();
    await type(inputs(view)[0], '4826');
    await submit(view.querySelector('form'));
    expect(view.querySelector('[role="alert"]')!.textContent).toBe(t('signIn.lockedOut', { wait: '11 hours' }));
  });

  it('says a server-wide pause is not necessarily this device’s doing and names the server PC (G-042)', async () => {
    server.pausedFor = 1_200;
    const view = await open();
    await type(inputs(view)[0], '4826');
    await submit(view.querySelector('form'));
    const alert = view.querySelector('[role="alert"]')!.textContent;
    expect(alert).toBe(t('signIn.paused', { address: serverPcAddress(), wait: t('wait.minutes', { count: 20 }) }));
    expect(alert).toContain('server PC');
    expect(alert).toContain('localhost');
    expect(alert).toContain('20 minutes');
    // The address ends the message, so that it is copied without punctuation (review U-L5).
    expect(alert.endsWith(serverPcAddress())).toBe(true);
    expect(view.querySelector('nav')).toBeNull();
  });

  it('addresses the server PC by localhost and the port the browser used', () => {
    expect(serverPcAddress({ port: '3000' })).toBe('http://localhost:3000/dm');
    expect(serverPcAddress({ port: '' })).toBe('http://localhost/dm');
  });

  it('gives waits in seconds, minutes, then hours past two hours', () => {
    expect(waitText(1)).toBe('1 second');
    expect(waitText(119)).toBe('119 seconds');
    expect(waitText(120)).toBe('2 minutes');
    expect(waitText(7_200)).toBe('120 minutes');
    expect(waitText(7_201)).toBe('3 hours');
    expect(lockedOutText(7_200)).toBe('Too many wrong PINs. Try again in 120 minutes.');
    expect(lockedOutText(7_201)).toBe('Too many wrong PINs. Try again in 3 hours.');
    // Without a Retry-After, each code's own message (review T-L6).
    expect(pinRefusalText('pin_paused', undefined)).toBe(t('error.code.pin_paused'));
    expect(pinRefusalText('locked_out', undefined)).toBe(t('error.code.locked_out'));
  });

  it('names a short wait in seconds', async () => {
    server.lockedFor = 45;
    const view = await open();
    await type(inputs(view)[0], '4826');
    await submit(view.querySelector('form'));
    expect(view.querySelector('[role="alert"]')!.textContent).toBe(t('signIn.lockedOut', { wait: '45 seconds' }));
  });

  it('signs out to the PIN form', async () => {
    server.signedIn = true;
    const view = await open();
    await signOut(view);
    expect(server.writes()).toEqual(['DELETE /api/auth']);
    expect(heading(view)).toBe(t('signIn.heading'));
  });

  it('stays signed in and says so when sign-out fails, so a shared laptop is not left looking signed out (review M-1)', async () => {
    server.signedIn = true;
    const view = await open();
    server.before = (call) => (call.method === 'DELETE' ? Promise.reject(new TypeError('offline')) : undefined);
    await signOut(view);
    expect(view.querySelector('nav')).not.toBeNull();
    expect(view.querySelector('[role="alert"]')!.textContent).toBe(
      t('dm.signOutFailed', { reason: t('error.code.network') }),
    );
    server.before = undefined;
    await signOut(view);
    expect(heading(view)).toBe(t('signIn.heading'));
  });

  it('returns to the PIN form when the server no longer knows the session', async () => {
    server.signedIn = true;
    const view = await open();
    await openSwitcher(view);
    server.signedIn = false;
    await click(button(view, t('tree.newCampaign')));
    await type(inputs(view)[0], 'Lost Mine');
    await submit(view.querySelector('form'));
    expect(heading(view)).toBe(t('signIn.heading'));
  });
});

describe('the view before the server answers', () => {
  it('says it is loading, then offers to try again when the server does not answer', async () => {
    let fail = true;
    server.before = () => (fail ? Promise.reject(new TypeError('offline')) : undefined);
    const view = await open();
    expect(view.textContent).toContain(t('dm.loadFailed'));
    expect(view.textContent).toContain(t('error.code.network'));
    fail = false;
    await click(button(view, t('dm.retry')));
    expect(view.querySelector('nav')).not.toBeNull();
  });
});

describe('the live connection (LIV-01, specs/04-live-sync.md §6, specs/07-security-and-access.md §2)', () => {
  const liveBar = liveText;
  const waitPastNoticeDelay = () =>
    act(() => new Promise<void>((resolve) => setTimeout(resolve, CONNECTION_NOTICE_DELAY_MS + 50)));
  const deliver = async (run: () => void) => {
    act(() => run());
    await settle();
  };

  it('opens one connection with the workspace and closes it with a sign-out', async () => {
    server.signedIn = true;
    const view = await open();
    expect(server.sockets).toHaveLength(1);
    await deliver(() => server.sockets[0]!.open({ role: 'dm', scene: null }));
    await signOut(view);
    expect(server.sockets[0]!.connected).toBe(false);
    expect(heading(view)).toBe(t('signIn.heading'));
  });

  it('says it is reconnecting while the connection is lost, and keeps the workspace without asking for the PIN', async () => {
    server.signedIn = true;
    const view = await open();
    const socket = server.sockets[0]!;
    await deliver(() => socket.open({ role: 'dm', scene: null }));
    expect(liveBar(view)).toBe(t('liveBar.none'));
    await deliver(() => socket.drop('transport close'));
    // A blip is not announced; a loss that lasts is, in the warning style.
    expect(liveBar(view)).toBe(t('liveBar.none'));
    await waitPastNoticeDelay();
    expect(liveBar(view)).toBe(t('liveBar.reconnecting'));
    expect(view.querySelector('.eg-live--warning')).not.toBeNull();
    await deliver(() => socket.open({ role: 'dm', scene: null }));
    expect(liveBar(view)).toBe(t('liveBar.none'));
    expect(view.querySelector('input[type="password"]')).toBeNull();
    expect(server.sockets).toHaveLength(1);
  });

  it('goes back to the PIN form when the server puts the reconnected socket in the players room', async () => {
    server.signedIn = true;
    const view = await open();
    const socket = server.sockets[0]!;
    await deliver(() => socket.open({ role: 'dm', scene: null }));
    // A PIN change on another device ended this session: the server dropped the socket.
    server.signedIn = false;
    await deliver(() => socket.drop('io server disconnect'));
    expect(socket.connects).toBe(1);
    await deliver(() => socket.open({ role: 'players', scene: null }));
    await settle();
    expect(heading(view)).toBe(t('signIn.heading'));
    expect(socket.connected).toBe(false);
    // It says why, and focus is where the form starts, not lost with the workspace.
    expect(view.querySelector('[role="alert"]')?.textContent).toBe(t('signIn.sessionEnded'));
    expect(document.activeElement?.id).toBe('main');
  });

  it('reconnects once, keeping the workspace, when the server still knows the session (G-027)', async () => {
    server.signedIn = true;
    const view = await open();
    const socket = server.sockets[0]!;
    await deliver(() => socket.open({ role: 'dm', scene: null }));
    // A reconnection that left before a sign-in in another tab had stored its cookie lands in players.
    await deliver(() => socket.drop('io server disconnect'));
    await deliver(() => socket.open({ role: 'players', scene: null }));
    await settle();
    expect(server.calls.filter((call) => call.method === 'GET' && call.path === '/api/auth')).toHaveLength(2);
    expect(socket.connects).toBe(2);
    expect(view.querySelector('input[type="password"]')).toBeNull();
    await deliver(() => socket.open({ role: 'dm', scene: null }));
    expect(liveBar(view)).toBe(t('liveBar.none'));
    expect(view.querySelector('input[type="password"]')).toBeNull();
  });

  it('signs out when the socket lands in players again after that one reconnection (G-027)', async () => {
    server.signedIn = true;
    const view = await open();
    const socket = server.sockets[0]!;
    await deliver(() => socket.open({ role: 'dm', scene: null }));
    await deliver(() => socket.drop('io server disconnect'));
    await deliver(() => socket.open({ role: 'players', scene: null }));
    await settle();
    expect(socket.connects).toBe(2);
    await deliver(() => socket.open({ role: 'players', scene: null }));
    await settle();
    expect(heading(view)).toBe(t('signIn.heading'));
    expect(view.querySelector('[role="alert"]')?.textContent).toBe(t('signIn.sessionEnded'));
  });

  it('asks the server again at a later race, once a reconnection brought it back to dm (G-027, review M6)', async () => {
    server.signedIn = true;
    const view = await open();
    const socket = server.sockets[0]!;
    await deliver(() => socket.open({ role: 'dm', scene: null }));
    await deliver(() => socket.drop('io server disconnect'));
    await deliver(() => socket.open({ role: 'players', scene: null }));
    await settle();
    await deliver(() => socket.open({ role: 'dm', scene: null }));
    // Another sign-in race, later in the evening: checked with the server again, not signed out.
    await deliver(() => socket.drop('io server disconnect'));
    await deliver(() => socket.open({ role: 'players', scene: null }));
    await settle();
    expect(server.calls.filter((call) => call.method === 'GET' && call.path === '/api/auth')).toHaveLength(3);
    expect(socket.connects).toBe(4);
    expect(view.querySelector('input[type="password"]')).toBeNull();
  });

  it('signs out when the check with the server fails (G-027, review M6)', async () => {
    server.signedIn = true;
    const view = await open();
    const socket = server.sockets[0]!;
    await deliver(() => socket.open({ role: 'dm', scene: null }));
    server.before = (call) =>
      call.path === '/api/auth'
        ? { status: 500, body: { error: { code: 'internal_error', message: 'test' } } }
        : undefined;
    await deliver(() => socket.drop('io server disconnect'));
    await deliver(() => socket.open({ role: 'players', scene: null }));
    await settle();
    expect(heading(view)).toBe(t('signIn.heading'));
    expect(socket.connects).toBe(1);
  });

  it('says it is connecting, not that a connection was lost, while a first connection does not succeed', async () => {
    server.signedIn = true;
    const view = await open();
    await waitPastNoticeDelay();
    expect(liveBar(view)).toBe(t('liveBar.connecting'));
    await deliver(() => server.sockets[0]!.open({ role: 'dm', scene: null }));
    expect(liveBar(view)).toBe(t('liveBar.none'));
  });

  it('gives the same reason when a request finds the session ended', async () => {
    server.signedIn = true;
    const view = await open();
    await openSwitcher(view);
    server.signedIn = false;
    await click(button(view, t('tree.newCampaign')));
    await type(inputs(view)[0], 'Lost Mine');
    await submit(view.querySelector('form'));
    expect(heading(view)).toBe(t('signIn.heading'));
    expect(view.querySelector('[role="alert"]')?.textContent).toBe(t('signIn.sessionEnded'));
  });

  it('shows no reason after the DM signs out here', async () => {
    server.signedIn = true;
    const view = await open();
    await signOut(view);
    expect(heading(view)).toBe(t('signIn.heading'));
    expect(view.querySelector('[role="alert"]')).toBeNull();
  });
});
