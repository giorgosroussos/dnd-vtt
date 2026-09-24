import { Type, type Static } from 'typebox';

// The one error envelope every REST error response and every rejected WebSocket
// command carries (specs/02-architecture.md §5, specs/07-security-and-access.md §7,
// D-015, D-047, D-063). The client maps `code` to its message catalogue; `message`
// is a diagnostic in English and never contains request data.
export const ERROR_CODES = [
  'not_found',
  'validation_failed',
  'malformed_body',
  'bad_request',
  'unsupported_media_type',
  'payload_too_large',
  'command_unsupported',
  'internal_error',
  // SRV-02 (specs/07-security-and-access.md §1, §2, §6):
  'unauthorized',
  'forbidden',
  'pin_incorrect',
  'locked_out',
  'pin_not_set',
  'pin_already_set',
  // SRV-03 (specs/03-domain-model.md §2, §7):
  'reference_not_found',
  'order_mismatch',
  'confirmation_mismatch',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorDetailSchema = Type.Object(
  {
    // JSON Pointer to the offending value inside the body or command, '' for the whole of it.
    path: Type.String(),
    message: Type.String(),
  },
  { additionalProperties: false },
);

export const ErrorEnvelopeSchema = Type.Object(
  {
    error: Type.Object(
      {
        code: Type.Enum(ERROR_CODES),
        message: Type.String(),
        details: Type.Optional(Type.Array(ErrorDetailSchema)),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type ErrorDetail = Static<typeof ErrorDetailSchema>;
export type ErrorEnvelope = Static<typeof ErrorEnvelopeSchema>;

export function errorEnvelope(code: ErrorCode, message: string, details?: ErrorDetail[]): ErrorEnvelope {
  return { error: details && details.length > 0 ? { code, message, details } : { code, message } };
}
