import { Type, type Static } from 'typebox';
import { AssetSchema, TokenSchema, UuidSchema } from './entities.js';

// Tokens of a scene that is not live, over REST (PRP-04, specs/02-architecture.md §5,
// specs/05-assets-and-images.md §2–§5, specs/06-grid-and-measurement.md §4,
// specs/03-domain-model.md §4, specs/04-live-sync.md §2). The live scene's tokens change only by
// the live commands of LIV-02, so every write to one is refused as `scene_live`. Bodies are
// strict: an id, a scene, a z_order or any unknown field is refused, because the server alone
// generates identifiers (D-038), numbers labels (D-019, Q-091) and sets visibility from the
// asset (specs/05-assets-and-images.md §4).

const strict = { additionalProperties: false } as const;

export const API_TOKEN_PATHS = {
  sceneTokens: '/api/scenes/:id/tokens',
  token: '/api/tokens/:id',
} as const;

// A position in decimal grid units: the top-left corner of the token's footprint, in squares
// from the grid's origin (specs/03-domain-model.md §4). Bounded only against nonsense.
const CoordinateSchema = Type.Number({ minimum: -1e6, maximum: 1e6 });
// A label shown on the TV (Q-032): at least one character that is not white space, and no control
// character, which would draw nothing on the TV or upset a later reader of the data (review).
const CONTROL = '\\u0000-\\u001f\\u007f-\\u009f';
const LabelSchema = Type.String({
  minLength: 1,
  maxLength: 200,
  pattern: `^[^${CONTROL}]*[^\\s${CONTROL}][^${CONTROL}]*$`,
});

/**
 * A token as the DM sees it, with what the DM view draws of its asset: a token holds no image or size
 * of its own. This is the DM's shape only: it names the asset and the scene, which a player must
 * never receive (specs/04-live-sync.md §4); LIV-02 defines the players' projection separately.
 */
export const SceneTokenSchema = Type.Object(
  {
    ...TokenSchema.properties,
    asset: Type.Object(
      {
        name: AssetSchema.properties.name,
        image_id: AssetSchema.properties.image_id,
        size: AssetSchema.properties.size,
      },
      strict,
    ),
  },
  strict,
);

// Placed at a position; its label and visibility come from the server (D-019, Q-092,
// specs/05-assets-and-images.md §3, §4), and it goes on top of the scene's other tokens.
export const TokenCreateBodySchema = Type.Object(
  { asset_id: UuidSchema, x: CoordinateSchema, y: CoordinateSchema },
  strict,
);

// What the server answers to a placement or a change: the token, and the token that lost the
// bare name to "<name> 1" when this one was numbered beside it (D-019, Q-092), if any.
export const TokenChangeSchema = Type.Object(
  { token: SceneTokenSchema, relabelled: Type.Array(SceneTokenSchema) },
  strict,
);

export const TOKEN_STACK = ['front', 'back'] as const;

// Move, hide or reveal, relabel, restack (specs/04-live-sync.md §2). `stack` puts the token above
// or below every other token of its scene. Revealing a token that still carries its asset's bare
// name numbers it, unless the body also gives a label (Q-092).
export const TokenUpdateBodySchema = Type.Object(
  {
    x: Type.Optional(CoordinateSchema),
    y: Type.Optional(CoordinateSchema),
    hidden: Type.Optional(Type.Boolean()),
    label: Type.Optional(LabelSchema),
    stack: Type.Optional(Type.Enum(TOKEN_STACK)),
  },
  { ...strict, minProperties: 1 },
);

export type SceneToken = Static<typeof SceneTokenSchema>;
export type TokenCreateBody = Static<typeof TokenCreateBodySchema>;
export type TokenChange = Static<typeof TokenChangeSchema>;
export type TokenUpdateBody = Static<typeof TokenUpdateBodySchema>;
export type TokenStack = (typeof TOKEN_STACK)[number];
