import type { ErrorCode } from '@emberglass/shared';
import { t, type MessageKey } from './messages.js';

// What the DM reads for each error code (specs/08-ux-journeys.md §6, G-014, D-085).
// Typed over every code of shared, so a new code fails `make typecheck` until it
// has a message; the screen never shows a raw code. `network` is the client's own:
// the request got no answer.
export const ERROR_MESSAGES: Readonly<Record<ErrorCode | 'network', MessageKey>> = {
  not_found: 'error.code.not_found',
  validation_failed: 'error.code.validation_failed',
  malformed_body: 'error.code.malformed_body',
  bad_request: 'error.code.bad_request',
  unsupported_media_type: 'error.code.unsupported_media_type',
  payload_too_large: 'error.code.payload_too_large',
  command_unsupported: 'error.code.command_unsupported',
  internal_error: 'error.code.internal_error',
  unauthorized: 'error.code.unauthorized',
  forbidden: 'error.code.forbidden',
  pin_incorrect: 'error.code.pin_incorrect',
  locked_out: 'error.code.locked_out',
  pin_not_set: 'error.code.pin_not_set',
  pin_already_set: 'error.code.pin_already_set',
  reference_not_found: 'error.code.reference_not_found',
  order_mismatch: 'error.code.order_mismatch',
  confirmation_mismatch: 'error.code.confirmation_mismatch',
  asset_in_use: 'error.code.asset_in_use',
  network: 'error.code.network',
};

export function errorMessage(code: ErrorCode | 'network'): string {
  return t(ERROR_MESSAGES[code]);
}
