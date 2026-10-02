// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { t } from '../ui/messages.js';
import { installCanvas2d, installImageLoading, installResizeObserver } from '../ui/testing/canvas2d.js';
import { button, click, FakeServer, installDialog, settle, type Reply } from '../ui/testing/fakeServer.js';
import { render, type Rendered } from '../ui/testing/render.js';
import { DmView } from './DmView.js';

// The "Connect a screen" panel of the DM view (LIV-03, PKG-01, specs/08-ux-journeys.md §5, Q-026, Q-110, D-112).

let server: FakeServer;
let rendered: Rendered | undefined;

beforeEach(() => {
  installDialog();
  installCanvas2d();
  installResizeObserver({ width: 800, height: 600 });
  installImageLoading();
  server = new FakeServer().install();
});

afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  server.uninstall();
});

async function openPanel(): Promise<HTMLDialogElement> {
  rendered = render(DmView);
  await settle();
  await click(button(rendered.container, t('connect.open')));
  await settle();
  return rendered.container.querySelector('dialog')!;
}

describe('Connect a screen', () => {
  it('is offered in the live bar and shows the player view’s URL in large, its QR code, and the other addresses', async () => {
    const dialog = await openPanel();
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('h2')!.textContent).toBe(t('connect.heading'));
    expect(dialog.querySelector('.eg-connect__url')!.textContent).toBe('http://192.168.1.20:3000/');
    const qr = dialog.querySelector('svg[role="img"]')!;
    expect(qr.getAttribute('aria-label')).toBe(t('connect.qrLabel', { url: 'http://192.168.1.20:3000/' }));
    // 21 modules and a quiet zone of 4 on each side; one square per dark module.
    expect(qr.getAttribute('viewBox')).toBe('0 0 29 29');
    const dark = server.connect
      .qr!.rows.join('')
      .split('')
      .filter((module) => module === '1').length;
    expect(qr.querySelector('path')!.getAttribute('d')!.match(/M/g)).toHaveLength(dark);
    // Each address named with its adapter, so the DM can tell the Wi-Fi from a virtual adapter (Q-110).
    expect(dialog.querySelector('.eg-connect__adapter')!.textContent).toBe(t('connect.adapter', { adapter: 'Wi-Fi' }));
    expect([...dialog.querySelectorAll('.eg-connect__others li')].map((li) => li.textContent)).toEqual([
      t('connect.otherEntry', { url: 'http://100.64.3.4:3000/', adapter: 'vEthernet (WSL)' }),
    ]);
    expect(dialog.textContent).not.toContain(t('connect.chosen'));
    expect(dialog.textContent).not.toContain('/dm');
    expect(server.calls.filter((call) => call.path === '/api/connect')).toHaveLength(1);
  });

  it('shows the TV address chosen in Settings first, its QR code included, and says it was chosen (Q-110)', async () => {
    server.tvAddress = '100.64.3.4';
    const dialog = await openPanel();
    expect(dialog.querySelector('.eg-connect__url')!.textContent).toBe('http://100.64.3.4:3000/');
    expect(dialog.querySelector('svg[role="img"]')!.getAttribute('aria-label')).toBe(
      t('connect.qrLabel', { url: 'http://100.64.3.4:3000/' }),
    );
    expect(dialog.querySelector('.eg-connect__adapter')!.textContent).toBe(
      `${t('connect.adapter', { adapter: 'vEthernet (WSL)' })} ${t('connect.chosen')}`,
    );
    expect(dialog.textContent).not.toContain(t('connect.chosenMissing', { address: '100.64.3.4' }));
  });

  it('says so when the chosen TV address is not an address of this PC now, and shows the automatic one', async () => {
    server.tvAddress = '10.0.0.40';
    const dialog = await openPanel();
    expect(dialog.textContent).toContain(t('connect.chosenMissing', { address: '10.0.0.40' }));
    expect(dialog.querySelector('.eg-connect__url')!.textContent).toBe('http://192.168.1.20:3000/');
  });

  it('closes with its Close button, and gives focus back to the button that opened it', async () => {
    const dialog = await openPanel();
    await click(button(dialog, t('connect.close')));
    expect(rendered!.container.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(button(rendered!.container, t('connect.open')));
  });

  it('closes with Escape, and gives focus back to the button that opened it', async () => {
    const dialog = await openPanel();
    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    await settle();
    expect(rendered!.container.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(button(rendered!.container, t('connect.open')));
  });

  it('says so when the PC has no network address, with no code', async () => {
    server.connect = { addresses: [], qr: null };
    const dialog = await openPanel();
    expect(dialog.textContent).toContain(t('connect.none'));
    expect(dialog.querySelector('svg')).toBeNull();
  });

  it('says it is loading while the server answers, and names the reason when it cannot', async () => {
    let release: (reply?: Reply) => void = () => {};
    server.before = (call) =>
      call.path === '/api/connect' ? new Promise<Reply | undefined>((resolve) => (release = resolve)) : undefined;
    const dialog = await openPanel();
    expect(dialog.querySelector('[role="status"]')!.textContent).toBe(t('connect.loading'));
    release({ status: 500, body: { error: { code: 'internal_error', message: 'x' } } });
    await settle();
    expect(dialog.textContent).not.toContain(t('connect.loading'));
    expect(dialog.textContent).toContain(t('error.code.internal_error'));
  });
});
