import { useId } from 'react';
import { API_NOTES_PATHS, hasNotes, notesPreview, type Scene, type SceneToken } from '@emberglass/shared';
import { Icon } from '../../ui/icons.js';
import { t } from '../../ui/messages.js';
import { request } from '../api.js';
import { NotesEditor, ReadOnlyNotes } from './NotesEditor.js';

// Where the DM reads and writes notes (DMT-04, specs/03-domain-model.md §10, specs/08-ux-journeys.md §13): the
// scene's in the right-hand panel's Notes tab, a token's in its popover with its asset's beside them, read-only, and a
// small page mark wherever a token with notes is listed, its first lines on hover. Every scene, live or not: notes are
// saved over REST on either (specs/04-live-sync.md §16). The DM view only; nothing here is drawn on the TV.

export const sceneNotesPath = (id: string): string => API_NOTES_PATHS.sceneNotes.replace(':id', encodeURIComponent(id));
export const tokenNotesPath = (id: string): string => API_NOTES_PATHS.tokenNotes.replace(':id', encodeURIComponent(id));

/** Whether the token has notes of its own or from its asset. */
export const tokenHasNotes = (token: SceneToken): boolean => hasNotes(token.notes) || hasNotes(token.asset.notes);

/** The first lines of a token's notes, its own first, then its asset's: a hover text. */
export function tokenNotesPreview(token: SceneToken): string | undefined {
  if (!tokenHasNotes(token)) return undefined;
  const own = hasNotes(token.notes) ? notesPreview(token.notes) : '';
  const asset = hasNotes(token.asset.notes)
    ? `${t('notes.fromAsset', { name: token.asset.name })}: ${notesPreview(token.asset.notes, 2)}`
    : '';
  return [own, asset].filter(Boolean).join('\n');
}

/** The scene's notes, the Notes tab of the right-hand panel. */
export function SceneNotes({
  scene,
  focus,
  onSaved,
}: {
  scene: Scene;
  /** Raised each time N asks for the field. */
  focus: number;
  /** The scene as the server stored it. */
  onSaved: (scene: Scene) => void;
}) {
  const id = useId();
  return (
    <section className="eg-scene-notes" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="eg-scene-notes__heading">
        {t('notes.sceneLabel', { name: scene.name })}
      </h2>
      <NotesEditor
        key={scene.id}
        target={`scene:${scene.id}`}
        value={scene.notes}
        label={t('notes.sceneLabel', { name: scene.name })}
        placeholder={t('notes.scenePlaceholder')}
        rows={14}
        focus={focus}
        save={async (text) => onSaved(await request<Scene>('PUT', sceneNotesPath(scene.id), { notes: text }))}
      />
      <p className="eg-scene-notes__hint">{t('notes.sceneHint')}</p>
    </section>
  );
}

/** A token's notes in its popover, its asset's under them, read-only and named as the library's. */
export function TokenNotes({
  token,
  focus,
  onSaved,
}: {
  token: SceneToken;
  /** Raised each time the field is asked for: from the initiative order on the token's turn. */
  focus: number;
  onSaved: (token: SceneToken) => void;
}) {
  const id = useId();
  return (
    <div className="eg-popover__notes" role="group" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`} className="eg-popover__label">
        {t('notes.tokenHeading')}
      </h3>
      <NotesEditor
        key={token.id}
        target={`token:${token.id}`}
        value={token.notes}
        label={t('notes.tokenLabel', { label: token.label })}
        placeholder={t('notes.tokenPlaceholder')}
        rows={4}
        collapsible
        focus={focus}
        save={async (text) => onSaved(await request<SceneToken>('PUT', tokenNotesPath(token.id), { notes: text }))}
      />
      <ReadOnlyNotes heading={t('notes.fromAsset', { name: token.asset.name })} text={token.asset.notes} />
    </div>
  );
}

/** A row's mark for a token with notes: a small page, its first lines as its hover text. */
export function NoteMark({ token }: { token: SceneToken }) {
  const preview = tokenNotesPreview(token);
  if (preview === undefined) return null;
  return (
    <span className="eg-note-mark" title={preview} data-note-mark="">
      <Icon name="note" size={13} />
      <span className="eg-visually-hidden">{t('notes.has')}</span>
    </span>
  );
}
