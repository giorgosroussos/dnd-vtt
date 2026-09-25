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
import { SceneTokenSchema } from './tokens.js';

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

export const PlayerLiveSceneSchema = Type.Object(
  {
    map: Type.Union([PlayerMapSchema, Type.Null()]),
    // Needed even when players do not see the grid: tokens are placed in grid units.
    grid: GridSchema,
    tokens: Type.Array(PlayerTokenSchema),
  },
  strict,
);

export const DmLiveSceneSchema = Type.Object(
  {
    scene: SceneSchema,
    map: Type.Union([ImageSchema, Type.Null()]),
    tokens: Type.Array(SceneTokenSchema),
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
