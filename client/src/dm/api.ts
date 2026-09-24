import type { ErrorCode, ErrorEnvelope } from '@emberglass/shared';

// The DM view's REST client (specs/02-architecture.md §5, D-085). Same origin and
// JSON only; the session is the HttpOnly cookie the browser sends by itself, which
// no code here can read (specs/07-security-and-access.md §2). An error answer is
// the shared envelope, thrown as an ApiError whose code the view turns into a
// catalogue message; a request that never got an answer has the code `network`.

export type ClientErrorCode = ErrorCode | 'network';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    /** Seconds from `Retry-After`, sent with `locked_out`. */
    readonly retryAfter: number | undefined = undefined,
  ) {
    super(`request failed: ${code}`);
  }
}

// Told when the server no longer knows this browser's session: it restarted, or a
// PIN change elsewhere ended it (specs/07-security-and-access.md §2).
let onUnauthorized: (() => void) | undefined;
export function setUnauthorizedHandler(handler: (() => void) | undefined): void {
  onUnauthorized = handler;
}

function isEnvelope(value: unknown): value is ErrorEnvelope {
  const error = (value as { error?: { code?: unknown } } | null)?.error;
  return typeof error?.code === 'string';
}

export async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers:
        body === undefined
          ? { accept: 'application/json' }
          : { accept: 'application/json', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  if (response.ok) {
    return (response.status === 204 ? undefined : await response.json()) as T;
  }
  const payload: unknown = await response.json().catch(() => undefined);
  const code: ClientErrorCode = isEnvelope(payload) ? payload.error.code : 'internal_error';
  const seconds = Number(response.headers.get('retry-after'));
  const error = new ApiError(response.status, code, Number.isFinite(seconds) && seconds > 0 ? seconds : undefined);
  if (code === 'unauthorized') onUnauthorized?.();
  throw error;
}

/** The code of anything a request threw. */
export function errorCode(error: unknown): ClientErrorCode {
  return error instanceof ApiError ? error.code : 'internal_error';
}
