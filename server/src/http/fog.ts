import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import {
  API_FOG_PATHS as PATHS,
  FogMaskSchema,
  FogWriteBodySchema,
  IdParamsSchema,
  type FogWriteBody,
  type IdParams,
} from '@emberglass/shared';
import { readScene } from '../db/campaigns.js';
import { readFog, writeFog } from '../db/fog.js';
import { ApiFailure } from './errors.js';

// The painted fog of a scene that is not live, over REST (TBL-04, specs/02-architecture.md §5,
// specs/03-domain-model.md §1, specs/04-live-sync.md §2, §13, Q-101): read, and painted, erased, filled or
// cleared, at `/api/scenes/:id/fog`. Every route needs a DM session (the /api guard of auth.ts). A write to
// the live scene's fog is refused as 409 `scene_live`: the live scene's fog changes only by the fog
// commands, so that what players see changes through the live projection alone. A write may renumber
// tokens it lets players see for the first time (Q-092, Q-096); the DM view reads the scene's tokens again
// after one. Preparation has no undo, as no preparation edit has (D-154).

const notFound = (): ApiFailure => new ApiFailure(404, 'not_found', 'No such resource.');
const live = (): ApiFailure => new ApiFailure(409, 'scene_live', "The live scene's fog changes only by live commands.");

const params = { params: IdParamsSchema };

export function registerFog(app: FastifyInstance, db: Database.Database): void {
  app.get<{ Params: IdParams }>(
    PATHS.sceneFog,
    { schema: { ...params, response: { 200: FogMaskSchema } } },
    (request) => {
      if (readScene(db, request.params.id) === undefined) throw notFound();
      return readFog(db, request.params.id);
    },
  );

  app.post<{ Params: IdParams; Body: FogWriteBody }>(
    PATHS.sceneFog,
    { schema: { ...params, body: FogWriteBodySchema, response: { 200: FogMaskSchema } } },
    (request) => {
      const result = writeFog(db, request.params.id, request.body);
      if (result.outcome === 'not_found') throw notFound();
      if (result.outcome === 'too_large') {
        throw new ApiFailure(413, 'payload_too_large', 'The fog would be too large.');
      }
      if (result.outcome === 'live' || result.outcome === 'not_live') throw live();
      return result.fog;
    },
  );
}
