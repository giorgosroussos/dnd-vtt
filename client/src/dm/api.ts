import { API_IMAGE_PATHS, type AssetUsage, type ErrorCode, type ErrorEnvelope, type Image } from '@emberglass/shared';

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
    /** The scenes that use an asset, sent with `asset_in_use` (D-083). */
    readonly usages: readonly AssetUsage[] = [],
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
  return answer<T>(
    send(path, {
      method,
      headers:
        body === undefined
          ? { accept: 'application/json' }
          : { accept: 'application/json', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

/**
 * Uploads a file's bytes as the whole body (D-080). The server judges the type by
 * content; the browser's own Content-Type for the file is sent as it is. It goes by
 * XMLHttpRequest, because `fetch` reports no upload progress: `onProgress` is told
 * the fraction sent, from 0 to 1 (G-017, D-090).
 */
export function upload(file: Blob, onProgress?: (fraction: number) => void): Promise<Image> {
  return new Promise<Image>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', API_IMAGE_PATHS.images);
    xhr.setRequestHeader('accept', 'application/json');
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
      };
    }
    xhr.onload = () => {
      const response = new Response(xhr.status === 204 ? null : xhr.responseText, {
        status: xhr.status,
        headers: parseHeaders(xhr.getAllResponseHeaders()),
      });
      answer<Image>(Promise.resolve(response)).then(resolve, reject);
    };
    xhr.onerror = () => reject(new ApiError(0, 'network'));
    xhr.onabort = () => reject(new ApiError(0, 'network'));
    xhr.send(file);
  });
}

function parseHeaders(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const at = line.indexOf(':');
    if (at > 0) headers.append(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return headers;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, { ...init, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network');
  }
}

async function answer<T>(pending: Promise<Response>): Promise<T> {
  const response = await pending;
  if (response.ok) {
    return (response.status === 204 ? undefined : await response.json()) as T;
  }
  const payload: unknown = await response.json().catch(() => undefined);
  const envelope = isEnvelope(payload) ? payload.error : undefined;
  const code: ClientErrorCode = envelope?.code ?? 'internal_error';
  const seconds = Number(response.headers.get('retry-after'));
  const error = new ApiError(
    response.status,
    code,
    Number.isFinite(seconds) && seconds > 0 ? seconds : undefined,
    envelope?.usages ?? [],
  );
  if (code === 'unauthorized') onUnauthorized?.();
  throw error;
}

/** The code of anything a request threw. */
export function errorCode(error: unknown): ClientErrorCode {
  return error instanceof ApiError ? error.code : 'internal_error';
}
