import {
  CommandEnvelopeSchema,
  LIVE_COMMAND_PAYLOAD_SCHEMAS,
  errorEnvelope,
  type CommandAck,
  type CommandEnvelope,
  type CommandType,
  type ErrorEnvelope,
} from '@emberglass/shared';
import { compileSchema, formatAjvErrors } from '../validation.js';

// Command validation (specs/07-security-and-access.md §7, specs/04-live-sync.md §2,
// D-047, D-064, D-067): every WebSocket command is checked against the shared envelope
// schema and then against its own payload schema, with the same validator as REST
// bodies, before anything is applied. A command whose type has no payload schema
// is refused: until the package that implements it registers one, it cannot run.
//
// The room check (a command from outside `dm` is rejected) belongs to the socket
// layer of LIV-01; this module judges only the content.

export type CommandPayloadSchemas = Partial<Record<CommandType, object>>;

export type CommandValidation = { ok: true; command: CommandEnvelope } | { ok: false; error: ErrorEnvelope };

export type CommandValidator = (raw: unknown) => CommandValidation;

const validateEnvelope = compileSchema<CommandEnvelope>(CommandEnvelopeSchema);

// A payload schema must describe a closed object: a loose one would accept keys
// such as `__proto__`, which Socket.io's JSON.parse delivers as own properties
// (D-067). Checked when a schema is registered, so a mistake fails at start-up.
function assertClosedObject(type: string, schema: object): void {
  const { type: schemaType, additionalProperties } = schema as { type?: unknown; additionalProperties?: unknown };
  if (schemaType !== 'object' || additionalProperties !== false) {
    throw new Error(`The payload schema of ${type} must be an object schema with additionalProperties: false.`);
  }
}

// Only what JSON can produce: a plain object. A Buffer (a Socket.io binary
// attachment) or a class instance never reaches the validator.
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

const notPlain = (path: string): CommandValidation => ({
  ok: false,
  error: errorEnvelope('validation_failed', 'The command envelope does not match its schema.', [
    { path, message: 'must be a plain JSON object' },
  ]),
});

export function createCommandValidator(payloadSchemas: CommandPayloadSchemas): CommandValidator {
  const payloadValidators = new Map(
    Object.entries(payloadSchemas).map(([type, schema]) => {
      assertClosedObject(type, schema);
      return [type, compileSchema(schema)] as const;
    }),
  );
  return (raw) => {
    if (!isPlainObject(raw)) return notPlain('');
    if ('payload' in raw && !isPlainObject(raw.payload)) return notPlain('/payload');
    if (!validateEnvelope(raw)) {
      return {
        ok: false,
        error: errorEnvelope(
          'validation_failed',
          'The command envelope does not match its schema.',
          formatAjvErrors(validateEnvelope.errors),
        ),
      };
    }
    const validatePayload = payloadValidators.get(raw.type);
    if (!validatePayload) {
      return { ok: false, error: errorEnvelope('command_unsupported', 'This command is not supported yet.') };
    }
    if (!validatePayload(raw.payload)) {
      return {
        ok: false,
        error: errorEnvelope(
          'validation_failed',
          'The command payload does not match its schema.',
          formatAjvErrors(validatePayload.errors, '/payload'),
        ),
      };
    }
    return { ok: true, command: raw };
  };
}

// The live commands of LIV-02 (specs/04-live-sync.md §2); `camera.setPlayer`, the ruler and `undo`
// stay refused as unsupported until LIV-05 to LIV-07 register theirs.
export const COMMAND_PAYLOAD_SCHEMAS: CommandPayloadSchemas = { ...LIVE_COMMAND_PAYLOAD_SCHEMAS };

export const validateCommand: CommandValidator = createCommandValidator(COMMAND_PAYLOAD_SCHEMAS);

/**
 * Validate `raw`, then apply it; `apply` is never called for an invalid command,
 * so a rejection changes nothing. `apply` may itself refuse a valid command (an
 * unknown token, a scene that is not live) by answering the error envelope, and
 * must then have changed nothing. The result is the acknowledgement the socket
 * layer returns to the sender.
 */
export function dispatchCommand(
  raw: unknown,
  validate: CommandValidator,
  apply: (command: CommandEnvelope) => ErrorEnvelope | void,
): CommandAck {
  const result = validate(raw);
  if (!result.ok) return result.error;
  return apply(result.command) ?? { ok: true };
}
