import { useEffect, useId, useRef, useState } from 'react';
import { hasNotes, type MapNote } from '@emberglass/shared';
import type { TokenAnchor } from '../../canvas/MapCanvas.js';
import { Button } from '../../ui/Button.js';
import { t } from '../../ui/messages.js';
import { PreviewCard } from '../PreviewCard.js';
import { placement } from '../tokens/TokenPopover.js';
import { NotesEditor } from './NotesEditor.js';

// A map note's popover and preview in the DM view (UXR-08, specs/08-ux-journeys.md §14, Q-128). The popover sits
// beside the note's icon as a token's does: the note's text, read and edited there and saved as typed, and Delete,
// asked first in the popover itself; Escape closes it. The preview is the whole text, read-only, in a PreviewCard.
// The DM's view only: map notes never reach the TV.

const WIDTH = 272;

/** The draft key of a map note's text, under which NotesEditor keeps what the server does not hold yet. */
export const mapNoteTarget = (id: string): string => `mapnote:${id}`;

export function MapNotePopover({
  note,
  anchor,
  focus,
  onSave,
  onDelete,
  onClose,
}: {
  note: MapNote;
  anchor: TokenAnchor;
  /** Raised each time the text is to take focus: a note just placed. */
  focus: number;
  onSave: (text: string) => Promise<void>;
  onDelete: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const { left, top, maxHeight, side } = placement(anchor, WIDTH);
  const [confirming, setConfirming] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) keep.current?.focus();
  }, [confirming]);
  return (
    <section
      className={`eg-note-popover eg-popover--${side}`}
      style={{ left, top, width: WIDTH, maxHeight, overflowX: 'hidden', overflowY: 'auto' }}
      aria-labelledby={`${id}-heading`}
      data-map-note={note.id}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        if (confirming) setConfirming(false);
        else onClose();
      }}
    >
      <div className="eg-popover__head">
        <h2 id={`${id}-heading`} className="eg-popover__name">
          {t('mapNotes.heading')}
        </h2>
        <p className="eg-popover__seen eg-popover__seen--hidden">
          <span className="eg-popover__dot" aria-hidden="true" />
          {t('mapNotes.onlyYou')}
        </p>
      </div>
      <NotesEditor
        key={note.id}
        target={mapNoteTarget(note.id)}
        value={note.notes}
        label={t('mapNotes.label')}
        placeholder={t('mapNotes.placeholder')}
        rows={6}
        focus={focus}
        save={onSave}
      />
      {confirming ? (
        <div className="eg-note-popover__confirm" role="group" aria-label={t('mapNotes.confirmDelete')}>
          <p>{t('mapNotes.confirmDelete')}</p>
          <div className="eg-note-popover__actions">
            <Button variant="danger" size="small" onClick={onDelete}>
              {t('mapNotes.delete')}
            </Button>
            <Button ref={keep} size="small" onClick={() => setConfirming(false)}>
              {t('mapNotes.keep')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="eg-note-popover__actions">
          <Button size="small" onClick={() => setConfirming(true)}>
            {t('mapNotes.deleteNote')}
          </Button>
        </div>
      )}
    </section>
  );
}

/** The whole of a map note's text, read-only, when the mouse rests on its icon. */
export function MapNotePreview({ note, anchor }: { note: MapNote; anchor: TokenAnchor }) {
  return (
    <PreviewCard anchor={anchor} content={note} label={t('mapNotes.previewOf')} id={note.id}>
      <p className="eg-preview__name">{t('mapNotes.heading')}</p>
      {hasNotes(note.notes) ? (
        <p className="eg-preview__text">{note.notes}</p>
      ) : (
        <p className="eg-popover__note">{t('mapNotes.empty')}</p>
      )}
      <p className="eg-popover__note">{t('mapNotes.clickToEdit')}</p>
    </PreviewCard>
  );
}
