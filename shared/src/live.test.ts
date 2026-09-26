import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import {
  COMMAND_TYPES,
  CommandEnvelopeSchema,
  DmSnapshotSchema,
  EVENT_TYPES,
  EventEnvelopeSchema,
  PlayerLiveSceneSchema,
  PlayerMapSchema,
  PlayerSnapshotSchema,
  PlayerTokenSchema,
  LIVE_COMMAND_PAYLOAD_SCHEMAS,
  PlayerTokenAddedPayloadSchema,
  PlayerTokenUpdatedPayloadSchema,
  ROOMS,
  SceneClearedPayloadSchema,
  SOCKET_CHANNELS,
  TokenRemovedPayloadSchema,
} from './index.js';

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

  it('uses one Socket.io channel for commands, one for events and one for snapshot requests', () => {
    expect(SOCKET_CHANNELS).toEqual({ command: 'command', event: 'event', snapshot: 'snapshot' });
    // A snapshot request is not one of the commands of §2, so the players room may send it.
    expect(COMMAND_TYPES).not.toContain(SOCKET_CHANNELS.snapshot);
  });

  it('names the two rooms of specs/04-live-sync.md §1', () => {
    expect(ROOMS).toEqual(['dm', 'players']);
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

describe('snapshot payloads (specs/04-live-sync.md §4, LIV-01)', () => {
  const token = {
    id: '00000000-0000-4000-8000-000000000001',
    x: 1.5,
    y: 2,
    size: 'medium',
    image_id: 'a'.repeat(64),
    z_order: 0,
    label: 'Goblin 1',
  };

  it('gives a player token exactly the rendering fields: id, position, size, image, stacking order and label', () => {
    expect(Object.keys(PlayerTokenSchema.properties).sort()).toEqual(
      ['id', 'image_id', 'label', 'size', 'x', 'y', 'z_order'].sort(),
    );
    expect(Value.Check(PlayerTokenSchema, token)).toBe(true);
  });

  it('refuses a player token carrying a hidden flag, an asset, a scene or notes', () => {
    for (const extra of [
      { hidden: false },
      { asset_id: token.id },
      { scene_id: token.id },
      { asset: { name: 'Goblin' } },
      { notes: '' },
      { character_id: null },
    ]) {
      expect(Value.Check(PlayerTokenSchema, { ...token, ...extra }), JSON.stringify(extra)).toBe(false);
    }
  });

  it('keeps a player stacking order a whole rank from 0, not the stored order', () => {
    expect(Value.Check(PlayerTokenSchema, { ...token, z_order: -1 })).toBe(false);
    expect(Value.Check(PlayerTokenSchema, { ...token, z_order: 0.5 })).toBe(false);
  });

  it('gives players no scene id or name and only the display version of the map', () => {
    expect(Object.keys(PlayerLiveSceneSchema.properties).sort()).toEqual(['grid', 'map', 'tokens']);
    expect(Object.keys(PlayerMapSchema.properties).sort()).toEqual(['height', 'id', 'variants', 'width']);
    expect(Object.keys(PlayerMapSchema.properties.variants.properties)).toEqual(['display']);
  });

  it('is strict at every level and says which room it is for', () => {
    const strictObjects = (schema: unknown): unknown[] => {
      if (typeof schema !== 'object' || schema === null) return [];
      const node = schema as Record<string, unknown>;
      const own = node.type === 'object' ? [node] : [];
      return [...own, ...Object.values(node).flatMap(strictObjects)];
    };
    for (const schema of [PlayerSnapshotSchema, DmSnapshotSchema]) {
      for (const object of strictObjects(schema)) expect(object).toHaveProperty('additionalProperties', false);
    }
    expect(Value.Check(PlayerSnapshotSchema, { role: 'players', scene: null })).toBe(true);
    expect(Value.Check(DmSnapshotSchema, { role: 'dm', scene: null })).toBe(true);
    expect(Value.Check(PlayerSnapshotSchema, { role: 'dm', scene: null })).toBe(false);
  });
});

describe('live command and event payloads (specs/04-live-sync.md §2, §3, §4, LIV-02)', () => {
  const objects = (schema: unknown): Record<string, unknown>[] => {
    if (typeof schema !== 'object' || schema === null) return [];
    const node = schema as Record<string, unknown>;
    return [...(node.type === 'object' ? [node] : []), ...Object.values(node).flatMap(objects)];
  };
  const id = '00000000-0000-4000-8000-000000000001';

  it('defines a payload for the commands LIV-02 implements and no other', () => {
    expect(Object.keys(LIVE_COMMAND_PAYLOAD_SCHEMAS).sort()).toEqual(
      ['scene.activate', 'scene.deactivate', 'token.add', 'token.delete', 'token.move', 'token.setVisibility'].sort(),
    );
    for (const type of Object.keys(LIVE_COMMAND_PAYLOAD_SCHEMAS)) expect(COMMAND_TYPES).toContain(type);
  });

  it('keeps every command and event payload strict at every level', () => {
    for (const schema of [
      ...Object.values(LIVE_COMMAND_PAYLOAD_SCHEMAS),
      PlayerTokenAddedPayloadSchema,
      PlayerTokenUpdatedPayloadSchema,
      TokenRemovedPayloadSchema,
      SceneClearedPayloadSchema,
    ] as object[]) {
      for (const object of objects(schema)) expect(object).toHaveProperty('additionalProperties', false);
    }
  });

  it('lets a client choose neither the label, the visibility nor the stacking of a live token', () => {
    const add = LIVE_COMMAND_PAYLOAD_SCHEMAS['token.add'];
    expect(Object.keys(add.properties).sort()).toEqual(['asset_id', 'scene_id', 'x', 'y']);
    const base = { scene_id: id, asset_id: id, x: 1, y: 1 };
    expect(Value.Check(add, base)).toBe(true);
    for (const extra of [{ hidden: false }, { label: 'Boss' }, { z_order: 0 }, { id }]) {
      expect(Value.Check(add, { ...base, ...extra }), JSON.stringify(extra)).toBe(false);
    }
    expect(Value.Check(LIVE_COMMAND_PAYLOAD_SCHEMAS['token.move'], { token_id: id, x: 1, y: 1, label: 'x' })).toBe(
      false,
    );
  });

  it('gives players tokens of the player shape only, and the id alone on removal, whether hidden or deleted', () => {
    expect(PlayerTokenAddedPayloadSchema.properties.token).toBe(PlayerTokenSchema);
    expect(PlayerTokenAddedPayloadSchema.properties.relabelled.items).toBe(PlayerTokenSchema);
    expect(PlayerTokenUpdatedPayloadSchema.properties.token).toBe(PlayerTokenSchema);
    expect(Object.keys(TokenRemovedPayloadSchema.properties)).toEqual(['id']);
  });
});
