import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMMAND_TYPES, CommandEnvelopeSchema, EVENT_TYPES, EventEnvelopeSchema, SOCKET_CHANNELS } from './index.js';

// The first column of the table in one section of specs/04-live-sync.md, split
// on commas, with backticks removed.
function tableNames(section: string): string[] {
  const spec = readFileSync(new URL('../../specs/04-live-sync.md', import.meta.url), 'utf8');
  const body = spec.split(/^## /m).find((part) => part.startsWith(`${section}. `));
  if (!body) throw new Error(`section ${section} not found`);
  return body
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .flatMap((line) => line.split('|')[1]!.split(','))
    .map((cell) => cell.trim().replaceAll('`', ''));
}

describe('WebSocket envelope names', () => {
  it('lists exactly the commands of specs/04-live-sync.md §2', () => {
    expect([...COMMAND_TYPES].sort()).toEqual(tableNames('2').sort());
  });

  it('lists exactly the events of specs/04-live-sync.md §3', () => {
    expect([...EVENT_TYPES].sort()).toEqual(tableNames('3').sort());
  });

  it('uses one Socket.io channel for commands and one for events', () => {
    expect(SOCKET_CHANNELS).toEqual({ command: 'command', event: 'event' });
  });
});

describe('envelope schemas', () => {
  it('are plain JSON Schema objects that forbid unknown envelope fields', () => {
    for (const schema of [CommandEnvelopeSchema, EventEnvelopeSchema] as object[]) {
      expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
      expect(schema).toHaveProperty('additionalProperties', false);
    }
    expect(CommandEnvelopeSchema.required).toEqual(['type', 'payload']);
    expect(EventEnvelopeSchema.required).toEqual(['type', 'version', 'payload']);
  });

  it('requires an event version that is a whole number from 1', () => {
    expect(EventEnvelopeSchema.properties.version).toMatchObject({ type: 'integer', minimum: 1 });
  });
});
