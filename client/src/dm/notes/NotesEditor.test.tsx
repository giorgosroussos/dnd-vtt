// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTES_MAX_LENGTH } from '@emberglass/shared';
import { errorMessage } from '../../ui/errorMessage.js';
import { t } from '../../ui/messages.js';
import { type } from '../../ui/testing/fakeServer.js';
import { render, type Rendered } from '../../ui/testing/render.js';
import { ApiError } from '../api.js';
import { clearDrafts, NOTES_SAVE_DELAY_MS, NotesEditor, ReadOnlyNotes, unsavedDrafts } from './NotesEditor.js';

// The DM notes field (DMT-04, specs/04-live-sync.md §16, specs/08-ux-journeys.md §13, D-186) on its own, its save
// a stand-in: saved NOTES_SAVE_DELAY_MS after typing stops and when focus leaves, never losing what was typed (a
// failed save, the limit, the field going and coming back), and a text from another window never replacing what is
// focused or unsaved. Text only: an HTML string shows as written.

let rendered: Rendered | undefined;
let saves: string[];
let answer: (text: string) => Promise<void>;

beforeEach(() => {
  vi.useFakeTimers();
  saves = [];
  answer = () => Promise.resolve();
  clearDrafts();
});

afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  vi.useRealTimers();
});

const save = (text: string) => {
  saves.push(text);
  return answer(text);
};

function editor(value = '', target = 'scene:1') {
  return createElement(NotesEditor, { target, value, save, label: 'Notes for the crypt' });
}

function show(value = '', target = 'scene:1'): HTMLTextAreaElement {
  rendered = render(editor(value, target));
  return field();
}

const field = () => rendered!.container.querySelector('textarea')!;
const status = () => rendered!.container.querySelector('.eg-notes__status')!.textContent;
const alert = () => rendered!.container.querySelector('[role="alert"]')?.textContent;
const text = () => rendered!.container.textContent;

/** Lets time pass, and every save answered meanwhile render. */
async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const focus = (element: HTMLElement) => act(() => element.focus());
const blur = (element: HTMLElement) => act(() => element.blur());

describe('saving as the DM types', () => {
  it('saves once, the whole text, NOTES_SAVE_DELAY_MS after typing stops, and says so quietly', async () => {
    const notes = show();
    await type(notes, 'L');
    await wait(200);
    await type(notes, 'Leader');
    await wait(200);
    await type(notes, 'Leader:\nflees at half HP');
    await wait(NOTES_SAVE_DELAY_MS - 1);
    expect(saves).toEqual([]);
    expect(status()).toBe(t('notes.unsaved'));
    await wait(1);
    expect(saves).toEqual(['Leader:\nflees at half HP']);
    expect(status()).toBe(t('notes.saved'));
    expect(alert()).toBeUndefined();
    // Nothing more to save: no second request.
    await wait(NOTES_SAVE_DELAY_MS * 4);
    expect(saves).toHaveLength(1);
    // There is no Save button.
    expect(rendered!.container.querySelector('button')).toBeNull();
  });

  it('says Saving… while the server has not answered', async () => {
    let finish = () => {};
    answer = () => new Promise((resolve) => (finish = resolve));
    const notes = show();
    await type(notes, 'Ambush');
    await wait(NOTES_SAVE_DELAY_MS);
    expect(status()).toBe(t('notes.saving'));
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(status()).toBe(t('notes.saved'));
  });

  it('saves at once when focus leaves the field', async () => {
    const notes = show();
    focus(notes);
    await type(notes, 'Trap on the stairs');
    blur(notes);
    await wait(0);
    expect(saves).toEqual(['Trap on the stairs']);
    // The timer the typing started sends nothing more.
    await wait(NOTES_SAVE_DELAY_MS);
    expect(saves).toHaveLength(1);
  });

  it('saves nothing when nothing changed', async () => {
    const notes = show('Kept');
    focus(notes);
    blur(notes);
    await type(notes, 'Kept');
    await wait(NOTES_SAVE_DELAY_MS);
    expect(saves).toEqual([]);
  });

  it('sends what was typed during a save once that save is answered, the last text winning', async () => {
    let finish = () => {};
    answer = () => new Promise((resolve) => (finish = resolve));
    const notes = show();
    await type(notes, 'One');
    await wait(NOTES_SAVE_DELAY_MS);
    await type(notes, 'One two');
    await wait(NOTES_SAVE_DELAY_MS);
    expect(saves).toEqual(['One']);
    answer = () => Promise.resolve();
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    await wait(0);
    expect(saves).toEqual(['One', 'One two']);
    expect(status()).toBe(t('notes.saved'));
  });
});

describe('never losing typed text', () => {
  it('keeps the text when a save fails, says why, and tries again with the next change', async () => {
    answer = () => Promise.reject(new ApiError(0, 'network'));
    const notes = show();
    await type(notes, 'Leader flees');
    await wait(NOTES_SAVE_DELAY_MS);
    expect(saves).toEqual(['Leader flees']);
    expect(notes.value).toBe('Leader flees');
    expect(alert()).toBe(t('notes.saveFailed', { reason: errorMessage('network') }));
    expect(unsavedDrafts()).toBe(1);
    // No retry of its own: the next change is the retry.
    await wait(NOTES_SAVE_DELAY_MS * 4);
    expect(saves).toHaveLength(1);
    answer = () => Promise.resolve();
    await type(notes, 'Leader flees at half HP');
    await wait(NOTES_SAVE_DELAY_MS);
    expect(saves).toEqual(['Leader flees', 'Leader flees at half HP']);
    expect(alert()).toBeUndefined();
    expect(status()).toBe(t('notes.saved'));
    expect(unsavedDrafts()).toBe(0);
  });

  it('tries a failed save again when focus leaves the field', async () => {
    answer = () => Promise.reject(new ApiError(500, 'internal_error'));
    const notes = show();
    focus(notes);
    await type(notes, 'Reinforcements on round 3');
    await wait(NOTES_SAVE_DELAY_MS);
    answer = () => Promise.resolve();
    blur(notes);
    await wait(0);
    expect(saves).toEqual(['Reinforcements on round 3', 'Reinforcements on round 3']);
    expect(alert()).toBeUndefined();
  });

  it('keeps a text over the limit without sending it, saying so, and saves it once it fits', async () => {
    const notes = show();
    const long = 'x'.repeat(NOTES_MAX_LENGTH + 5);
    await type(notes, long);
    await wait(NOTES_SAVE_DELAY_MS);
    blur(notes);
    await wait(0);
    expect(saves).toEqual([]);
    expect(notes.value).toBe(long);
    expect(notes.getAttribute('aria-invalid')).toBe('true');
    expect(alert()).toBe(t('notes.tooLong', { max: '20,000', count: '20,005' }));
    await type(notes, 'x'.repeat(NOTES_MAX_LENGTH));
    await wait(NOTES_SAVE_DELAY_MS);
    expect(saves).toEqual(['x'.repeat(NOTES_MAX_LENGTH)]);
    expect(notes.hasAttribute('aria-invalid')).toBe(false);
  });

  it('saves what waits when the field goes, and shows a text that could not be saved when it comes back', async () => {
    answer = () => Promise.reject(new ApiError(0, 'network'));
    const notes = show('', 'token:7');
    await type(notes, 'Has the key');
    rendered!.unmount();
    rendered = undefined;
    await wait(0);
    expect(saves).toEqual(['Has the key']);
    expect(unsavedDrafts()).toBe(1);

    // Opened again, it shows the text, still unsaved, and saves it.
    answer = () => Promise.resolve();
    const again = show('', 'token:7');
    expect(again.value).toBe('Has the key');
    await wait(0);
    expect(saves).toEqual(['Has the key', 'Has the key']);
    expect(unsavedDrafts()).toBe(0);
    expect(status()).toBe(t('notes.saved'));
  });

  it('asks the browser to keep the page while a text is unsaved', async () => {
    answer = () => Promise.reject(new ApiError(0, 'network'));
    const notes = show();
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);
    await type(notes, 'Unsaved');
    expect(leave()).toBe(true);
    answer = () => Promise.resolve();
    await type(notes, 'Saved now');
    await wait(NOTES_SAVE_DELAY_MS);
    expect(leave()).toBe(false);
  });
});

describe('a text from another window (last write wins on the server)', () => {
  it('replaces the text of a field that is neither focused nor unsaved', () => {
    show('Old');
    act(() => rendered!.rerender(editor('Written elsewhere')));
    expect(field().value).toBe('Written elsewhere');
    expect(text()).not.toContain(t('notes.changedElsewhere'));
  });

  it('never replaces a focused field, saying it changed in another window, and shows it once left', () => {
    const notes = show('Old');
    focus(notes);
    act(() => rendered!.rerender(editor('Written elsewhere')));
    expect(notes.value).toBe('Old');
    expect(text()).toContain(t('notes.changedElsewhere'));
    // Left with nothing unsaved: what the server holds is shown.
    blur(notes);
    expect(notes.value).toBe('Written elsewhere');
    expect(text()).not.toContain(t('notes.changedElsewhere'));
    expect(saves).toEqual([]);
  });

  it('never replaces unsaved text, and the DM’s save wins', async () => {
    const notes = show('Old');
    await type(notes, 'Mine');
    act(() => rendered!.rerender(editor('Theirs')));
    expect(notes.value).toBe('Mine');
    expect(text()).toContain(t('notes.changedElsewhere'));
    await wait(NOTES_SAVE_DELAY_MS);
    expect(saves).toEqual(['Mine']);
    expect(text()).not.toContain(t('notes.changedElsewhere'));
  });

  it('takes its own save coming back for no change elsewhere, though more was typed meanwhile', async () => {
    let finish = () => {};
    answer = () => new Promise((resolve) => (finish = resolve));
    const notes = show();
    focus(notes);
    await type(notes, 'First');
    await wait(NOTES_SAVE_DELAY_MS);
    await type(notes, 'First and more');
    // The live connection brings this window's own save before its answer.
    act(() => rendered!.rerender(editor('First')));
    expect(text()).not.toContain(t('notes.changedElsewhere'));
    expect(notes.value).toBe('First and more');
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(notes.value).toBe('First and more');
  });
});

describe('text only (specs/08-ux-journeys.md §13)', () => {
  const html = '<b>bold</b>\n<img src="x" onerror="alert(1)"><script>alert(2)</script>';

  it('shows an HTML string as written in the field', () => {
    show(html);
    expect(field().value).toBe(html);
    expect(rendered!.container.querySelector('b, img, script')).toBeNull();
  });

  it('shows read-only notes as text, line breaks kept, and long ones collapsed behind Show more', () => {
    rendered = render(createElement(ReadOnlyNotes, { heading: 'From Bandit (library)', text: html }));
    const paragraph = rendered.container.querySelector('p')!;
    expect(paragraph.textContent).toBe(html);
    expect(paragraph.children).toHaveLength(0);
    expect(rendered.container.querySelector('b, img, script')).toBeNull();
    expect(rendered.container.textContent).toContain('From Bandit (library)');

    rendered.unmount();
    const long = 'one\ntwo\nthree\nfour\nfive';
    rendered = render(createElement(ReadOnlyNotes, { heading: 'From Bandit (library)', text: long }));
    const more = rendered.container.querySelector('button')!;
    expect(more.textContent).toBe(t('notes.showMore'));
    expect(rendered.container.querySelector('p')!.className).toContain('eg-notes__text--clamped');
    act(() => more.click());
    expect(more.textContent).toBe(t('notes.showLess'));
    expect(rendered.container.querySelector('p')!.className).not.toContain('clamped');
  });

  it('shows nothing for an asset without notes', () => {
    rendered = render(createElement(ReadOnlyNotes, { heading: 'From Bandit (library)', text: '  \n' }));
    expect(rendered.container.textContent).toBe('');
  });
});
