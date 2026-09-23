import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ErrorEnvelopeSchema, errorEnvelope } from './index.js';

describe('errorEnvelope', () => {
  it('wraps a code and message under `error`', () => {
    expect(errorEnvelope('not_found', 'No such path.')).toEqual({
      error: { code: 'not_found', message: 'No such path.' },
    });
  });

  it('carries details only when there are some', () => {
    expect(errorEnvelope('validation_failed', 'Invalid.', [])).toEqual({
      error: { code: 'validation_failed', message: 'Invalid.' },
    });
    expect(errorEnvelope('validation_failed', 'Invalid.', [{ path: '/name', message: 'must be string' }])).toEqual({
      error: {
        code: 'validation_failed',
        message: 'Invalid.',
        details: [{ path: '/name', message: 'must be string' }],
      },
    });
  });

  it('has a schema whose codes are exactly ERROR_CODES', () => {
    const code = ErrorEnvelopeSchema.properties.error.properties.code;
    expect(code.enum).toEqual([...ERROR_CODES]);
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});
