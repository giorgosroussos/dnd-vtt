import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import {
  API_REGION_PATHS as PATHS,
  IdParamsSchema,
  RegionCreateBodySchema,
  RegionSchema,
  RegionUpdateBodySchema,
  type IdParams,
  type RegionCreateBody,
  type RegionUpdateBody,
} from '@emberglass/shared';
import { createRegion, deleteRegion, listRegions, updateRegion, type RegionWriteOutcome } from '../db/regions.js';
import { ApiFailure } from './errors.js';

// Fog regions of a scene that is not live, over REST (TBL-03, specs/02-architecture.md §5,
// specs/03-domain-model.md §1, specs/04-live-sync.md §2, §13, Q-099): listed and drawn under
// `/api/scenes/:id/regions`, renamed, fogged or revealed and deleted at `/api/regions/:id`, as tokens are.
// Every route needs a DM session (the /api guard of auth.ts). A write to a region of the live scene is
// refused as 409 `scene_live`: the live scene's fog changes only by the region commands, so that what
// players see changes through the live projection alone. A write may renumber tokens it lets players see
// for the first time (Q-092, Q-096); the DM view reads the scene's tokens again after one.

const notFound = (): ApiFailure => new ApiFailure(404, 'not_found', 'No such resource.');
const live = (): ApiFailure =>
  new ApiFailure(409, 'scene_live', "The live scene's fog regions change only by live commands.");

const params = { params: IdParamsSchema };

function written(result: RegionWriteOutcome) {
  if (result.outcome === 'not_found') throw notFound();
  if (result.outcome !== 'written') throw live();
  return result.region;
}

export function registerRegions(app: FastifyInstance, db: Database.Database): void {
  app.get<{ Params: IdParams }>(
    PATHS.sceneRegions,
    { schema: { ...params, response: { 200: Type.Array(RegionSchema) } } },
    (request) => {
      const regions = listRegions(db, request.params.id);
      if (regions === undefined) throw notFound();
      return regions;
    },
  );

  app.post<{ Params: IdParams; Body: RegionCreateBody }>(
    PATHS.sceneRegions,
    { schema: { ...params, body: RegionCreateBodySchema, response: { 201: RegionSchema } } },
    async (request, reply) => reply.code(201).send(written(createRegion(db, request.params.id, request.body))),
  );

  app.patch<{ Params: IdParams; Body: RegionUpdateBody }>(
    PATHS.region,
    { schema: { ...params, body: RegionUpdateBodySchema, response: { 200: RegionSchema } } },
    (request) => written(updateRegion(db, request.params.id, request.body)),
  );

  app.delete<{ Params: IdParams }>(PATHS.region, { schema: params }, async (request, reply) => {
    written(deleteRegion(db, request.params.id));
    return reply.code(204).send();
  });
}
