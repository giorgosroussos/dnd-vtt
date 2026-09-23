import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { errorEnvelope, type ErrorEnvelope } from '@emberglass/shared';
import type { Logger } from '../log/logger.js';
import { formatAjvErrors } from '../validation.js';

// Every error response is the one envelope of shared (specs/02-architecture.md §5,
// D-015, D-063). Messages are generic: they never echo the request.

export interface HttpFailure {
  status: number;
  envelope: ErrorEnvelope;
}

export function toFailure(error: FastifyError): HttpFailure {
  if (error.validation) {
    const context = error.validationContext ?? 'request';
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
  const status = error.statusCode ?? 500;
  if (status === 404) return { status, envelope: errorEnvelope('not_found', 'No such resource.') };
  if (status >= 400 && status < 500)
    return { status, envelope: errorEnvelope('bad_request', 'The request is invalid.') };
  return { status: 500, envelope: errorEnvelope('internal_error', 'Something went wrong on the server.') };
}

/** Method and path of a request, without its query string, which may carry anything. */
export function requestContext(request: FastifyRequest): { method: string; path: string } {
  return { method: request.method, path: request.url.split('?', 1)[0] ?? '' };
}

export function installErrorHandling(app: FastifyInstance, logger: Logger): void {
  app.setNotFoundHandler(async (_request, reply) =>
    reply.code(404).send(errorEnvelope('not_found', 'No such resource.')),
  );
  app.setErrorHandler(async (error: FastifyError, request, reply) => sendFailure(error, request, reply, logger));
}

/** Also passed as Fastify's `frameworkErrors`, so router errors such as a bad URL use the envelope. */
export function sendFailure(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
  logger: Logger,
): FastifyReply {
  const { status, envelope } = toFailure(error);
  const fields = { ...requestContext(request), status, code: envelope.error.code };
  if (status >= 500) {
    logger.error('http.error', 'Request failed on the server.', { ...fields, error });
  } else if (status !== 404) {
    // 404s are routine (a TV browser asks for /favicon.ico) and would bury the rest.
    logger.warn('http.rejected', 'Request rejected.', { ...fields, reason: error.message });
  }
  return reply.code(status).send(envelope);
}
