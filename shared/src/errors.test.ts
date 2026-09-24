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

  it('carries the usages of an asset in use, and none otherwise', () => {
    const usage = {
      scene_id: '0b7a4c52-9d1e-4f3a-8b6c-2e5d7f9a1c3b',
      scene_name: 'Cave',
      session_id: '1b7a4c52-9d1e-4f3a-8b6c-2e5d7f9a1c3b',
      session_title: 'One',
      campaign_id: '2b7a4c52-9d1e-4f3a-8b6c-2e5d7f9a1c3b',
      campaign_name: 'Lost Mine',
      tokens: 2,
    };
    expect(errorEnvelope('asset_in_use', 'In use.', undefined, [usage])).toEqual({
      error: { code: 'asset_in_use', message: 'In use.', usages: [usage] },
    });
    expect(Object.keys(errorEnvelope('asset_in_use', 'In use.').error)).toEqual(['code', 'message']);
  });

  it('has a schema whose codes are exactly ERROR_CODES', () => {
    const code = ErrorEnvelopeSchema.properties.error.properties.code;
    expect(code.enum).toEqual([...ERROR_CODES]);
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});
