import { Type, type Static } from 'typebox';
import { UuidSchema } from './entities.js';
import { NotesSchema } from './notes.js';

// Map notes (UXR-08; specs/03-domain-model.md §1, §10, specs/04-live-sync.md §3, §4, §16, specs/08-ux-journeys.md
// §14, Q-128). A note the DM pins at a point of a scene's map: its text and where it is, in decimal grid units like a
// token's position (specs/03-domain-model.md §4), the point being the icon's centre. The DM's only, as every note is:
// no players' snapshot or event carries one. They change over REST on any scene, the live one included, and are not
// undoable; a change on the live scene reaches the `dm` room as `mapNotes.updated`, the scene's whole list.

export const API_MAP_NOTE_PATHS = {
  sceneMapNotes: '/api/scenes/:id/map-notes',
  mapNote: '/api/map-notes/:id',
} as const;

// Bounded only against nonsense, as a token's position is.
const MapNoteCoordinateSchema = Type.Number({ minimum: -1e6, maximum: 1e6 });

export const MapNoteSchema = Type.Object(
  {
    id: UuidSchema,
    scene_id: UuidSchema,
    x: Type.Number(),
    y: Type.Number(),
    notes: Type.String(),
  },
  { additionalProperties: false },
);

/** POST of a new map note: where it goes, and its text, empty when left out. */
export const MapNoteCreateBodySchema = Type.Object(
  { x: MapNoteCoordinateSchema, y: MapNoteCoordinateSchema, notes: Type.Optional(NotesSchema) },
  { additionalProperties: false },
);

/** PATCH of a map note: a move, its text (the whole of it, last write winning), or both. */
export const MapNoteUpdateBodySchema = Type.Object(
  {
    x: Type.Optional(MapNoteCoordinateSchema),
    y: Type.Optional(MapNoteCoordinateSchema),
    notes: Type.Optional(NotesSchema),
  },
  { additionalProperties: false, minProperties: 1 },
);

/** `mapNotes.updated` (DM room only): the live scene's map notes, all of them, after a change. */
export const MapNotesUpdatedPayloadSchema = Type.Object(
  { scene_id: UuidSchema, map_notes: Type.Array(MapNoteSchema) },
  { additionalProperties: false },
);

export type MapNote = Static<typeof MapNoteSchema>;
export type MapNoteCreateBody = Static<typeof MapNoteCreateBodySchema>;
export type MapNoteUpdateBody = Static<typeof MapNoteUpdateBodySchema>;
export type MapNotesUpdatedPayload = Static<typeof MapNotesUpdatedPayloadSchema>;
