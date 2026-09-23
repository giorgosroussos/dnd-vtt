import { Type } from 'typebox';
import { describe, expect, it, vi } from 'vitest';
import { COMMAND_TYPES, ErrorEnvelopeSchema, type CommandEnvelope, type ErrorEnvelope } from '@emberglass/shared';
import { compileSchema } from '../validation.js';
import {
  COMMAND_PAYLOAD_SCHEMAS,
  createCommandValidator,
  dispatchCommand,
  validateCommand,
  type CommandValidator,
} from './commands.js';
import { createVersionCounter } from './version.js';

// A stand-in payload schema, shaped the way LIV-02 will register `token.move`.
const MovePayloadSchema = Type.Object(
  { tokenId: Type.String({ minLength: 1 }), x: Type.Number(), y: Type.Number() },
  { additionalProperties: false },
);

const isEnvelope = compileSchema<ErrorEnvelope>(ErrorEnvelopeSchema);

interface Board {
  tokens: Record<string, { x: number; y: number }>;
}

// The live state a command targets, and the apply step a handler would run:
// it moves the token and emits an event with the next version.
function harness(validate: CommandValidator) {
  const board: Board = { tokens: { t1: { x: 1, y: 2 } } };
  const counter = createVersionCounter();
  const apply = vi.fn((command: CommandEnvelope) => {
    const { tokenId, x, y } = command.payload as { tokenId: string; x: number; y: number };
    board.tokens[tokenId] = { x, y };
    counter.next();
  });
  return { board, counter, apply, send: (raw: unknown) => dispatchCommand(raw, validate, apply) };
}

const validate = createCommandValidator({ 'token.move': MovePayloadSchema });

describe('command validation and dispatch', () => {
  it('applies a valid command and acknowledges it', () => {
    const { board, counter, apply, send } = harness(validate);
    expect(send({ type: 'token.move', payload: { tokenId: 't1', x: 3.5, y: 4 } })).toEqual({ ok: true });
    expect(apply).toHaveBeenCalledOnce();
    expect(board.tokens.t1).toEqual({ x: 3.5, y: 4 });
    expect(counter.current()).toBe(1);
  });

  it.each([
    ['not an object', 'token.move', 'validation_failed', ''],
    ['an array', [{ type: 'token.move' }], 'validation_failed', ''],
    ['null', null, 'validation_failed', ''],
    ['an unknown command type', { type: 'token.teleport', payload: {} }, 'validation_failed', '/type'],
    ['a missing type', { payload: { tokenId: 't1', x: 0, y: 0 } }, 'validation_failed', '/type'],
    ['a missing payload', { type: 'token.move' }, 'validation_failed', '/payload'],
    ['a payload that is not an object', { type: 'token.move', payload: [0, 0] }, 'validation_failed', '/payload'],
    [
      'an extra envelope field',
      { type: 'token.move', payload: { tokenId: 't1', x: 0, y: 0 }, role: 'dm' },
      'validation_failed',
      '/role',
    ],
    [
      'a payload of the wrong type',
      { type: 'token.move', payload: { tokenId: 't1', x: '9', y: 0 } },
      'validation_failed',
      '/payload/x',
    ],
    [
      'a payload missing a field',
      { type: 'token.move', payload: { tokenId: 't1', x: 9 } },
      'validation_failed',
      '/payload/y',
    ],
    [
      'a payload with an extra field',
      { type: 'token.move', payload: { tokenId: 't1', x: 9, y: 9, hidden: false } },
      'validation_failed',
      '/payload/hidden',
    ],
    [
      'a command with no payload schema yet',
      { type: 'token.delete', payload: { tokenId: 't1' } },
      'command_unsupported',
      null,
    ],
  ])('rejects %s in the error envelope and changes nothing', (_case, raw, code, pointer) => {
    const { board, counter, apply, send } = harness(validate);
    const before = structuredClone(board);

    const ack = send(raw);

    expect(isEnvelope(ack), JSON.stringify(isEnvelope.errors)).toBe(true);
    const envelope = ack as ErrorEnvelope;
    expect(envelope.error.code).toBe(code);
    if (pointer !== null) expect(envelope.error.details?.map((detail) => detail.path)).toContain(pointer);
    expect(apply).not.toHaveBeenCalled();
    expect(board).toEqual(before);
    expect(counter.current()).toBe(0);
  });

  it('never trusts a role the client declares inside the payload', () => {
    const { apply, send } = harness(validate);
    const ack = send({ type: 'token.move', payload: { tokenId: 't1', x: 0, y: 0, role: 'dm' } });
    expect((ack as ErrorEnvelope).error.code).toBe('validation_failed');
    expect(apply).not.toHaveBeenCalled();
  });
});

describe('the process command validator', () => {
  // No package has registered a payload schema yet (LIV-01 onward), so every
  // command is refused, whatever its content: fail closed, never open.
  it('has no payload schema registered yet', () => {
    expect(COMMAND_PAYLOAD_SCHEMAS).toEqual({});
  });

  it.each(COMMAND_TYPES)('refuses %s as unsupported', (type) => {
    const { board, apply, send } = harness(validateCommand);
    const before = structuredClone(board);
    expect(send({ type, payload: {} })).toEqual({
      error: { code: 'command_unsupported', message: 'This command is not supported yet.' },
    });
    expect(apply).not.toHaveBeenCalled();
    expect(board).toEqual(before);
  });
});
