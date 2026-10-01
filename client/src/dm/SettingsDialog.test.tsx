// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { t } from '../ui/messages.js';
import { serverPcAddress } from './SignIn.js';
import { installCanvas2d, installImageLoading, installResizeObserver } from '../ui/testing/canvas2d.js';
import {
  button,
  click,
  FakeServer,
  installDialog,
  openLibrary,
  type Reply,
  settle,
  submit,
  type,
} from '../ui/testing/fakeServer.js';
import { render, type Rendered } from '../ui/testing/render.js';
import { DmView } from './DmView.js';

// The Settings dialog of the DM view (REL-01, specs/09-operations.md §7, specs/07-security-and-access.md
// §1, Q-051): the upload limit, the display size and the ruler's rule, saved without a restart, and the
// PIN change. The server's checks are server/src/http/settings.test.ts and auth.test.ts.

const MB = 1024 * 1024;
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

async function openDialog(): Promise<HTMLDialogElement> {
  rendered = render(DmView);
  await settle();
  await click(button(rendered.container, t('settings.open')));
  await settle();
  return rendered.container.querySelector('dialog')!;
}

/** An input by its visible label. */
function field(container: ParentNode, label: string): HTMLInputElement {
  const found = [...container.querySelectorAll('label')].find((each) => each.textContent === label);
  if (!found) throw new Error(`no field labelled ${label}`);
  return document.getElementById(found.htmlFor) as HTMLInputElement;
}
const settingsForm = (dialog: HTMLDialogElement) => dialog.querySelectorAll('form')[0]!;
const pinForm = (dialog: HTMLDialogElement) => dialog.querySelectorAll('form')[1]!;
const patches = () => server.calls.filter((call) => call.method === 'PATCH' && call.path === '/api/settings');
const described = (input: HTMLInputElement) =>
  (input.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent)
    .join(' ');

describe('Settings', () => {
  it('shows the three settings as the server holds them', async () => {
    server.uploadLimit = 20 * MB;
    server.displaySize = 2048;
    server.rulerRule = 'dmg';
    const dialog = await openDialog();
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('h2')!.textContent).toBe(t('settings.heading'));
    expect(field(dialog, t('settings.uploadLimit')).value).toBe('20');
    expect(field(dialog, t('settings.displaySize')).value).toBe('2048');
    expect(dialog.querySelector<HTMLInputElement>('input[value="dmg"]')!.checked).toBe(true);
    expect(dialog.querySelector<HTMLInputElement>('input[value="phb"]')!.checked).toBe(false);
    expect(dialog.querySelector('legend')!.textContent).toBe(t('settings.rulerRule'));
    expect(described(field(dialog, t('settings.displaySize')))).toContain(
      t('settings.displaySizeHint', { min: '512', max: '16,383' }),
    );
  });

  it('saves every change at once, says a new display size is applied in the background, and the workspace follows', async () => {
    const dialog = await openDialog();
    await type(field(dialog, t('settings.uploadLimit')), '10');
    await type(field(dialog, t('settings.displaySize')), '2048');
    await click(dialog.querySelector<HTMLInputElement>('input[value="dmg"]'));
    await submit(settingsForm(dialog));
    expect(patches().map((call) => call.body)).toEqual([
      { upload_limit_bytes: 10 * MB, display_variant_size: 2048, ruler_rule: 'dmg' },
    ]);
    expect([server.uploadLimit, server.displaySize, server.rulerRule]).toEqual([10 * MB, 2048, 'dmg']);
    expect(settingsForm(dialog).querySelector('[role="status"]')!.textContent).toBe(t('settings.savedRegenerating'));
    // The same size again: nothing is regenerated, so the message does not say so.
    await submit(settingsForm(dialog));
    expect(settingsForm(dialog).querySelector('[role="status"]')!.textContent).toBe(t('settings.saved'));
  });

  it('puts focus in the first field once the settings have arrived', async () => {
    const dialog = await openDialog();
    expect(document.activeElement).toBe(field(dialog, t('settings.uploadLimit')));
    expect(settingsForm(dialog).getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.getElementById(settingsForm(dialog).getAttribute('aria-labelledby')!)!.textContent).toBe(
      t('settings.tableHeading'),
    );
  });

  it('sends only what was changed, so a setting another browser saved meanwhile is kept', async () => {
    const dialog = await openDialog();
    // Another browser saves the DMG rule while this dialog is open.
    server.rulerRule = 'dmg';
    await type(field(dialog, t('settings.uploadLimit')), '20');
    await submit(settingsForm(dialog));
    expect(patches().map((call) => call.body)).toEqual([{ upload_limit_bytes: 20 * MB }]);
    expect(server.rulerRule).toBe('dmg');
    // Saved with nothing changed: the display size alone, which finishes an interrupted regeneration.
    await submit(settingsForm(dialog));
    expect(patches().at(-1)!.body).toEqual({ display_variant_size: 4096 });
  });

  it('saves the other settings when the stored upload limit is not a whole number of MB', async () => {
    server.uploadLimit = 1.5 * MB;
    const dialog = await openDialog();
    expect(field(dialog, t('settings.uploadLimit')).value).toBe('1.5');
    await click(dialog.querySelector<HTMLInputElement>('input[value="dmg"]'));
    await submit(settingsForm(dialog));
    expect(patches().map((call) => call.body)).toEqual([{ ruler_rule: 'dmg' }]);
    expect(server.uploadLimit).toBe(1.5 * MB);
  });

  it('clears the saved message as soon as a field is changed again', async () => {
    const dialog = await openDialog();
    await submit(settingsForm(dialog));
    const status = settingsForm(dialog).querySelector('[role="status"]')!;
    expect(status.textContent).toBe(t('settings.saved'));
    await type(field(dialog, t('settings.uploadLimit')), '40');
    expect(status.textContent).toBe('');
  });

  it('refuses a value out of bounds beside its field, and sends nothing', async () => {
    const dialog = await openDialog();
    for (const [limit, display] of [
      ['0', '511'],
      ['1025', '16384'],
      ['2.5', 'big'],
      ['', ''],
    ] as const) {
      await type(field(dialog, t('settings.uploadLimit')), limit);
      await type(field(dialog, t('settings.displaySize')), display);
      await submit(settingsForm(dialog));
      const limitInput = field(dialog, t('settings.uploadLimit'));
      const displayInput = field(dialog, t('settings.displaySize'));
      expect(limitInput.getAttribute('aria-invalid')).toBe('true');
      expect(described(limitInput)).toContain(t('settings.uploadLimitInvalid', { min: '1', max: '1,024' }));
      expect(displayInput.getAttribute('aria-invalid')).toBe('true');
      expect(described(displayInput)).toContain(t('settings.displaySizeInvalid', { min: '512', max: '16,383' }));
    }
    expect(patches()).toEqual([]);
    // Focus goes to the first field refused.
    expect(document.activeElement).toBe(field(dialog, t('settings.uploadLimit')));
    await type(field(dialog, t('settings.uploadLimit')), '10');
    await submit(settingsForm(dialog));
    expect(document.activeElement).toBe(field(dialog, t('settings.displaySize')));
    // The bounds themselves are accepted.
    await type(field(dialog, t('settings.uploadLimit')), '1024');
    await type(field(dialog, t('settings.displaySize')), '512');
    await submit(settingsForm(dialog));
    expect(patches()).toHaveLength(1);
    expect(field(dialog, t('settings.uploadLimit')).getAttribute('aria-invalid')).toBeNull();
  });

  it('offers Try again when the settings cannot be read, and shows them once they can', async () => {
    rendered = render(DmView);
    await settle();
    let refuse = true;
    server.before = (call) =>
      call.path === '/api/settings' && refuse
        ? { status: 500, body: { error: { code: 'internal_error', message: 'x' } } }
        : undefined;
    await click(button(rendered.container, t('settings.open')));
    const dialog = rendered.container.querySelector('dialog')!;
    expect(dialog.querySelector('[role="alert"]')).not.toBeNull();
    refuse = false;
    await click(button(dialog, t('settings.retry')));
    expect(dialog.querySelector('[role="alert"]')).toBeNull();
    expect(field(dialog, t('settings.uploadLimit')).value).toBe('50');
  });

  it('says it is loading, and names the reason when the settings cannot be read', async () => {
    let release: (reply?: Reply) => void = () => {};
    rendered = render(DmView);
    await settle();
    server.before = (call) =>
      call.path === '/api/settings' ? new Promise<Reply | undefined>((resolve) => (release = resolve)) : undefined;
    await click(button(rendered.container, t('settings.open')));
    const dialog = rendered.container.querySelector('dialog')!;
    expect(dialog.querySelector('[role="status"]')!.textContent).toBe(t('settings.loading'));
    expect(dialog.querySelectorAll('form')).toHaveLength(0);
    release({ status: 500, body: { error: { code: 'internal_error', message: 'x' } } });
    await settle();
    expect(dialog.querySelector('[role="alert"]')!.textContent).toBe(
      t('settings.loadFailed', { reason: t('error.code.internal_error') }),
    );
  });

  it('shows Saving while the server answers, with Save off, and names the reason when it refuses', async () => {
    const dialog = await openDialog();
    let release: (reply?: Reply) => void = () => {};
    server.before = (call) =>
      call.method === 'PATCH' ? new Promise<Reply | undefined>((resolve) => (release = resolve)) : undefined;
    act(() => {
      settingsForm(dialog).requestSubmit();
    });
    await settle();
    const save = button(dialog, t('settings.save'))!;
    // Off but still focusable, so a keyboard user keeps their place (D-090).
    expect(save.disabled).toBe(false);
    expect(save.getAttribute('aria-disabled')).toBe('true');
    // Pressed again while saving: nothing more is sent.
    act(() => {
      settingsForm(dialog).requestSubmit();
    });
    await settle();
    expect(patches()).toHaveLength(1);
    expect(settingsForm(dialog).querySelector('[role="status"]')!.textContent).toBe(t('settings.saving'));
    expect(settingsForm(dialog).getAttribute('aria-busy')).toBe('true');
    release({ status: 400, body: { error: { code: 'validation_failed', message: 'x' } } });
    await settle();
    expect(save.getAttribute('aria-disabled')).toBeNull();
    expect(settingsForm(dialog).querySelector('[role="alert"]')!.textContent).toBe(
      t('settings.saveFailed', { reason: t('error.code.validation_failed') }),
    );
    expect(settingsForm(dialog).querySelector('[role="status"]')!.textContent).toBe('');
  });

  it('is operated by keyboard: Enter in a field saves, and Escape closes it and gives focus back', async () => {
    const dialog = await openDialog();
    const limit = field(dialog, t('settings.uploadLimit'));
    await type(limit, '30');
    // Enter in a text field submits its form: the browser's implicit submission.
    await submit(limit.form);
    expect(patches()).toHaveLength(1);
    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    await settle();
    expect(rendered!.container.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(button(rendered!.container, t('settings.open')));
  });

  it('gives the upload limit saved to the library at once, which then refuses a larger file before sending', async () => {
    const dialog = await openDialog();
    await type(field(dialog, t('settings.uploadLimit')), '1');
    await submit(settingsForm(dialog));
    await click(button(dialog, t('settings.close')));
    expect(server.uploadLimit).toBe(MB);
    expect(document.activeElement).toBe(button(rendered!.container, t('settings.open')));

    await openLibrary(rendered!.container);
    await click(button(rendered!.container, t('library.new')));
    const form = rendered!.container.querySelector('dialog')!;
    const input = field(form, t('assetForm.image'));
    act(() => {
      const file = new File([new Uint8Array(1.5 * MB)], 'map.png', { type: 'image/png' });
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(form.textContent).toContain(t('assetForm.tooLarge', { size: '1.5', limit: '1' }));
  });
});

describe('Change the PIN (specs/07-security-and-access.md §1)', () => {
  async function fill(dialog: HTMLDialogElement, current: string, next: string, confirm = next) {
    await type(field(dialog, t('settings.currentPin')), current);
    await type(field(dialog, t('settings.newPin')), next);
    await type(field(dialog, t('settings.confirmPin')), confirm);
    await submit(pinForm(dialog));
  }
  const pinCalls = () => server.calls.filter((call) => call.path === '/api/settings/pin');

  it('changes it with the current PIN and says other browsers were signed out', async () => {
    const dialog = await openDialog();
    expect([...pinForm(dialog).querySelectorAll('input')].map((input) => input.autocomplete)).toEqual([
      'current-password',
      'new-password',
      'new-password',
    ]);
    expect(pinForm(dialog).getAttribute('aria-labelledby')).toBeTruthy();
    await fill(dialog, '4826', '73019264');
    expect(pinCalls().map((call) => call.body)).toEqual([{ current_pin: '4826', new_pin: '73019264' }]);
    expect(server.pin).toBe('73019264');
    expect(pinForm(dialog).querySelector('[role="status"]')!.textContent).toBe(t('settings.pinChanged'));
    // No PIN is left in the form.
    expect([...pinForm(dialog).querySelectorAll('input')].map((input) => input.value)).toEqual(['', '', '']);
  });

  it('refuses a PIN that is not 4 to 8 digits, or two new PINs that differ, beside the field', async () => {
    const dialog = await openDialog();
    await fill(dialog, '12', '123456789');
    expect(field(dialog, t('settings.currentPin')).getAttribute('aria-invalid')).toBe('true');
    expect(field(dialog, t('settings.newPin')).getAttribute('aria-invalid')).toBe('true');
    await fill(dialog, '4826', '591837', '591838');
    expect(field(dialog, t('settings.confirmPin')).getAttribute('aria-invalid')).toBe('true');
    expect(described(field(dialog, t('settings.confirmPin')))).toContain(t('setup.mismatch'));
    expect(pinCalls()).toEqual([]);
  });

  it('says a wrong current PIN beside its field, and a lockout with its wait', async () => {
    const dialog = await openDialog();
    await fill(dialog, '0000', '591837');
    expect(described(field(dialog, t('settings.currentPin')))).toContain(t('error.code.pin_incorrect'));
    expect(server.pin).toBe('4826');
    // No PIN stays in the form after a refusal either, and focus is on the field to type again.
    expect([...pinForm(dialog).querySelectorAll('input')].map((input) => input.value)).toEqual(['', '', '']);
    expect(document.activeElement).toBe(field(dialog, t('settings.currentPin')));
    server.lockedFor = 600;
    await fill(dialog, '4826', '591837');
    expect(pinForm(dialog).querySelector('[role="alert"]')!.textContent).toBe(
      t('settings.pinFailed', { reason: t('signIn.lockedOutMinutes', { minutes: 10 }) }),
    );
    expect(server.pin).toBe('4826');
    expect([...pinForm(dialog).querySelectorAll('input')].map((input) => input.value)).toEqual(['', '', '']);
  });

  it('says a server-wide pause with the server PC’s address and the wait in hours past two hours (G-042)', async () => {
    const dialog = await openDialog();
    server.pausedFor = 640 * 60;
    await fill(dialog, '4826', '591837');
    const alert = pinForm(dialog).querySelector('[role="alert"]')!.textContent;
    expect(alert).toBe(
      t('settings.pinFailed', {
        reason: t('signIn.paused', { address: serverPcAddress(), wait: t('wait.hours', { count: 11 }) }),
      }),
    );
    expect(alert).toContain('11 hours');
    expect(server.pin).toBe('4826');
  });
});
