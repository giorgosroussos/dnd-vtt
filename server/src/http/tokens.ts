import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import {
  API_TOKEN_PATHS as PATHS,
  IdParamsSchema,
  SceneTokenSchema,
  TokenCreateBodySchema,
  TokenChangeSchema,
  TokenUpdateBodySchema,
  type IdParams,
  type TokenCreateBody,
  type TokenUpdateBody,
} from '@emberglass/shared';
import { createToken, deleteToken, listTokens, updateToken } from '../db/tokens.js';
import { ApiFailure } from './errors.js';

// Tokens of a scene that is not live, over REST (PRP-04, specs/02-architecture.md §5,
// specs/05-assets-and-images.md §3–§5, specs/04-live-sync.md §2, D-015, D-078). Every route needs a
// DM session, which the /api guard of auth.ts checks before any of this runs, so a browser without
// one learns no scene, token or asset id. Bodies are validated against the strict schemas of
// shared; responses are serialised through them. A scene's tokens are listed and placed under
// `/api/scenes/:id/tokens`, and one token is changed or deleted at `/api/tokens/:id`, one level of
// nesting as scenes and sessions are (D-078). A write to a token of the live scene is refused as
// 409 `scene_live`: live tokens change only by the live commands of LIV-02.

const notFound = (): ApiFailure => new ApiFailure(404, 'not_found', 'No such resource.');
const live = (): ApiFailure =>
  new ApiFailure(409, 'scene_live', "The live scene's tokens change only by live commands.");

const params = { params: IdParamsSchema };

export function registerTokens(app: FastifyInstance, db: Database.Database): void {
  app.get<{ Params: IdParams }>(
    PATHS.sceneTokens,
    { schema: { ...params, response: { 200: Type.Array(SceneTokenSchema) } } },
    (request) => listTokens(db, request.params.id) ?? raise(notFound()),
  );

  app.post<{ Params: IdParams; Body: TokenCreateBody }>(
    PATHS.sceneTokens,
    { schema: { ...params, body: TokenCreateBodySchema, response: { 201: TokenChangeSchema } } },
    async (request, reply) => {
      const result = createToken(db, request.params.id, request.body);
      if (result.outcome === 'not_found') throw notFound();
      if (result.outcome === 'live') throw live();
      if (result.outcome === 'asset_not_found') {
        throw new ApiFailure(400, 'reference_not_found', 'The asset does not exist.');
      }
      return reply.code(201).send({ token: result.token, relabelled: result.relabelled });
    },
  );

  app.patch<{ Params: IdParams; Body: TokenUpdateBody }>(
    PATHS.token,
    { schema: { ...params, body: TokenUpdateBodySchema, response: { 200: TokenChangeSchema } } },
    (request) => {
      const { label, ...fields } = request.body;
      const result = updateToken(db, request.params.id, {
        ...fields,
        ...(label === undefined ? {} : { label: label.trim() }),
      });
      if (result.outcome === 'not_found') throw notFound();
      if (result.outcome === 'live') throw live();
      return { token: result.token, relabelled: result.relabelled };
    },
  );

  app.delete<{ Params: IdParams }>(PATHS.token, { schema: params }, async (request, reply) => {
    const result = deleteToken(db, request.params.id);
    if (result.outcome === 'not_found') throw notFound();
    if (result.outcome === 'live') throw live();
    return reply.code(204).send();
  });
}

function raise(failure: ApiFailure): never {
  throw failure;
}
