import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import {
  API_NOTES_PATHS as PATHS,
  IdParamsSchema,
  NotesBodySchema,
  SceneSchema,
  SceneTokenSchema,
  type IdParams,
  type NotesBody,
  type NotesUpdatedPayload,
} from '@emberglass/shared';
import { updateSceneNotes } from '../db/campaigns.js';
import { updateTokenNotes } from '../db/tokens.js';
import { ApiFailure } from './errors.js';

// DM notes over REST (DMT-04; specs/02-architecture.md §5, specs/03-domain-model.md §10, specs/04-live-sync.md §2,
// §16, Q-114, D-181, D-186). A scene's notes at `/api/scenes/:id/notes` and a token's at `/api/tokens/:id/notes`, each
// PUT with the whole text, last write winning, on any scene, the live one included: notes are neither setup, which the
// live scene pushes to both rooms as a snapshot, nor a live command, and they are not undoable. Every route needs a DM
// session, which the /api guard of auth.ts checks before any of this runs. The body is validated against the strict
// schema of shared, so a text over the limit is refused before anything is stored. On the live scene the DM room is
// told by `notes.updated` (`notesChanged`, ws/live.ts); the players room never is, nor does its version move.

const notFound = (): ApiFailure => new ApiFailure(404, 'not_found', 'No such resource.');
const params = { params: IdParamsSchema };

export function registerNotes(
  app: FastifyInstance,
  db: Database.Database,
  notesChanged: (payload: NotesUpdatedPayload) => void,
): void {
  app.put<{ Params: IdParams; Body: NotesBody }>(
    PATHS.sceneNotes,
    { schema: { ...params, body: NotesBodySchema, response: { 200: SceneSchema } } },
    (request) => {
      const scene = updateSceneNotes(db, request.params.id, request.body.notes);
      if (scene === undefined) throw notFound();
      notesChanged({ scene_id: scene.id, token_id: null, notes: scene.notes });
      return scene;
    },
  );

  app.put<{ Params: IdParams; Body: NotesBody }>(
    PATHS.tokenNotes,
    { schema: { ...params, body: NotesBodySchema, response: { 200: SceneTokenSchema } } },
    (request) => {
      const token = updateTokenNotes(db, request.params.id, request.body.notes);
      if (token === undefined) throw notFound();
      notesChanged({ scene_id: token.scene_id, token_id: token.id, notes: token.notes });
      return token;
    },
  );
}
