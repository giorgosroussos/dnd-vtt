import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import {
  API_MAP_NOTE_PATHS as PATHS,
  IdParamsSchema,
  MapNoteCreateBodySchema,
  MapNoteDeleteQuerySchema,
  MapNoteSchema,
  MapNoteUpdateBodySchema,
  type IdParams,
  type MapNoteCreateBody,
  type MapNoteDeleteQuery,
  type MapNoteUpdateBody,
} from '@emberglass/shared';
import { Type } from 'typebox';
import { createMapNote, deleteMapNote, listMapNotes, updateMapNote } from '../db/mapNotes.js';
import { ApiFailure } from './errors.js';

// Map notes over REST (UXR-08; specs/02-architecture.md §5, specs/03-domain-model.md §10, specs/04-live-sync.md §2,
// §16, Q-128). A scene's map notes at `/api/scenes/:id/map-notes` (GET, POST) and each at `/api/map-notes/:id`
// (PATCH, DELETE), on any scene, the live one included: like notes, they are neither setup nor a live command, and
// they are not undoable. Every route needs a DM session, which the /api guard of auth.ts checks before any of this
// runs, and every body is validated against the strict schemas of shared. On the live scene the DM room is told by
// `mapNotes.updated` (`mapNotesChanged`, ws/live.ts); the players room never is, nor does its version move. A DELETE
// with `if_empty=true` removes the note only while its stored text is empty or blank, and otherwise answers 409
// `map_note_not_empty`, changing nothing and telling no one: the DM view's removal of a note closed empty, which must
// never take one another window has written into since.

const notFound = (): ApiFailure => new ApiFailure(404, 'not_found', 'No such resource.');
const params = { params: IdParamsSchema };

export function registerMapNotes(
  app: FastifyInstance,
  db: Database.Database,
  mapNotesChanged: (sceneId: string) => void,
): void {
  app.get<{ Params: IdParams }>(
    PATHS.sceneMapNotes,
    { schema: { ...params, response: { 200: Type.Array(MapNoteSchema) } } },
    (request) => {
      const notes = listMapNotes(db, request.params.id);
      if (notes === undefined) throw notFound();
      return notes;
    },
  );

  app.post<{ Params: IdParams; Body: MapNoteCreateBody }>(
    PATHS.sceneMapNotes,
    { schema: { ...params, body: MapNoteCreateBodySchema, response: { 201: MapNoteSchema } } },
    async (request, reply) => {
      const note = createMapNote(db, request.params.id, request.body);
      if (note === undefined) throw notFound();
      mapNotesChanged(note.scene_id);
      return reply.code(201).send(note);
    },
  );

  app.patch<{ Params: IdParams; Body: MapNoteUpdateBody }>(
    PATHS.mapNote,
    { schema: { ...params, body: MapNoteUpdateBodySchema, response: { 200: MapNoteSchema } } },
    (request) => {
      const note = updateMapNote(db, request.params.id, request.body);
      if (note === undefined) throw notFound();
      mapNotesChanged(note.scene_id);
      return note;
    },
  );

  app.delete<{ Params: IdParams; Querystring: MapNoteDeleteQuery }>(
    PATHS.mapNote,
    { schema: { ...params, querystring: MapNoteDeleteQuerySchema } },
    async (request, reply) => {
      const note = deleteMapNote(db, request.params.id, { ifEmpty: request.query.if_empty === 'true' });
      if (note === undefined) throw notFound();
      if (note === 'not_empty') throw new ApiFailure(409, 'map_note_not_empty', 'The map note holds text.');
      mapNotesChanged(note.scene_id);
      return reply.code(204).send();
    },
  );
}
