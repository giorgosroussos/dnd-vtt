import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { hasNotes, NOTES_MAX_LENGTH, notesLength } from '@emberglass/shared';
import { formatNumber } from '../../canvas/calibration.js';
import { errorMessage } from '../../ui/errorMessage.js';
import { t } from '../../ui/messages.js';
import { errorCode } from '../api.js';

// A DM notes field (DMT-04, specs/03-domain-model.md §10, specs/04-live-sync.md §16, specs/08-ux-journeys.md §13,
// D-186): plain text in a textarea, line breaks kept, with no Save button. It saves NOTES_SAVE_DELAY_MS after typing
// stops and when focus leaves it, saying so quietly beside it ("Saving…", "Saved"). Notes are not undoable, so until
// the server has the text this field is its only copy, and nothing here ever throws typed text away:
//
// - A refused or failed save keeps the text, says why, and is tried again on the next change or when focus leaves.
// - A text over NOTES_MAX_LENGTH characters is kept and not sent, with the limit and the count beside it.
// - Text not yet saved when the field goes (the popover closed, another scene opened) is saved then, and kept in
//   memory (`drafts`) until the server has it, so the field opened again shows it, still unsaved, and saves it.
// - The browser asks before leaving the page while any text is unsaved.
// - The value the server holds can change while the field is open: another DM window wrote it (last write wins on
//   the server). Received while the field has focus or holds unsaved text, it replaces nothing: "Changed in another
//   window" says so, and the DM's own text wins if they save it; once the field is left with nothing unsaved, it
//   shows what the server holds.
//
// The text is only ever a textarea's value, never markup, so an HTML string shows as written.

export const NOTES_SAVE_DELAY_MS = 500;
/** A note is long, and collapsible, past this many lines or characters. */
const LONG_LINES = 3;
const LONG_CHARS = 180;

export const isLongNote = (text: string): boolean =>
  text.split(/\r\n|\r|\n/).length > LONG_LINES || notesLength(text) > LONG_CHARS;

/** Text typed and not yet stored, by field, kept while its field is gone. */
const drafts = new Map<string, { text: string; base: string }>();

/** How many fields hold text the server does not have yet; for the tests. */
export const unsavedDrafts = (): number => drafts.size;
/** The text typed into the notes of `target` that the server does not hold yet, if any (UXR-08). */
export const unsavedText = (target: string): string | undefined => drafts.get(target)?.text;
/** Forgets every unsaved text; for the tests only. */
export const clearDrafts = (): void => drafts.clear();

const warnOnLeave = (event: BeforeUnloadEvent) => {
  if (drafts.size === 0) return;
  event.preventDefault();
  event.returnValue = '';
};

type Status = 'idle' | 'saving' | 'saved' | { failed: string };

export function NotesEditor({
  target,
  value,
  save,
  label,
  placeholder,
  rows = 6,
  collapsible = false,
  focus = 0,
  id,
}: {
  /** Which notes these are, `scene:<id>` or `token:<id>`: what an unsaved text is kept under. */
  target: string;
  /** The text the server holds, as this view last heard it. */
  value: string;
  /** Stores the whole text; rejects when the server did not. */
  save: (text: string) => Promise<void>;
  label: string;
  placeholder?: string | undefined;
  rows?: number;
  /** Long notes show a few lines, and Show more shows them all. */
  collapsible?: boolean;
  /** Raised each time the field is to take focus. */
  focus?: number;
  id?: string | undefined;
}) {
  const ownId = useId();
  const fieldId = id ?? `${ownId}-field`;
  const statusId = `${ownId}-status`;
  const errorId = `${ownId}-error`;
  const draft = drafts.get(target);
  const [text, setText] = useState(draft?.text ?? value);
  // The server's text the field was last in step with: what it holds once a save succeeds, or as received.
  const [base, setBase] = useState(draft?.base ?? value);
  const [status, setStatus] = useState<Status>('idle');
  const [elsewhere, setElsewhere] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  // What the callbacks below read, written as soon as anything changes rather than at the next render.
  const now = useRef({
    text,
    base,
    value,
    focused: false,
    inflight: false,
    again: false,
    sent: undefined as string | undefined,
  });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latestSave = useRef(save);
  useLayoutEffect(() => {
    latestSave.current = save;
  });
  const mounted = useRef(true);

  const tooLong = notesLength(text) > NOTES_MAX_LENGTH;
  const dirty = text !== base;

  const remember = () => {
    const { text: typed, base: stored } = now.current;
    if (typed === stored) drafts.delete(target);
    else drafts.set(target, { text: typed, base: stored });
  };

  async function flush(): Promise<void> {
    clearTimeout(timer.current);
    timer.current = undefined;
    const state = now.current;
    const sending = state.text;
    if (sending === state.base || notesLength(sending) > NOTES_MAX_LENGTH) return;
    if (state.inflight) {
      state.again = true;
      return;
    }
    state.inflight = true;
    state.sent = sending;
    if (mounted.current) setStatus('saving');
    try {
      await latestSave.current(sending);
      state.base = sending;
      remember();
      if (mounted.current) {
        setBase(sending);
        setStatus('saved');
        // Last write wins: what another window wrote is gone now.
        setElsewhere(false);
      }
    } catch (error) {
      remember();
      if (mounted.current) setStatus({ failed: errorMessage(errorCode(error)) });
    } finally {
      state.inflight = false;
      if (state.again) {
        state.again = false;
        if (state.text !== state.base) void flush();
      }
    }
  }

  function change(next: string) {
    setText(next);
    now.current.text = next;
    remember();
    clearTimeout(timer.current);
    // A failure is tried again with this change; an over-long text waits until it fits.
    if (notesLength(next) > NOTES_MAX_LENGTH) return;
    if (typeof status === 'object' || status === 'saved') setStatus('idle');
    timer.current = setTimeout(() => void flush(), NOTES_SAVE_DELAY_MS);
  }

  /** Shows what the server holds when nothing typed here is waiting for it. */
  function adopt(next: string) {
    const state = now.current;
    state.text = next;
    state.base = next;
    drafts.delete(target);
    setText(next);
    setBase(next);
    setElsewhere(false);
  }

  // A text from the server: this window's own save coming back, or another window's.
  useEffect(() => {
    const state = now.current;
    state.value = value;
    if (value === state.base) return;
    if (value === state.text) {
      // In step with what is typed: whoever wrote it, the server has it now.
      state.base = value;
      remember();
      setBase(value);
      setElsewhere(false);
      return;
    }
    // This window's own save arriving by the live connection before its answer: nothing changed elsewhere.
    if (value === state.sent && state.inflight) return;
    if (state.focused || state.text !== state.base || state.inflight) {
      setElsewhere(true);
      return;
    }
    adopt(value);
    // `remember` and `adopt` read only refs and `target`, which keys the field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // A text kept from before the field went is saved as soon as it is back.
  useEffect(() => {
    if (now.current.text !== now.current.base) void flush();
    // Once, when the field appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving: what waits is sent now, and kept until the server has it.
  useEffect(() => {
    const state = now.current;
    mounted.current = true;
    window.addEventListener('beforeunload', warnOnLeave);
    return () => {
      mounted.current = false;
      window.removeEventListener('beforeunload', warnOnLeave);
      if (state.text !== state.base) void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (focus > 0) field.current?.focus();
  }, [focus]);

  const long = collapsible && isLongNote(text);
  // Collapsed, a long note shows a few lines; shown in full, room for it all.
  const shownRows = !long ? rows : expanded ? Math.max(rows, 12) : Math.min(rows, LONG_LINES);
  const said = tooLong
    ? undefined
    : typeof status === 'object'
      ? undefined
      : status === 'saving'
        ? t('notes.saving')
        : status === 'saved' && !dirty
          ? t('notes.saved')
          : dirty
            ? t('notes.unsaved')
            : undefined;
  const failure = tooLong
    ? t('notes.tooLong', { max: formatNumber(NOTES_MAX_LENGTH), count: formatNumber(notesLength(text)) })
    : typeof status === 'object'
      ? t('notes.saveFailed', { reason: status.failed })
      : undefined;

  return (
    <div className="eg-notes" data-notes={target}>
      <textarea
        ref={field}
        id={fieldId}
        className="eg-notes__field"
        aria-label={label}
        aria-invalid={tooLong || undefined}
        aria-describedby={[statusId, failure ? errorId : ''].filter(Boolean).join(' ')}
        placeholder={placeholder}
        rows={shownRows}
        spellCheck
        value={text}
        onChange={(event) => change(event.target.value)}
        onFocus={() => {
          now.current.focused = true;
        }}
        onBlur={() => {
          const state = now.current;
          state.focused = false;
          if (state.text !== state.base) void flush();
          else if (state.value !== state.text && !state.inflight) adopt(state.value);
        }}
      />
      <div className="eg-notes__foot">
        {/* A polite live region of its own, not a second role="status": the scene keeps one status line. */}
        <span id={statusId} className="eg-notes__status" aria-live="polite">
          {said}
        </span>
        {elsewhere ? <span className="eg-notes__elsewhere">{t('notes.changedElsewhere')}</span> : null}
        {long ? (
          <button
            type="button"
            className="eg-notes__more"
            aria-expanded={expanded}
            aria-controls={fieldId}
            onClick={() => setExpanded(!expanded)}
          >
            {t(expanded ? 'notes.showLess' : 'notes.showMore')}
          </button>
        ) : null}
      </div>
      {failure ? (
        <p id={errorId} className="eg-notes__error" role="alert">
          {failure}
        </p>
      ) : null}
    </div>
  );
}

/** Read-only notes, an asset's beside its token's: text only, line breaks kept, long ones collapsed to a few lines. */
export function ReadOnlyNotes({ heading, text }: { heading: string; text: string }) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  if (!hasNotes(text)) return null;
  const long = isLongNote(text);
  return (
    <section className="eg-notes__readonly" aria-labelledby={`${id}-heading`}>
      <h4 id={`${id}-heading`} className="eg-notes__from">
        {heading}
      </h4>
      <p id={`${id}-text`} className={long && !expanded ? 'eg-notes__text eg-notes__text--clamped' : 'eg-notes__text'}>
        {text}
      </p>
      {long ? (
        <button
          type="button"
          className="eg-notes__more"
          aria-expanded={expanded}
          aria-controls={`${id}-text`}
          onClick={() => setExpanded(!expanded)}
        >
          {t(expanded ? 'notes.showLess' : 'notes.showMore')}
        </button>
      ) : null}
    </section>
  );
}
