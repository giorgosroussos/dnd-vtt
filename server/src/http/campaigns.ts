import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import {
  API_STRUCTURE_PATHS as PATHS,
  CampaignCreateBodySchema,
  CampaignSchema,
  CampaignUpdateBodySchema,
  DeleteBodySchema,
  DeletionSummarySchema,
  IdParamsSchema,
  OrderBodySchema,
  SceneCreateBodySchema,
  SceneDuplicateBodySchema,
  SceneSchema,
  SceneUpdateBodySchema,
  SessionCreateBodySchema,
  SessionSchema,
  SessionUpdateBodySchema,
  isCalendarDate,
  type CampaignCreateBody,
  type CampaignUpdateBody,
  type DeleteBody,
  type IdParams,
  type OrderBody,
  type SceneCreateBody,
  type SceneDuplicateBody,
  type SceneUpdateBody,
  type SessionCreateBody,
  type SessionUpdateBody,
} from '@emberglass/shared';
import {
  createCampaign,
  createScene,
  createSession,
  deleteEntity,
  deletionSummary,
  duplicateScene,
  listCampaigns,
  listScenes,
  listSessions,
  readCampaign,
  readScene,
  readSession,
  renameScene,
  reorderScenes,
  reorderSessions,
  updateCampaign,
  updateSession,
  type DeletionTarget,
} from '../db/campaigns.js';
import { ApiFailure } from './errors.js';

// Campaigns, sessions and scenes over REST (SRV-03, specs/02-architecture.md §5,
// specs/03-domain-model.md §2, §3, §5, §6, §7, D-015, D-078). Every route needs a
// DM session, which the /api guard of auth.ts checks before any of this runs.
// Bodies are validated against the strict schemas of shared, so a body naming
// its own id or any unknown field is refused before anything is stored, and
// every response is serialised through the entity schemas.

const notFound = (): ApiFailure => new ApiFailure(404, 'not_found', 'No such resource.');
const orderMismatch = (): ApiFailure =>
  new ApiFailure(409, 'order_mismatch', 'The order must name every child of the parent exactly once.');
const confirmationMismatch = (): ApiFailure =>
  new ApiFailure(409, 'confirmation_mismatch', 'What the deletion removes has changed since it was confirmed.');

// A date that matches the pattern but does not exist, 2026-02-30, would fail the
// CHECK of migration 0001 as a server error; it is a validation failure.
function checkDate(date: string | null | undefined): void {
  if (typeof date === 'string' && !isCalendarDate(date)) {
    throw new ApiFailure(400, 'validation_failed', 'The body does not match its schema.', {
      details: [{ path: '/date', message: 'must be a calendar date' }],
    });
  }
}

const params = { params: IdParamsSchema };

/**
 * `removeImages` removes the files of the map images a deletion left unreferenced, once the
 * deletion has committed (specs/03-domain-model.md §7, Q-002).
 */
export function registerCampaigns(
  app: FastifyInstance,
  db: Database.Database,
  removeImages: (ids: readonly string[]) => void,
): void {
  const requireCampaign = (id: string) => readCampaign(db, id) ?? raise(notFound());
  const requireSession = (id: string) => readSession(db, id) ?? raise(notFound());
  const requireScene = (id: string) => readScene(db, id) ?? raise(notFound());

  // Campaigns

  app.get(PATHS.campaigns, { schema: { response: { 200: Type.Array(CampaignSchema) } } }, () => listCampaigns(db));

  app.post<{ Body: CampaignCreateBody }>(
    PATHS.campaigns,
    { schema: { body: CampaignCreateBodySchema, response: { 201: CampaignSchema } } },
    async (request, reply) => reply.code(201).send(createCampaign(db, request.body)),
  );

  app.get<{ Params: IdParams }>(
    PATHS.campaign,
    { schema: { ...params, response: { 200: CampaignSchema } } },
    (request) => requireCampaign(request.params.id),
  );

  app.patch<{ Params: IdParams; Body: CampaignUpdateBody }>(
    PATHS.campaign,
    { schema: { ...params, body: CampaignUpdateBodySchema, response: { 200: CampaignSchema } } },
    (request) => updateCampaign(db, request.params.id, request.body) ?? raise(notFound()),
  );

  // Sessions

  app.get<{ Params: IdParams }>(
    PATHS.sessions,
    { schema: { ...params, response: { 200: Type.Array(SessionSchema) } } },
    (request) => {
      requireCampaign(request.params.id);
      return listSessions(db, request.params.id);
    },
  );

  app.post<{ Params: IdParams; Body: SessionCreateBody }>(
    PATHS.sessions,
    { schema: { ...params, body: SessionCreateBodySchema, response: { 201: SessionSchema } } },
    async (request, reply) => {
      requireCampaign(request.params.id);
      checkDate(request.body.date);
      return reply.code(201).send(createSession(db, request.params.id, request.body));
    },
  );

  app.put<{ Params: IdParams; Body: OrderBody }>(
    PATHS.sessionOrder,
    { schema: { ...params, body: OrderBodySchema, response: { 200: Type.Array(SessionSchema) } } },
    (request) => {
      requireCampaign(request.params.id);
      if (!reorderSessions(db, request.params.id, request.body.ids)) throw orderMismatch();
      return listSessions(db, request.params.id);
    },
  );

  app.get<{ Params: IdParams }>(PATHS.session, { schema: { ...params, response: { 200: SessionSchema } } }, (request) =>
    requireSession(request.params.id),
  );

  app.patch<{ Params: IdParams; Body: SessionUpdateBody }>(
    PATHS.session,
    { schema: { ...params, body: SessionUpdateBodySchema, response: { 200: SessionSchema } } },
    (request) => {
      checkDate(request.body.date);
      return updateSession(db, request.params.id, request.body) ?? raise(notFound());
    },
  );

  // Scenes

  app.get<{ Params: IdParams }>(
    PATHS.scenes,
    { schema: { ...params, response: { 200: Type.Array(SceneSchema) } } },
    (request) => {
      requireSession(request.params.id);
      return listScenes(db, request.params.id);
    },
  );

  app.post<{ Params: IdParams; Body: SceneCreateBody }>(
    PATHS.scenes,
    { schema: { ...params, body: SceneCreateBodySchema, response: { 201: SceneSchema } } },
    async (request, reply) => {
      requireSession(request.params.id);
      const scene = createScene(db, request.params.id, request.body);
      if (scene === undefined) throw new ApiFailure(400, 'reference_not_found', 'The map image does not exist.');
      return reply.code(201).send(scene);
    },
  );

  app.put<{ Params: IdParams; Body: OrderBody }>(
    PATHS.sceneOrder,
    { schema: { ...params, body: OrderBodySchema, response: { 200: Type.Array(SceneSchema) } } },
    (request) => {
      requireSession(request.params.id);
      if (!reorderScenes(db, request.params.id, request.body.ids)) throw orderMismatch();
      return listScenes(db, request.params.id);
    },
  );

  app.get<{ Params: IdParams }>(PATHS.scene, { schema: { ...params, response: { 200: SceneSchema } } }, (request) =>
    requireScene(request.params.id),
  );

  app.patch<{ Params: IdParams; Body: SceneUpdateBody }>(
    PATHS.scene,
    { schema: { ...params, body: SceneUpdateBodySchema, response: { 200: SceneSchema } } },
    (request) => renameScene(db, request.params.id, request.body.name) ?? raise(notFound()),
  );

  app.post<{ Params: IdParams; Body: SceneDuplicateBody }>(
    PATHS.sceneDuplicate,
    { schema: { ...params, body: SceneDuplicateBodySchema, response: { 201: SceneSchema } } },
    async (request, reply) => {
      const copy = duplicateScene(db, request.params.id, request.body.name) ?? raise(notFound());
      return reply.code(201).send(copy);
    },
  );

  // Deletion: GET …/deletion states what goes, DELETE sends it back as the
  // confirmation (specs/03-domain-model.md §7).

  const deletion = (target: DeletionTarget, summaryPath: string, entityPath: string): void => {
    app.get<{ Params: IdParams }>(
      summaryPath,
      { schema: { ...params, response: { 200: DeletionSummarySchema } } },
      (request) => deletionSummary(db, target, request.params.id) ?? raise(notFound()),
    );
    app.delete<{ Params: IdParams; Body: DeleteBody }>(
      entityPath,
      { schema: { ...params, body: DeleteBodySchema } },
      async (request, reply) => {
        const result = deleteEntity(db, target, request.params.id, request.body.confirm);
        if (result.outcome === 'not_found') throw notFound();
        if (result.outcome === 'mismatch') throw confirmationMismatch();
        removeImages(result.removedImages);
        return reply.code(204).send();
      },
    );
  };
  deletion('campaign', PATHS.campaignDeletion, PATHS.campaign);
  deletion('session', PATHS.sessionDeletion, PATHS.session);
  deletion('scene', PATHS.sceneDeletion, PATHS.scene);
}

function raise(failure: ApiFailure): never {
  throw failure;
}
