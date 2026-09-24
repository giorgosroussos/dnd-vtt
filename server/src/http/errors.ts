import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  errorEnvelope,
  type AssetUsage,
  type ErrorCode,
  type ErrorDetail,
  type ErrorEnvelope,
} from '@emberglass/shared';
import { normalizeAddress } from '../auth/lockout.js';
import { createLineLimiter, type LineLimiter, type LineLimiterOptions } from '../log/limiter.js';
import type { Logger } from '../log/logger.js';
import { formatAjvErrors } from '../validation.js';

// Every error response is the one envelope of shared (specs/02-architecture.md §5,
// D-015, D-063). Messages are generic: they never echo the request.

export interface HttpFailure {
  status: number;
  envelope: ErrorEnvelope;
}

// Handlers may throw anything, not only a FastifyError: `throw null` included.
type Thrown = Partial<Pick<FastifyError, 'code' | 'statusCode' | 'validation' | 'validationContext'>>;

const internal = (): HttpFailure => ({
  status: 500,
  envelope: errorEnvelope('internal_error', 'Something went wrong on the server.'),
});

/**
 * A refusal a route or hook decides on, with its own code. `message` is fixed
 * text, never request data. A `quiet` failure is not logged as a rejected
 * request, because its route already logged it in its own words (a failed PIN).
 */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly options: {
      quiet?: boolean;
      headers?: Record<string, string>;
      details?: ErrorDetail[];
      usages?: AssetUsage[];
    } = {},
  ) {
    super(message);
  }
}

export function toFailure(thrown: unknown): HttpFailure {
  if (thrown instanceof ApiFailure)
    return {
      status: thrown.status,
      envelope: errorEnvelope(thrown.code, thrown.message, thrown.options.details, thrown.options.usages),
    };
  if (typeof thrown !== 'object' || thrown === null) return internal();
  const error = thrown as Thrown;
  if (Array.isArray(error.validation)) {
    const context = typeof error.validationContext === 'string' ? error.validationContext : 'request';
    return {
      status: 400,
      envelope: errorEnvelope(
        'validation_failed',
        `The ${context} does not match its schema.`,
        formatAjvErrors(error.validation),
      ),
    };
  }
  switch (error.code) {
    case 'FST_ERR_CTP_INVALID_JSON_BODY':
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
      return { status: 400, envelope: errorEnvelope('malformed_body', 'The body is not valid JSON.') };
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return {
        status: 415,
        envelope: errorEnvelope('unsupported_media_type', 'The body has an unsupported media type.'),
      };
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return { status: 413, envelope: errorEnvelope('payload_too_large', 'The body is too large.') };
  }
  const status = error.statusCode;
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 400 || status >= 500) return internal();
  if (status === 404) return { status, envelope: errorEnvelope('not_found', 'No such resource.') };
  return { status, envelope: errorEnvelope('bad_request', 'The request is invalid.') };
}

/** Method and path of a request, without its query string, which may carry anything. */
export function requestContext(request: FastifyRequest): { method: string; path: string } {
  return { method: request.method, path: request.url.split('?', 1)[0] ?? '' };
}

/** Where failures are logged: the logger, and the limit on rejected-request lines (G-006). */
export interface FailureLog {
  logger: Logger;
  limiter: LineLimiter;
}

export type RejectedLineLimits = Omit<LineLimiterOptions, 'onDropped'>;

export function createFailureLog(logger: Logger, limits: RejectedLineLimits = {}): FailureLog {
  const limiter = createLineLimiter({
    ...limits,
    onDropped: (dropped, addresses) =>
      logger.warn('http.rejected.dropped', `${dropped} rejected requests were not logged in the last window.`, {
        dropped,
        addresses,
      }),
  });
  return { logger, limiter };
}

export function installErrorHandling(app: FastifyInstance, log: FailureLog): void {
  app.setNotFoundHandler(async (_request, reply) =>
    reply.code(404).send(errorEnvelope('not_found', 'No such resource.')),
  );
  app.setErrorHandler(async (error: unknown, request, reply) => sendFailure(error, request, reply, log));
}

/** Also passed as Fastify's `frameworkErrors`, so router errors such as a bad URL use the envelope. */
export function sendFailure(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
  { logger, limiter }: FailureLog,
): FastifyReply {
  const { status, envelope } = toFailure(error);
  const address = normalizeAddress(request.socket.remoteAddress);
  const fields = { ...requestContext(request), address, status, code: envelope.error.code };
  if (status >= 500) {
    logger.error('http.error', 'Request failed on the server.', { ...fields, error });
  } else if (status !== 404 && !(error instanceof ApiFailure && error.options.quiet) && limiter.admit(address)) {
    // Fastify's code, never its message: a bad-URL message quotes the raw URL,
    // query string included (D-066). 404s are routine (a TV browser asks for
    // /favicon.ico) and would bury the rest.
    const reason = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    logger.warn('http.rejected', 'Request rejected.', {
      ...fields,
      reason: typeof reason === 'string' ? reason : null,
    });
  }
  if (error instanceof ApiFailure && error.options.headers) reply.headers(error.options.headers);
  return reply.code(status).send(envelope);
}
