import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import {
  API_ASSET_PATHS as PATHS,
  AssetCreateBodySchema,
  AssetListQuerySchema,
  AssetUpdateBodySchema,
  AssetUsagesSchema,
  IdParamsSchema,
  LibraryAssetSchema,
  normalizeTag,
  type AssetCreateBody,
  type AssetListQuery,
  type AssetUpdateBody,
  type IdParams,
} from '@emberglass/shared';
import { Type } from 'typebox';
import { assetUsages, createAsset, deleteAsset, listAssets, readAsset, updateAsset } from '../db/assets.js';
import { ApiFailure } from './errors.js';

// The shared asset library over REST (SRV-05, specs/02-architecture.md §5,
// specs/03-domain-model.md §7, specs/05-assets-and-images.md §1, §2, §4, §5, D-020,
// D-022, D-083). Every route needs a DM session, which the /api guard of auth.ts
// checks before any of this runs. Bodies and the list query are validated against
// the strict schemas of shared, so a body naming its own id or any unknown field is
// refused before anything is stored; tags are normalised here (G-009), and every
// response is serialised through the contract schemas.

const notFound = (): ApiFailure => new ApiFailure(404, 'not_found', 'No such resource.');
const imageNotFound = (): ApiFailure => new ApiFailure(400, 'reference_not_found', 'The image does not exist.');

/**
 * The normalised, distinct tags of a body or query. A tag that is only white space is a
 * validation failure at its own path, like any other invalid value.
 */
function normalizeTags(tags: readonly string[], context: 'body' | 'querystring', path: string): string[] {
  const normalized = tags.map(normalizeTag);
  const empty = normalized.indexOf('');
  if (empty !== -1) {
    throw new ApiFailure(400, 'validation_failed', `The ${context} does not match its schema.`, {
      details: [
        {
          path: context === 'body' ? `${path}/${empty}` : path,
          message: 'must not be empty once white space is removed',
        },
      ],
    });
  }
  return [...new Set(normalized)];
}

const params = { params: IdParamsSchema };

/**
 * `removeImages` removes the files of the images an update or a deletion left
 * unreferenced, once it has committed (specs/03-domain-model.md §7, Q-002). `refreshLive` runs a
 * change that can alter the live scene's tokens and tells the WebSocket rooms what it changed
 * (LIV-04, `server/src/ws/live.ts`).
 */
export function registerAssets(
  app: FastifyInstance,
  db: Database.Database,
  removeImages: (ids: readonly string[]) => void,
  refreshLive: <T>(work: () => T) => T,
): void {
  app.get<{ Querystring: AssetListQuery }>(
    PATHS.assets,
    { schema: { querystring: AssetListQuerySchema, response: { 200: Type.Array(LibraryAssetSchema) } } },
    (request) => {
      const { q, category, tag } = request.query;
      return listAssets(db, {
        search: normalizeTag(q ?? ''),
        category,
        tags: tag === undefined ? [] : normalizeTags([tag].flat(), 'querystring', '/tag'),
      });
    },
  );

  app.post<{ Body: AssetCreateBody }>(
    PATHS.assets,
    { schema: { body: AssetCreateBodySchema, response: { 201: LibraryAssetSchema } } },
    async (request, reply) => {
      const tags = normalizeTags(request.body.tags ?? [], 'body', '/tags');
      const asset = createAsset(db, { ...request.body, tags }) ?? raise(imageNotFound());
      return reply.code(201).send(asset);
    },
  );

  app.get<{ Params: IdParams }>(
    PATHS.asset,
    { schema: { ...params, response: { 200: LibraryAssetSchema } } },
    (request) => readAsset(db, request.params.id) ?? raise(notFound()),
  );

  // Every token of the asset follows its image, size and bare name (specs/05-assets-and-images.md §5,
  // D-111), the live scene's included: the rooms that see such a token get a fresh snapshot, players
  // only for a visible one (specs/04-live-sync.md §4, LIV-04, G-019).
  app.patch<{ Params: IdParams; Body: AssetUpdateBody }>(
    PATHS.asset,
    { schema: { ...params, body: AssetUpdateBodySchema, response: { 200: LibraryAssetSchema } } },
    (request) => {
      const { tags, ...fields } = request.body;
      const normalized = tags === undefined ? undefined : normalizeTags(tags, 'body', '/tags');
      const result = refreshLive(() => updateAsset(db, request.params.id, { ...fields, tags: normalized }));
      if (result.outcome === 'not_found') throw notFound();
      if (result.outcome === 'image_not_found') throw imageNotFound();
      removeImages(result.removedImages);
      return result.asset;
    },
  );

  app.get<{ Params: IdParams }>(
    PATHS.assetUsages,
    { schema: { ...params, response: { 200: AssetUsagesSchema } } },
    (request) => assetUsages(db, request.params.id) ?? raise(notFound()),
  );

  // Refused while any token uses the asset, naming every scene that does
  // (specs/03-domain-model.md §7, specs/05-assets-and-images.md §5).
  app.delete<{ Params: IdParams }>(PATHS.asset, { schema: params }, async (request, reply) => {
    const result = deleteAsset(db, request.params.id);
    if (result.outcome === 'not_found') throw notFound();
    if (result.outcome === 'in_use') {
      throw new ApiFailure(409, 'asset_in_use', 'The asset is used by tokens on these scenes.', {
        usages: result.usages,
      });
    }
    removeImages(result.removedImages);
    return reply.code(204).send();
  });
}

function raise(failure: ApiFailure): never {
  throw failure;
}
