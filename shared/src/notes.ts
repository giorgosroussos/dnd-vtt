import { Type, type Static } from 'typebox';
import { UuidSchema } from './entities.js';

// DM notes (DMT-04; specs/03-domain-model.md §10, specs/04-live-sync.md §3, §4, §16, specs/08-ux-journeys.md §13,
// Q-114, D-181, D-186). Every scene and every token carries a `notes` text, empty by default, the DM's only: no
// players' snapshot or event carries it, nor an asset's notes. Notes are plain text, line breaks kept, and change
// over REST on any scene, the live one included, with one route each for a scene's and a token's; neither change is
// undoable. A change on the live scene reaches the `dm` room as `notes.updated`, never the players room.

/** The most characters a notes text may hold: a few pages, far more than a note at the table needs. */
export const NOTES_MAX_LENGTH = 20_000;

/** A notes text as a REST body sends it; the schema counts characters as JSON Schema does, by code point. */
export const NotesSchema = Type.String({ maxLength: NOTES_MAX_LENGTH });

export const API_NOTES_PATHS = {
  sceneNotes: '/api/scenes/:id/notes',
  tokenNotes: '/api/tokens/:id/notes',
} as const;

/** PUT of a scene's or a token's notes: the whole text after the change, last write winning. */
export const NotesBodySchema = Type.Object({ notes: NotesSchema }, { additionalProperties: false });

/**
 * `notes.updated` (DM room only): the live scene's notes, `token_id` null, or one of its tokens' notes, the whole
 * text as stored.
 */
export const NotesUpdatedPayloadSchema = Type.Object(
  { scene_id: UuidSchema, token_id: Type.Union([UuidSchema, Type.Null()]), notes: Type.String() },
  { additionalProperties: false },
);

/** The length of a notes text as the server counts it: in code points, so an emoji is one character. */
export const notesLength = (text: string): number => [...text].length;

/** Whether a notes text says anything: white space alone does not. */
export const hasNotes = (text: string | undefined | null): boolean => typeof text === 'string' && text.trim() !== '';

/**
 * The first lines of a notes text, for a hover text: at most `lines` lines that are not blank, each cut to `width`
 * characters, an ellipsis marking what is left out.
 */
export function notesPreview(text: string, lines = 3, width = 80): string {
  const kept = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');
  const cut = (line: string) => {
    const chars = [...line];
    return chars.length > width ? `${chars.slice(0, width - 1).join('')}…` : line;
  };
  const shown = kept.slice(0, lines).map(cut);
  if (kept.length > lines) shown[shown.length - 1] = `${shown.at(-1)!.replace(/…$/, '')}…`;
  return shown.join('\n');
}

export type NotesBody = Static<typeof NotesBodySchema>;
export type NotesUpdatedPayload = Static<typeof NotesUpdatedPayloadSchema>;
