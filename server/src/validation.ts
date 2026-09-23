import { Ajv, type ErrorObject, type Options, type ValidateFunction } from 'ajv';
import type { ErrorDetail } from '@emberglass/shared';

// One validator for REST bodies and WebSocket commands, so both reject exactly
// the same things (specs/07-security-and-access.md §7, D-047, D-062). Unlike
// Fastify's defaults it never coerces a type, fills a default or strips an
// unknown field: what the client sent is what is judged.
export const VALIDATION_OPTIONS = {
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
  allErrors: false,
  strict: true,
} as const satisfies Options;

export const ajv = new Ajv(VALIDATION_OPTIONS);

export function compileSchema<T = unknown>(schema: object): ValidateFunction<T> {
  return ajv.compile<T>(schema);
}

/** Ajv errors as envelope details; `prefix` is the JSON Pointer of the validated value. */
export function formatAjvErrors(errors: readonly ErrorObject[] | null | undefined, prefix = ''): ErrorDetail[] {
  return (errors ?? []).map((error) => {
    const missing = error.keyword === 'required' ? `/${String(error.params.missingProperty)}` : '';
    const extra = error.keyword === 'additionalProperties' ? `/${String(error.params.additionalProperty)}` : '';
    const message =
      error.keyword === 'additionalProperties' ? 'is not an allowed property' : (error.message ?? 'is invalid');
    return { path: `${prefix}${error.instancePath}${missing}${extra}`, message };
  });
}
