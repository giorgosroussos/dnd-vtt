import { Type, type Static } from 'typebox';
import {
  GridSchema,
  ImageSchema,
  ImageVariantSchema,
  SceneSchema,
  Sha256Schema,
  TokenSchema,
  UuidSchema,
} from './entities.js';
import type { ErrorEnvelope } from './errors.js';
import { SceneTokenSchema, TokenChangeSchema, TokenCreateBodySchema } from './tokens.js';

// WebSocket envelopes (specs/04-live-sync.md §2, §3, §5; D-047, D-064).
//
// A DM client sends every command on the Socket.io event `command` and receives
// the outcome through the acknowledgement: `{ ok: true }` or the error envelope.
// The server sends every event on the Socket.io event `event`, carrying the
// version number of its room's counter that lets a client detect a gap (D-108). A client of either
// room that sees a gap asks for a fresh snapshot on `snapshot` (LIV-01, D-104):
// that request is not a command of §2, changes nothing, and is answered by a
// `scene.snapshot` event to the asking socket alone.
export const SOCKET_CHANNELS = {
  command: 'command',
  event: 'event',
  snapshot: 'snapshot',
  // The player view's viewport size (LIV-06): not a command of §2, so a players socket may send it,
  // and it changes nothing players receive. The DM's TV frame takes its shape from it.
  viewport: 'viewport',
} as const;

// Where the Socket.io server listens, on the server's own port (specs/02-architecture.md §2).
export const SOCKET_PATH = '/socket.io';

// The rooms of specs/04-live-sync.md §1; the server decides which a socket joins,
// from its DM session only (Q-046).
export const ROOMS = ['dm', 'players'] as const;
export type Room = (typeof ROOMS)[number];

// What the player view sends in the handshake's `auth` field (D-105). It can only lower a
// socket to `players`: a player view opened in a browser that also holds a DM session (the DM's
// laptop driving the TV) must still receive only visible content (specs/04-live-sync.md §4,
// specs/07-security-and-access.md §3). Nothing a client sends ever raises a socket to `dm`;
// only the DM session does (Q-046).
export const PLAYER_VIEW_AUTH = { view: 'player' } as const;

// The commands of specs/04-live-sync.md §2, exactly.
export const COMMAND_TYPES = [
  'token.add',
  'token.move',
  'token.delete',
  'token.setVisibility',
  'scene.activate',
  'scene.deactivate',
  'camera.setPlayer',
  'ruler.update',
  'ruler.clear',
  'undo',
] as const;

// The events of specs/04-live-sync.md §3, exactly.
export const EVENT_TYPES = [
  'scene.snapshot',
  'token.added',
  'token.updated',
  'token.removed',
  'scene.cleared',
  'camera.player',
  'ruler.shown',
  'ruler.cleared',
] as const;

export type CommandType = (typeof COMMAND_TYPES)[number];
export type EventType = (typeof EVENT_TYPES)[number];

// The payload of each command is defined by the package that implements the
// command (LIV-01 onward); the envelope only requires it to be an object.
export const CommandEnvelopeSchema = Type.Object(
  {
    type: Type.Enum(COMMAND_TYPES),
    payload: Type.Object({}),
  },
  { additionalProperties: false },
);

export const EventEnvelopeSchema = Type.Object(
  {
    type: Type.Enum(EVENT_TYPES),
    // One counter per room per server process, starting at 1 (specs/04-live-sync.md §5, Q-093, D-108).
    version: Type.Integer({ minimum: 1 }),
    payload: Type.Object({}),
  },
  { additionalProperties: false },
);

export interface CommandEnvelope<T extends CommandType = CommandType, P extends object = Record<string, unknown>> {
  type: T;
  payload: P;
}

export interface EventEnvelope<T extends EventType = EventType, P extends object = Record<string, unknown>> {
  type: T;
  version: number;
  payload: P;
}

// Compile-time proof that the interfaces and the schemas describe the same shape.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const envelopesMatchSchemas: [
  Same<CommandEnvelope['type'], Static<typeof CommandEnvelopeSchema>['type']>,
  Same<EventEnvelope['type'], Static<typeof EventEnvelopeSchema>['type']>,
] = [true, true];
void envelopesMatchSchemas;

export type CommandAck = { ok: true } | ErrorEnvelope;

const strict = { additionalProperties: false } as const;

// What a `scene.snapshot` carries (specs/04-live-sync.md §3, §4, §5; LIV-01, D-104).
// The DM's snapshot is the full live scene: the scene record, its map image and every
// token in the DM's shape. The players' snapshot is built on the server from visible
// tokens only and names nothing a player must not learn: no scene id or name, no asset,
// no hidden token, and a stacking order that is a token's rank among the visible tokens,
// so a hidden token between two visible ones leaves no hole (G-025). `role` tells a
// client which room the server put it in; a DM view whose session ended learns so from it.

/** A token as a player client receives it: exactly the fields of specs/04-live-sync.md §4. */
export const PlayerTokenSchema = Type.Object(
  {
    id: UuidSchema,
    x: TokenSchema.properties.x,
    y: TokenSchema.properties.y,
    size: SceneTokenSchema.properties.asset.properties.size,
    image_id: Sha256Schema,
    // The rank among the scene's visible tokens, bottom first, from 0.
    z_order: Type.Integer({ minimum: 0 }),
    label: TokenSchema.properties.label,
  },
  strict,
);

/** The live map as the player view draws it: only its display version is ever fetched (specs/07-security-and-access.md §5). */
export const PlayerMapSchema = Type.Object(
  {
    id: Sha256Schema,
    width: ImageSchema.properties.width,
    height: ImageSchema.properties.height,
    variants: Type.Object({ display: Type.Optional(ImageVariantSchema) }, strict),
  },
  strict,
);

// The player camera (LIV-06; specs/04-live-sync.md §9, Q-038, D-018): the rectangle of the live
// scene's world that every screen must show, its centre and size in fractions of the world's width
// and height, so it means the same whatever the display version's pixels or a map-less scene's
// square size. A screen shows it as large as it fits, centred, so a screen of another shape shows a
// little more along one axis. Held in the server's memory only, and reset to FIT_CAMERA, the whole
// map or the whole map-less extent, on every activation.
export const CAMERA_BOUNDS = { minSize: 0.001, maxSize: 100 } as const;
const CameraSize = Type.Number({ minimum: CAMERA_BOUNDS.minSize, maximum: CAMERA_BOUNDS.maxSize });
const CameraCentre = Type.Number({ minimum: 0, maximum: 1 });
export const PlayerCameraSchema = Type.Object(
  { centre_x: CameraCentre, centre_y: CameraCentre, width: CameraSize, height: CameraSize },
  strict,
);
export type PlayerCamera = Static<typeof PlayerCameraSchema>;
/** The whole world: fit-to-map, or to the grid extent of a map-less scene. */
export const FIT_CAMERA: PlayerCamera = Object.freeze({ centre_x: 0.5, centre_y: 0.5, width: 1, height: 1 });

// A player view's viewport in CSS pixels, reported on SOCKET_CHANNELS.viewport. The DM room learns
// the shape of the screen connected longest, which the TV frame follows; players never receive it.
const ScreenSide = Type.Integer({ minimum: 1, maximum: 32_768 });
export const ScreenSchema = Type.Object({ width: ScreenSide, height: ScreenSide }, strict);
export type Screen = Static<typeof ScreenSchema>;
export type ViewportAck = { ok: true } | ErrorEnvelope;

// The ruler (LIV-07; specs/04-live-sync.md §11, specs/06-grid-and-measurement.md §5, Q-027, Q-048,
// Q-086): a straight path between the centres of two squares, each named by its column and row from
// the grid's origin, as token positions are in grid units (specs/03-domain-model.md §4). A square
// before the first grid line of a map has a negative index. What both rooms are shown is the two
// squares and the distance in feet, which the server counts by the one server-wide diagonal rule and
// the scene's feet per square (`rulerFeet`), so the TV needs neither. Held in the server's memory for
// the live scene only, never stored (D-121).
const RulerIndex = Type.Integer({ minimum: -100_000, maximum: 100_000 });
export const RulerSquareSchema = Type.Object({ column: RulerIndex, row: RulerIndex }, strict);
export const MeasurementSchema = Type.Object(
  { from: RulerSquareSchema, to: RulerSquareSchema, feet: Type.Number({ minimum: 0 }) },
  strict,
);
export type Measurement = Static<typeof MeasurementSchema>;

export const PlayerLiveSceneSchema = Type.Object(
  {
    map: Type.Union([PlayerMapSchema, Type.Null()]),
    // Needed even when players do not see the grid: tokens are placed in grid units.
    grid: GridSchema,
    tokens: Type.Array(PlayerTokenSchema),
    camera: PlayerCameraSchema,
    // The measurement shown on the TV, or null (LIV-07).
    ruler: Type.Union([MeasurementSchema, Type.Null()]),
  },
  strict,
);

export const DmLiveSceneSchema = Type.Object(
  {
    scene: SceneSchema,
    map: Type.Union([ImageSchema, Type.Null()]),
    tokens: Type.Array(SceneTokenSchema),
    camera: PlayerCameraSchema,
    // The screen the TV frame follows, or null while no player view has reported one.
    screen: Type.Union([ScreenSchema, Type.Null()]),
    ruler: Type.Union([MeasurementSchema, Type.Null()]),
  },
  strict,
);

// `scene` is null while nothing is live: the player view shows the idle screen (specs/08-ux-journeys.md §4).
export const PlayerSnapshotSchema = Type.Object(
  { role: Type.Literal('players'), scene: Type.Union([PlayerLiveSceneSchema, Type.Null()]) },
  strict,
);

export const DmSnapshotSchema = Type.Object(
  { role: Type.Literal('dm'), scene: Type.Union([DmLiveSceneSchema, Type.Null()]) },
  strict,
);

export const SceneSnapshotSchema = Type.Union([DmSnapshotSchema, PlayerSnapshotSchema]);

export type PlayerToken = Static<typeof PlayerTokenSchema>;
export type PlayerMap = Static<typeof PlayerMapSchema>;
export type PlayerLiveScene = Static<typeof PlayerLiveSceneSchema>;
export type DmLiveScene = Static<typeof DmLiveSceneSchema>;
export type PlayerSnapshot = Static<typeof PlayerSnapshotSchema>;
export type DmSnapshot = Static<typeof DmSnapshotSchema>;
export type SceneSnapshot = Static<typeof SceneSnapshotSchema>;
export type SnapshotEvent<S extends SceneSnapshot = SceneSnapshot> = EventEnvelope<'scene.snapshot', S>;

/** The acknowledgement of a snapshot request: the snapshot itself arrives as an event before it. */
export type SnapshotAck = { ok: true };

// --- the live commands and their events (LIV-02) ---------------------------------------------
//
// The payload of each live command (specs/04-live-sync.md §2, Q-014, D-064), strict so that a
// field the server does not expect is refused, never ignored (D-067). A token command names the
// token; the live scene is the server's, never the client's. `token.add` and `scene.activate` name
// the scene, and `token.add` is refused when that scene is not the live one, so a placement meant
// for the scene that was live a moment ago never lands on the one another DM browser just made
// live. A new token's label and visibility come from the server (specs/05-assets-and-images.md §3,
// §4, Q-092), as in preparation. `undo` (LIV-05) carries nothing: the server applies the most recent
// inverse from its own history (specs/04-live-sync.md §8, D-040). `camera.setPlayer` (LIV-06) names
// the scene it frames, as `token.add` does, and is refused when that scene is no longer live, so a
// frame dragged for the scene live a moment ago never moves the TV of the next one. `ruler.update`
// and `ruler.clear` (LIV-07) name the scene too, and are refused the same way, so a measurement made
// on the scene live a moment ago never shows on the next one's TV.

const Coordinate = TokenCreateBodySchema.properties.x;

export const TokenAddPayloadSchema = Type.Object(
  { scene_id: UuidSchema, asset_id: UuidSchema, x: Coordinate, y: Coordinate },
  strict,
);
export const TokenMovePayloadSchema = Type.Object({ token_id: UuidSchema, x: Coordinate, y: Coordinate }, strict);
export const TokenSetVisibilityPayloadSchema = Type.Object({ token_id: UuidSchema, hidden: Type.Boolean() }, strict);
export const TokenDeletePayloadSchema = Type.Object({ token_id: UuidSchema }, strict);
export const SceneActivatePayloadSchema = Type.Object({ scene_id: UuidSchema }, strict);
export const SceneDeactivatePayloadSchema = Type.Object({}, strict);
export const UndoPayloadSchema = Type.Object({}, strict);
export const CameraSetPlayerPayloadSchema = Type.Object({ scene_id: UuidSchema, camera: PlayerCameraSchema }, strict);
export const RulerUpdatePayloadSchema = Type.Object(
  { scene_id: UuidSchema, from: RulerSquareSchema, to: RulerSquareSchema },
  strict,
);
export const RulerClearPayloadSchema = Type.Object({ scene_id: UuidSchema }, strict);

/** The payload schema of every live command implemented so far; the server registers exactly these. */
export const LIVE_COMMAND_PAYLOAD_SCHEMAS = {
  'token.add': TokenAddPayloadSchema,
  'token.move': TokenMovePayloadSchema,
  'token.setVisibility': TokenSetVisibilityPayloadSchema,
  'token.delete': TokenDeletePayloadSchema,
  'scene.activate': SceneActivatePayloadSchema,
  'scene.deactivate': SceneDeactivatePayloadSchema,
  'camera.setPlayer': CameraSetPlayerPayloadSchema,
  'ruler.update': RulerUpdatePayloadSchema,
  'ruler.clear': RulerClearPayloadSchema,
  undo: UndoPayloadSchema,
} as const satisfies Partial<Record<CommandType, object>>;

export type TokenAddPayload = Static<typeof TokenAddPayloadSchema>;
export type TokenMovePayload = Static<typeof TokenMovePayloadSchema>;
export type TokenSetVisibilityPayload = Static<typeof TokenSetVisibilityPayloadSchema>;
export type TokenDeletePayload = Static<typeof TokenDeletePayloadSchema>;
export type SceneActivatePayload = Static<typeof SceneActivatePayloadSchema>;
export type SceneDeactivatePayload = Static<typeof SceneDeactivatePayloadSchema>;
export type UndoPayload = Static<typeof UndoPayloadSchema>;
export type CameraSetPlayerPayload = Static<typeof CameraSetPlayerPayloadSchema>;
export type RulerUpdatePayload = Static<typeof RulerUpdatePayloadSchema>;
export type RulerClearPayload = Static<typeof RulerClearPayloadSchema>;

// What each room's events carry (specs/04-live-sync.md §3, §4; D-049, Q-083, G-023, G-025). One
// event per room per command, as the table of §3 has it. The DM's token events carry the token in
// the DM's shape and, like the REST answer (D-100), `relabelled`: the lone token renamed
// "<name> 1" when this one was numbered beside it, so a rename reaches the rooms inside the event
// that caused it (G-023). The players' carry `PlayerTokenSchema` only; the renamed token is
// always visible, since a hidden token carrying the bare name is never counted (Q-092).
//
// A player token's `z_order` is its rank among the visible tokens after the event, bottom first,
// from 0: a client keeps the visible tokens in that order, inserting an added token at its rank
// and closing the gap a removed one leaves, so the ranks it holds are always those a fresh snapshot
// would give. A rank depends on visible tokens only, so it says nothing of a hidden one (G-025).
// Hiding and deleting a token send players the same `token.removed`, with the id alone (Q-083).

export const DmTokenEventPayloadSchema = TokenChangeSchema;
export const TokenRemovedPayloadSchema = Type.Object({ id: UuidSchema }, strict);
export const PlayerTokenAddedPayloadSchema = Type.Object(
  { token: PlayerTokenSchema, relabelled: Type.Array(PlayerTokenSchema) },
  strict,
);
export const PlayerTokenUpdatedPayloadSchema = Type.Object({ token: PlayerTokenSchema }, strict);
export const SceneClearedPayloadSchema = Type.Object({}, strict);
// `camera.player` (LIV-06): players receive the camera alone; the DM room also the screen shape the
// frame follows, and receives it again, with the same camera, when that shape changes.
export const PlayerCameraPayloadSchema = Type.Object({ camera: PlayerCameraSchema }, strict);
export const DmCameraPayloadSchema = Type.Object(
  { camera: PlayerCameraSchema, screen: Type.Union([ScreenSchema, Type.Null()]) },
  strict,
);

// `ruler.shown` and `ruler.cleared` (LIV-07): the same to both rooms, since a measurement names no
// token and no scene.
export const RulerShownPayloadSchema = Type.Object({ ruler: MeasurementSchema }, strict);
export const RulerClearedPayloadSchema = Type.Object({}, strict);

export type DmTokenEventPayload = Static<typeof DmTokenEventPayloadSchema>;
export type TokenRemovedPayload = Static<typeof TokenRemovedPayloadSchema>;
export type PlayerTokenAddedPayload = Static<typeof PlayerTokenAddedPayloadSchema>;
export type PlayerTokenUpdatedPayload = Static<typeof PlayerTokenUpdatedPayloadSchema>;
export type SceneClearedPayload = Static<typeof SceneClearedPayloadSchema>;
export type PlayerCameraPayload = Static<typeof PlayerCameraPayloadSchema>;
export type DmCameraPayload = Static<typeof DmCameraPayloadSchema>;
export type RulerShownPayload = Static<typeof RulerShownPayloadSchema>;
export type RulerClearedPayload = Static<typeof RulerClearedPayloadSchema>;

/** Every event of the dm room with its payload. */
export type DmEvent =
  | EventEnvelope<'scene.snapshot', DmSnapshot>
  | EventEnvelope<'token.added' | 'token.updated', DmTokenEventPayload>
  | EventEnvelope<'token.removed', TokenRemovedPayload>
  | EventEnvelope<'scene.cleared', SceneClearedPayload>
  | EventEnvelope<'camera.player', DmCameraPayload>
  | EventEnvelope<'ruler.shown', RulerShownPayload>
  | EventEnvelope<'ruler.cleared', RulerClearedPayload>;

/** Every event of the players room with its payload: nothing here names a hidden token. */
export type PlayerEvent =
  | EventEnvelope<'scene.snapshot', PlayerSnapshot>
  | EventEnvelope<'token.added', PlayerTokenAddedPayload>
  | EventEnvelope<'token.updated', PlayerTokenUpdatedPayload>
  | EventEnvelope<'token.removed', TokenRemovedPayload>
  | EventEnvelope<'scene.cleared', SceneClearedPayload>
  | EventEnvelope<'camera.player', PlayerCameraPayload>
  | EventEnvelope<'ruler.shown', RulerShownPayload>
  | EventEnvelope<'ruler.cleared', RulerClearedPayload>;
