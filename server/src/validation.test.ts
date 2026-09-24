import { Type } from 'typebox';
import { describe, expect, it } from 'vitest';
import { CommandEnvelopeSchema, ErrorEnvelopeSchema, EventEnvelopeSchema } from '@emberglass/shared';
import { VALIDATION_OPTIONS, compileSchema, formatAjvErrors } from './validation.js';

// The shared schemas as the server's validator judges them: the client relies on
// the same shapes, so each must refuse what it does not describe.
describe('shared envelope schemas under the strict validator', () => {
  const isError = compileSchema(ErrorEnvelopeSchema);
  const isEvent = compileSchema(EventEnvelopeSchema);
  const isCommand = compileSchema(CommandEnvelopeSchema);

  it('accepts well-formed envelopes', () => {
    expect(isError({ error: { code: 'not_found', message: 'No such resource.' } })).toBe(true);
    expect(
      isError({ error: { code: 'validation_failed', message: 'm', details: [{ path: '/a', message: 'b' }] } }),
    ).toBe(true);
    expect(isEvent({ type: 'token.added', version: 1, payload: {} })).toBe(true);
    expect(isCommand({ type: 'undo', payload: {} })).toBe(true);
  });

  it.each([
    ['an extra top-level field', { error: { code: 'not_found', message: 'm' }, stack: 'x' }],
    ['an extra error field', { error: { code: 'not_found', message: 'm', stack: 'x' } }],
    [
      'an extra detail field',
      { error: { code: 'not_found', message: 'm', details: [{ path: '', message: 'm', value: 1 }] } },
    ],
    ['an unknown code', { error: { code: 'teapot', message: 'm' } }],
    ['a missing message', { error: { code: 'not_found' } }],
  ])('refuses an error envelope with %s', (_case, value) => {
    expect(isError(value)).toBe(false);
  });

  it.each([
    ['version 0', { type: 'token.added', version: 0, payload: {} }],
    ['a fractional version', { type: 'token.added', version: 1.5, payload: {} }],
    ['a string version', { type: 'token.added', version: '1', payload: {} }],
    ['no version', { type: 'token.added', payload: {} }],
    ['an unknown type', { type: 'token.teleported', version: 1, payload: {} }],
    ['a command name as type', { type: 'token.add', version: 1, payload: {} }],
    ['an extra field', { type: 'token.added', version: 1, payload: {}, room: 'dm' }],
    ['an array payload', { type: 'token.added', version: 1, payload: [] }],
  ])('refuses an event envelope with %s', (_case, value) => {
    expect(isEvent(value)).toBe(false);
  });
});

describe('the strict validator', () => {
  it('refuses a schema with an unknown keyword instead of ignoring it', () => {
    expect(() => compileSchema({ type: 'object', sanitize: true })).toThrow(/strict mode/);
  });

  it('never coerces, strips or fills defaults, and reads only own properties', () => {
    expect(VALIDATION_OPTIONS).toMatchObject({
      coerceTypes: false,
      removeAdditional: false,
      useDefaults: false,
      strict: true,
      ownProperties: true,
    });
    const schema = Type.Object({ pin: Type.String() }, { additionalProperties: false });
    const validate = compileSchema(schema);
    // A value whose `pin` comes only from its prototype does not have one.
    expect(validate(Object.create({ pin: '1234' }) as object)).toBe(false);
  });

  it('writes detail paths as escaped JSON Pointers, cutting long names short', () => {
    const validate = compileSchema({
      type: 'object',
      required: ['a/b~c'],
      properties: { 'a/b~c': { type: 'string' } },
      additionalProperties: false,
    });
    validate({});
    expect(formatAjvErrors(validate.errors, '/payload')[0]?.path).toBe('/payload/a~1b~0c');
    validate({ 'a/b~c': 'x', ['k'.repeat(100)]: 1 });
    expect(formatAjvErrors(validate.errors)[0]?.path).toBe(`/${'k'.repeat(64)}…`);
  });
});
