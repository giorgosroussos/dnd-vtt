// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { t } from '../ui/messages.js';
import { button, click, FakeServer, installDialog, settle, submit, type } from '../ui/testing/fakeServer.js';
import { render, type Rendered } from '../ui/testing/render.js';
import { DmView } from './DmView.js';

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
    expect(view.querySelector('[role="alert"]')!.textContent).toBe(t('signIn.lockedOut', { seconds: 480 }));
    expect(view.querySelector('nav')).toBeNull();
  });

  it('signs out to the PIN form', async () => {
    server.signedIn = true;
    const view = await open();
    await click(button(view, t('dm.signOut')));
    expect(server.writes()).toEqual(['DELETE /api/auth']);
    expect(heading(view)).toBe(t('signIn.heading'));
  });

  it('returns to the PIN form when the server no longer knows the session', async () => {
    server.signedIn = true;
    const view = await open();
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
