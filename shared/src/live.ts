import { Type, type Static } from 'typebox';
import type { ErrorEnvelope } from './errors.js';

// WebSocket envelopes (specs/04-live-sync.md §2, §3, §5; D-047, D-064).
//
// A DM client sends every command on the Socket.io event `command` and receives
// the outcome through the acknowledgement: `{ ok: true }` or the error envelope.
// The server sends every event on the Socket.io event `event`, carrying the
// process-wide version number that lets a client detect a gap.
export const SOCKET_CHANNELS = {
  command: 'command',
  event: 'event',
} as const;

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
    // One counter per server process, starting at 1 (specs/04-live-sync.md §5, D-017).
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
