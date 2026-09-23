import {
  CommandEnvelopeSchema,
  errorEnvelope,
  type CommandAck,
  type CommandEnvelope,
  type CommandType,
  type ErrorEnvelope,
} from '@emberglass/shared';
import { compileSchema, formatAjvErrors } from '../validation.js';

// Command validation (specs/07-security-and-access.md §7, specs/04-live-sync.md §2,
// D-047, D-064): every WebSocket command is checked against the shared envelope
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

export function createCommandValidator(payloadSchemas: CommandPayloadSchemas): CommandValidator {
  const payloadValidators = new Map(
    Object.entries(payloadSchemas).map(([type, schema]) => [type, compileSchema(schema)] as const),
  );
  return (raw) => {
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

// No command has a payload schema yet: LIV-01 onward register theirs here.
export const COMMAND_PAYLOAD_SCHEMAS: CommandPayloadSchemas = {};

export const validateCommand: CommandValidator = createCommandValidator(COMMAND_PAYLOAD_SCHEMAS);

/**
 * Validate `raw`, then apply it; `apply` is never called for an invalid command,
 * so a rejection changes nothing. The result is the acknowledgement the socket
 * layer returns to the sender.
 */
export function dispatchCommand(
  raw: unknown,
  validate: CommandValidator,
  apply: (command: CommandEnvelope) => void,
): CommandAck {
  const result = validate(raw);
  if (!result.ok) return result.error;
  apply(result.command);
  return { ok: true };
}
