import { Type, type Static } from 'typebox';
import { Sha256Schema, UuidSchema } from './entities.js';

// REST bodies for campaigns, sessions and scenes (specs/02-architecture.md §5,
// specs/03-domain-model.md §2, §3, §7, D-078). Every body is strict: an unknown
// field, an `id` included, is refused, because the server alone generates
// identifiers (D-038). Responses are the entity records of entities.ts.

const strict = { additionalProperties: false } as const;

export const API_STRUCTURE_PATHS = {
  campaigns: '/api/campaigns',
  campaign: '/api/campaigns/:id',
  campaignDeletion: '/api/campaigns/:id/deletion',
  sessions: '/api/campaigns/:id/sessions',
  sessionOrder: '/api/campaigns/:id/sessions/order',
  session: '/api/sessions/:id',
  sessionDeletion: '/api/sessions/:id/deletion',
  scenes: '/api/sessions/:id/scenes',
  sceneOrder: '/api/sessions/:id/scenes/order',
  scene: '/api/scenes/:id',
  sceneDeletion: '/api/scenes/:id/deletion',
  sceneDuplicate: '/api/scenes/:id/duplicate',
} as const;

export const IdParamsSchema = Type.Object({ id: UuidSchema }, strict);

// A calendar date, YYYY-MM-DD, that exists: the pattern alone admits 2026-02-30.
export const CALENDAR_DATE_PATTERN = '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
export function isCalendarDate(value: string): boolean {
  if (!new RegExp(CALENDAR_DATE_PATTERN).test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const DateSchema = Type.Union([Type.String({ pattern: CALENDAR_DATE_PATTERN }), Type.Null()]);

export const CampaignCreateBodySchema = Type.Object(
  { name: Type.String({ minLength: 1 }), description: Type.Optional(Type.String()) },
  strict,
);

export const CampaignUpdateBodySchema = Type.Object(
  { name: Type.Optional(Type.String({ minLength: 1 })), description: Type.Optional(Type.String()) },
  { ...strict, minProperties: 1 },
);

// A new session goes last in its campaign.
export const SessionCreateBodySchema = Type.Object(
  { title: Type.String({ minLength: 1 }), date: Type.Optional(DateSchema) },
  strict,
);

export const SessionUpdateBodySchema = Type.Object(
  { title: Type.Optional(Type.String({ minLength: 1 })), date: Type.Optional(DateSchema) },
  { ...strict, minProperties: 1 },
);

// A new scene goes last in its session. With a map it starts from a copy of
// that image's grid preset; without one, or while the image has no preset, it
// starts from the stored defaults, 30 × 20 (specs/03-domain-model.md §5, §6).
export const SceneCreateBodySchema = Type.Object(
  { name: Type.String({ minLength: 1 }), map_image_id: Type.Optional(Type.Union([Sha256Schema, Type.Null()])) },
  strict,
);

// Rename only: the map and the grid are scene setup (PRP-02, PRP-03).
export const SceneUpdateBodySchema = Type.Object({ name: Type.String({ minLength: 1 }) }, strict);

// The copy is placed right after the original; its name comes from the client,
// which words it from the message catalogue.
export const SceneDuplicateBodySchema = Type.Object({ name: Type.String({ minLength: 1 }) }, strict);

// Every child of the parent exactly once, in the new order.
export const OrderBodySchema = Type.Object({ ids: Type.Array(UuidSchema, { uniqueItems: true }) }, strict);

// What a deletion removes, the entity itself included, and whether the live
// scene is among it (specs/03-domain-model.md §7). GET …/deletion answers it;
// DELETE must send it back unchanged as its confirmation.
export const DeletionSummarySchema = Type.Object(
  {
    sessions: Type.Integer({ minimum: 0 }),
    scenes: Type.Integer({ minimum: 0 }),
    tokens: Type.Integer({ minimum: 0 }),
    live: Type.Boolean(),
  },
  strict,
);

export const DeleteBodySchema = Type.Object({ confirm: DeletionSummarySchema }, strict);

export type IdParams = Static<typeof IdParamsSchema>;
export type CampaignCreateBody = Static<typeof CampaignCreateBodySchema>;
export type CampaignUpdateBody = Static<typeof CampaignUpdateBodySchema>;
export type SessionCreateBody = Static<typeof SessionCreateBodySchema>;
export type SessionUpdateBody = Static<typeof SessionUpdateBodySchema>;
export type SceneCreateBody = Static<typeof SceneCreateBodySchema>;
export type SceneUpdateBody = Static<typeof SceneUpdateBodySchema>;
export type SceneDuplicateBody = Static<typeof SceneDuplicateBodySchema>;
export type OrderBody = Static<typeof OrderBodySchema>;
export type DeletionSummary = Static<typeof DeletionSummarySchema>;
export type DeleteBody = Static<typeof DeleteBodySchema>;
