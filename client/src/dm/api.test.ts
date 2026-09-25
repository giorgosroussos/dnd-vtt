// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, setUnauthorizedHandler, upload } from './api.js';

// The real upload() over XMLHttpRequest (PRP-02 review L-4, D-090), against a stand-in
// XMLHttpRequest that answers with raw header text as a browser does, so that the progress,
// the header parsing, the envelope and the failures of api.ts itself are what is tested.

interface Script {
  status?: number;
  body?: string;
  headers?: string;
  progress?: [number, number][];
  fail?: 'error' | 'abort';
}

let script: Script;
let sent: { method: string; url: string; body: unknown; headers: Record<string, string> }[];
const original = globalThis.XMLHttpRequest;

class StubXhr {
  status = 0;
  responseText = '';
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private request = { method: '', url: '', body: undefined as unknown, headers: {} as Record<string, string> };
  open(method: string, url: string) {
    this.request.method = method;
    this.request.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.request.headers[name] = value;
  }
  getAllResponseHeaders() {
    return script.headers ?? '';
  }
  send(body: unknown) {
    this.request.body = body;
    sent.push(this.request);
    setTimeout(() => {
      for (const [loaded, total] of script.progress ?? []) {
        this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
      }
      if (script.fail === 'error') return this.onerror?.();
      if (script.fail === 'abort') return this.onabort?.();
      this.status = script.status ?? 200;
      this.responseText = script.body ?? '';
      this.onload?.();
    }, 0);
  }
}

beforeEach(() => {
  sent = [];
  globalThis.XMLHttpRequest = StubXhr as unknown as typeof XMLHttpRequest;
});

afterEach(() => {
  globalThis.XMLHttpRequest = original;
  setUnauthorizedHandler(undefined);
});

const IMAGE = { id: 'a'.repeat(64), mime: 'image/png', width: 1, height: 1, variants: {}, grid_preset: null };
const file = new Blob([new Uint8Array(10)], { type: 'image/png' });

describe('upload() (D-080, D-090)', () => {
  it('posts the file as the whole body to /api/images, reports its progress and answers the image', async () => {
    script = {
      status: 201,
      body: JSON.stringify(IMAGE),
      progress: [
        [0, 10],
        [4, 10],
        [10, 10],
      ],
    };
    const fractions: number[] = [];
    await expect(upload(file, (fraction) => fractions.push(fraction))).resolves.toEqual(IMAGE);
    expect(sent).toEqual([{ method: 'POST', url: '/api/images', body: file, headers: { accept: 'application/json' } }]);
    expect(fractions).toEqual([0, 0.4, 1]);
  });

  it('turns a refusal into an ApiError with the envelope code, reading CRLF header text', async () => {
    script = {
      status: 413,
      body: JSON.stringify({ error: { code: 'payload_too_large', message: 'x' } }),
      headers: 'content-type: application/json\r\nconnection: close\r\n',
    };
    const error = await upload(file).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 413, code: 'payload_too_large' });
  });

  it('reads Retry-After and tells the unauthorized handler, as every other request does', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    script = {
      status: 401,
      body: JSON.stringify({ error: { code: 'unauthorized', message: 'x' } }),
      headers: 'Content-Type: application/json\r\nRetry-After: 30\r\n',
    };
    await expect(upload(file)).rejects.toMatchObject({ code: 'unauthorized', retryAfter: 30 });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('answers an unreadable failure as internal_error', async () => {
    script = { status: 502, body: '<html>bad gateway</html>' };
    await expect(upload(file)).rejects.toMatchObject({ status: 502, code: 'internal_error' });
  });

  it.each(['error', 'abort'] as const)(
    'turns a request that got no answer (%s) into the network error',
    async (fail) => {
      script = { fail };
      await expect(upload(file)).rejects.toMatchObject({ status: 0, code: 'network' });
    },
  );

  it('reports no progress when the total is unknown', async () => {
    script = { status: 201, body: JSON.stringify(IMAGE) };
    const fractions: number[] = [];
    await upload(file, (fraction) => fractions.push(fraction));
    expect(fractions).toEqual([]);
  });
});
