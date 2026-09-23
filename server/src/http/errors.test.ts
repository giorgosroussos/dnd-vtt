import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorEnvelopeSchema, type ErrorEnvelope } from '@emberglass/shared';
import { createLogger, logFilePath, type TextSink } from '../log/logger.js';
import { compileSchema } from '../validation.js';
import { buildApp } from './app.js';

// A body schema built the way every REST resource builds its own: in TypeBox,
// from which both the JSON Schema and the TypeScript type come (D-062).
const ProbeBodySchema = Type.Object(
  { name: Type.String({ minLength: 1 }), size: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);

const isEnvelope = compileSchema<ErrorEnvelope>(ErrorEnvelopeSchema);

class Capture implements TextSink {
  text = '';
  write(chunk: string): boolean {
    this.text += chunk;
    return true;
  }
}

describe('REST error envelope and logging', () => {
  let root: string;
  let dataDir: string;
  let app: FastifyInstance;
  const stdout = new Capture();
  const stderr = new Capture();
  const received: unknown[] = [];

  beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'emberglass-http-'));
    dataDir = path.join(root, 'data');
    const dist = path.join(root, 'dist');
    mkdirSync(dist);
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
    const logger = createLogger({ dataDir, stdout, stderr });
    app = await buildApp({ client: { kind: 'static', dist }, logger });
    // Test routes standing in for the REST resources of the SRV packages.
    app.post('/api/_probe', { schema: { body: ProbeBodySchema } }, (request, reply) => {
      received.push(request.body);
      return reply.send({ ok: true });
    });
    app.post('/api/_explode', (request) => {
      // A bug that puts request data into an error message.
      throw new Error(`could not handle cookie=${request.headers.cookie ?? ''}; body=${JSON.stringify(request.body)}`);
    });
  });

  afterAll(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  const post = (url: string, payload: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, payload, headers: { 'content-type': 'application/json', ...headers } });

  const expectEnvelope = (body: unknown, code: ErrorEnvelope['error']['code']): ErrorEnvelope => {
    expect(isEnvelope(body), JSON.stringify(isEnvelope.errors)).toBe(true);
    const envelope = body as ErrorEnvelope;
    expect(envelope.error.code).toBe(code);
    return envelope;
  };

  it('answers an unknown /api path with 404 in the envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/no-such-thing?x=1' });
    expect(response.statusCode).toBe(404);
    expectEnvelope(response.json(), 'not_found');
  });

  it('accepts a body that matches its schema', async () => {
    const response = await post('/api/_probe', JSON.stringify({ name: 'Goblin', size: 1 }));
    expect(response.statusCode).toBe(200);
    expect(received.at(-1)).toEqual({ name: 'Goblin', size: 1 });
  });

  it.each([
    ['a wrong type', { name: 'Goblin', size: 'large' }, '/size'],
    ['a string where a number belongs, not coerced', { name: 'Goblin', size: '2' }, '/size'],
    ['a missing field', { name: 'Goblin' }, '/size'],
    ['an unknown field, not stripped', { name: 'Goblin', size: 1, admin: true }, '/admin'],
    ['a value below its minimum', { name: 'Goblin', size: 0 }, '/size'],
  ])('answers a body with %s with 400 validation_failed and changes nothing', async (_case, body, pointer) => {
    const before = received.length;
    const response = await post('/api/_probe', JSON.stringify(body));
    expect(response.statusCode).toBe(400);
    const envelope = expectEnvelope(response.json(), 'validation_failed');
    expect(envelope.error.details?.map((detail) => detail.path)).toContain(pointer);
    expect(received.length).toBe(before);
  });

  it('answers a body that is not an object with 400 validation_failed', async () => {
    const response = await post('/api/_probe', JSON.stringify(['Goblin', 1]));
    expect(response.statusCode).toBe(400);
    expectEnvelope(response.json(), 'validation_failed');
  });

  it('answers malformed and empty JSON with 400 malformed_body', async () => {
    for (const payload of ['{"name": "Goblin",', '']) {
      const response = await post('/api/_probe', payload);
      expect(response.statusCode).toBe(400);
      expectEnvelope(response.json(), 'malformed_body');
    }
  });

  it('answers an unsupported media type with 415', async () => {
    const response = await post('/api/_probe', '<name>Goblin</name>', { 'content-type': 'application/xml' });
    expect(response.statusCode).toBe(415);
    expectEnvelope(response.json(), 'unsupported_media_type');
  });

  it('answers a server failure with 500 internal_error and no detail of the failure', async () => {
    const response = await post('/api/_explode', '{}');
    expect(response.statusCode).toBe(500);
    const envelope = expectEnvelope(response.json(), 'internal_error');
    expect(envelope.error).toEqual({ code: 'internal_error', message: 'Something went wrong on the server.' });
    expect(response.body).not.toMatch(/could not handle|at .*\.ts/);
  });

  it('keeps a PIN, a session cookie and a session identifier out of the console and the log file', async () => {
    const pin = '48213';
    const sessionId = 's3ss10n-7f1c9a2e4b6d8f0a1c3e5a7b9d1f3e5a';
    const cookie = `emberglass_session=${sessionId}; theme=dark`;
    const headers = { cookie, 'x-session-id': sessionId };
    stdout.text = '';
    stderr.text = '';

    // Rejected by the schema (logged as a warning), rejected as malformed
    // JSON, and failing on the server with the credentials in the error.
    const invalid = await post(
      `/api/_probe?sessionId=${sessionId}&pin=${pin}`,
      JSON.stringify({ pin, name: 'x' }),
      headers,
    );
    const malformed = await post(`/api/_probe?session=${sessionId}`, `{"pin":"${pin}",`, headers);
    const failed = await post(`/api/_explode?sid=${sessionId}`, JSON.stringify({ pin, currentPin: pin }), headers);
    expect([invalid.statusCode, malformed.statusCode, failed.statusCode]).toEqual([400, 400, 500]);

    const file = readFileSync(logFilePath(dataDir), 'utf8');
    const consoleText = stdout.text + stderr.text;
    // Each request left a line in both outputs, so the absence below is not an empty log.
    const lines = file
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const mine = lines.filter((line) => line.path === '/api/_probe' || line.path === '/api/_explode');
    expect(mine.map((line) => line.event)).toEqual(expect.arrayContaining(['http.rejected', 'http.error']));
    expect(mine.length).toBeGreaterThanOrEqual(3);
    expect(consoleText).toContain('Request rejected.');
    expect(consoleText).toContain('Request failed on the server.');

    for (const output of [file, consoleText]) {
      expect(output).not.toContain(pin);
      expect(output).not.toContain(sessionId);
      expect(output).not.toContain(cookie);
      expect(output).not.toContain('emberglass_session=s3ss');
    }
    expect(file).toContain('[redacted]');
  });
});
