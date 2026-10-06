import { Type, type Static } from 'typebox';
import { AssetUsageSchema, type AssetUsage } from './assets.js';

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
  // REL-03, G-042 (specs/07-security-and-access.md §6, Q-097, Q-098): PIN entry is paused for every address
  // but the server machine's, after many failures across addresses; sent instead of `locked_out` while
  // the pause lasts, with the same Retry-After, so that the DM view can name the server PC as the way in.
  'pin_paused',
  'pin_not_set',
  'pin_already_set',
  // SRV-03 (specs/03-domain-model.md §2, §7):
  'reference_not_found',
  'order_mismatch',
  'confirmation_mismatch',
  // SRV-05 (specs/03-domain-model.md §7, specs/05-assets-and-images.md §5):
  'asset_in_use',
  // PRP-03 (specs/06-grid-and-measurement.md §1): calibration of a scene without a map.
  'calibration_needs_map',
  // PRP-04 (specs/04-live-sync.md §2): the live scene's tokens change only by live commands.
  'scene_live',
  // LIV-02 (specs/04-live-sync.md §2): a live command for a scene or token that is not live.
  'scene_not_live',
  // DMT-05 (specs/07-security-and-access.md §9, specs/09-operations.md §9): an import refused, storing nothing.
  // Another import is running; only one runs at a time.
  'import_busy',
  // The archive, or its entries once unpacked, are over the import limit.
  'import_too_large',
  // Its manifest names a format newer than this server reads; `format_version` says which.
  'import_newer_format',
  // An entry that could land outside its folder, a link, an encrypted, duplicated or unexpected entry, or too many.
  'import_unsafe_entry',
  // Not a zip this server reads, or its manifest or data malformed, against their schemas or referring to nothing.
  'import_invalid',
  // An image failing the checks of an upload, or whose bytes are not the sha256 it is named by.
  'import_image_refused',
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
        // Only with `asset_in_use`: every scene whose tokens use the asset (D-083).
        usages: Type.Optional(Type.Array(AssetUsageSchema)),
        // Only with `import_newer_format`: the format the archive's manifest names (DMT-05).
        format_version: Type.Optional(Type.Integer({ minimum: 1 })),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type ErrorDetail = Static<typeof ErrorDetailSchema>;
export type ErrorEnvelope = Static<typeof ErrorEnvelopeSchema>;

export function errorEnvelope(
  code: ErrorCode,
  message: string,
  details?: ErrorDetail[],
  usages?: AssetUsage[],
  formatVersion?: number,
): ErrorEnvelope {
  return {
    error: {
      code,
      message,
      ...(details && details.length > 0 ? { details } : {}),
      ...(usages ? { usages } : {}),
      ...(formatVersion !== undefined ? { format_version: formatVersion } : {}),
    },
  };
}
