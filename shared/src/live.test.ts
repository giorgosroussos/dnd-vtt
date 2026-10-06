import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import {
  CONDITION_IDS,
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
  CAMERA_BOUNDS,
  DmCameraPayloadSchema,
  FIT_CAMERA,
  PlayerCameraPayloadSchema,
  PlayerCameraSchema,
  ScreenSchema,
  MeasurementSchema,
  RulerClearedPayloadSchema,
  RulerShownPayloadSchema,
  PlayerEncounterPayloadSchema,
  DmEncounterPayloadSchema,
  PlayerEncounterSchema,
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

  it('uses one Socket.io channel for commands, one for events, one for snapshot requests and one for viewport reports', () => {
    expect(SOCKET_CHANNELS).toEqual({ command: 'command', event: 'event', snapshot: 'snapshot', viewport: 'viewport' });
    // Neither a snapshot request nor a viewport report is one of the commands of §2, so the players
    // room may send them (D-104, D-119).
    expect(COMMAND_TYPES).not.toContain(SOCKET_CHANNELS.snapshot);
    expect(COMMAND_TYPES).not.toContain(SOCKET_CHANNELS.viewport);
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
    category: 'monster',
    markers: [{ id: 'bloodied' }, { id: 'exhaustion', level: 2 }, { id: 'concentrating' }],
  };

  it('refuses markers a token cannot carry: an unknown one, one twice, a bare name, a level out of place, or more than there are (TBL-05)', () => {
    const all = CONDITION_IDS.map((id) => (id === 'exhaustion' ? { id, level: 1 } : { id }));
    for (const markers of [
      [{ id: 'hasted' }],
      [{ id: 'dead' }, { id: 'dead' }],
      [{ id: 'BLOODIED' }],
      ['bloodied'],
      [{ id: 'exhaustion' }],
      [{ id: 'exhaustion', level: 0 }],
      [{ id: 'exhaustion', level: 7 }],
      [{ id: 'exhaustion', level: 2.5 }],
      [{ id: 'prone', level: 1 }],
      [{ id: 'prone', note: 'x' }],
      [...all, { id: 'dead' }],
    ]) {
      expect(Value.Check(PlayerTokenSchema, { ...token, markers }), JSON.stringify(markers)).toBe(false);
    }
    expect(Value.Check(PlayerTokenSchema, { ...token, markers: [] })).toBe(true);
    expect(Value.Check(PlayerTokenSchema, { ...token, markers: all })).toBe(true);
  });

  it('gives a player token exactly the rendering fields: id, position, size, image, stacking order, label, category and markers', () => {
    expect(Object.keys(PlayerTokenSchema.properties).sort()).toEqual(
      ['category', 'id', 'image_id', 'label', 'markers', 'size', 'x', 'y', 'z_order'].sort(),
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

  it('gives players no scene id, the name the TV shows (UIX-01), the painted fog (TBL-04), and only the display version of the map', () => {
    expect(Object.keys(PlayerLiveSceneSchema.properties).sort()).toEqual([
      'camera',
      'encounter',
      'fog',
      'grid',
      'map',
      'name',
      'ruler',
      'tokens',
    ]);
    // The players' encounter is the round, the entries they may see and whose turn it is: no number, no
    // scene (TBL-06, DMT-02, specs/04-live-sync.md §4).
    expect(Object.keys(PlayerEncounterSchema.properties).sort()).toEqual(['current', 'entries', 'next', 'round']);
    expect(Object.keys(PlayerEncounterSchema.properties.entries.items.properties).sort()).toEqual([
      'id',
      'kind',
      'token_id',
    ]);
    // A measurement is two squares and a distance: no scene, no token (LIV-07).
    expect(Object.keys(MeasurementSchema.properties).sort()).toEqual(['feet', 'from', 'to']);
    // The players' camera is the rectangle alone: no screen of another viewer (D-119).
    expect(Object.keys(PlayerCameraSchema.properties).sort()).toEqual(['centre_x', 'centre_y', 'height', 'width']);
    expect(Object.keys(PlayerMapSchema.properties).sort()).toEqual(['height', 'id', 'variants', 'width']);
    expect(Object.keys(PlayerMapSchema.properties.variants.properties)).toEqual(['display']);
    // The fog is cells alone: rows of fogged runs, nothing that names a token or the scene (TBL-04).
    expect(Value.Check(PlayerLiveSceneSchema.properties.fog, [{ y: 0, runs: [0, 8] }])).toBe(true);
    for (const extra of [{ name: 'Back room' }, { id: '00000000-0000-4000-8000-000000000001' }, { hidden: true }]) {
      expect(
        Value.Check(PlayerLiveSceneSchema.properties.fog, [{ y: 0, runs: [0, 8], ...extra }]),
        JSON.stringify(extra),
      ).toBe(false);
    }
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

  it('defines a payload for every command of specs/04-live-sync.md §2, redo (UIX-01), ping (TBL-01), token.setMarkers (TBL-02), the fog commands (TBL-04) and token.batch (UXR-02) the last', () => {
    expect(Object.keys(LIVE_COMMAND_PAYLOAD_SCHEMAS).sort()).toEqual([...COMMAND_TYPES].sort());
    expect(Object.keys(LIVE_COMMAND_PAYLOAD_SCHEMAS).sort()).toEqual(
      [
        'camera.setPlayer',
        'ruler.clear',
        'ruler.update',
        'scene.activate',
        'scene.deactivate',
        'token.add',
        'token.delete',
        'token.move',
        'token.setVisibility',
        'token.setMarkers',
        'token.setStats',
        'token.applyHp',
        'token.batch',
        'fog.paint',
        'fog.fill',
        'undo',
        'redo',
        'ping',
        'encounter.start',
        'encounter.end',
        'encounter.reorder',
        'encounter.setInitiative',
        'encounter.next',
        'encounter.previous',
        'encounter.addEntry',
        'encounter.removeEntry',
      ].sort(),
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
      PlayerCameraPayloadSchema,
      DmCameraPayloadSchema,
      ScreenSchema,
      RulerShownPayloadSchema,
      RulerClearedPayloadSchema,
      DmEncounterPayloadSchema,
      PlayerEncounterPayloadSchema,
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

  it('lets camera.setPlayer name the live scene and a camera within sane bounds, and nothing else (LIV-06)', () => {
    const set = LIVE_COMMAND_PAYLOAD_SCHEMAS['camera.setPlayer'];
    const camera = { centre_x: 0.25, centre_y: 0.75, width: 0.5, height: 0.4 };
    expect(Value.Check(set, { scene_id: id, camera })).toBe(true);
    expect(Value.Check(set, { scene_id: id, camera: FIT_CAMERA })).toBe(true);
    expect(Value.Check(set, { camera })).toBe(false);
    expect(Value.Check(set, { scene_id: 'x', camera })).toBe(false);
    expect(Value.Check(set, { scene_id: id, camera, screen: { width: 1, height: 1 } })).toBe(false);
    for (const wrong of [
      { centre_x: -0.1 },
      { centre_x: 1.1 },
      { centre_y: 2 },
      { width: 0 },
      { width: CAMERA_BOUNDS.minSize / 2 },
      { height: CAMERA_BOUNDS.maxSize * 2 },
      { width: '0.5' },
      { zoom: 2 },
    ]) {
      expect(Value.Check(set, { scene_id: id, camera: { ...camera, ...wrong } }), JSON.stringify(wrong)).toBe(false);
    }
    const partial = { centre_x: camera.centre_x, centre_y: camera.centre_y, height: camera.height };
    expect(Value.Check(set, { scene_id: id, camera: partial })).toBe(false);
  });

  it('lets the ruler name the live scene and two whole squares within bounds, and nothing else (LIV-07)', () => {
    const update = LIVE_COMMAND_PAYLOAD_SCHEMAS['ruler.update'];
    const clear = LIVE_COMMAND_PAYLOAD_SCHEMAS['ruler.clear'];
    const from = { column: 2, row: 3 };
    const to = { column: -1, row: 7 };
    expect(Value.Check(update, { scene_id: id, from, to })).toBe(true);
    expect(Value.Check(update, { scene_id: id, from, to: from })).toBe(true);
    expect(Value.Check(update, { scene_id: id, from: { column: 100_000, row: -100_000 }, to })).toBe(true);
    for (const wrong of [
      { from, to },
      { scene_id: 'x', from, to },
      { scene_id: id, from },
      { scene_id: id, from: { column: 1.5, row: 3 }, to },
      { scene_id: id, from: { column: 100_001, row: 3 }, to },
      { scene_id: id, from: { column: 1 }, to },
      { scene_id: id, from: { column: 1, row: 1, x: 0 }, to },
      { scene_id: id, from, to, feet: 25 },
      { scene_id: id, from, to, waypoints: [] },
    ]) {
      expect(Value.Check(update, wrong), JSON.stringify(wrong)).toBe(false);
    }
    expect(Value.Check(clear, { scene_id: id })).toBe(true);
    for (const wrong of [{}, { scene_id: id, from }, { scene_id: 'x' }]) {
      expect(Value.Check(clear, wrong), JSON.stringify(wrong)).toBe(false);
    }
  });

  it('bounds a reported viewport to whole pixels within reason (LIV-06)', () => {
    expect(Value.Check(ScreenSchema, { width: 1920, height: 1080 })).toBe(true);
    for (const wrong of [
      { width: 0, height: 1080 },
      { width: 1920.5, height: 1080 },
      { width: 40_000, height: 1080 },
      { width: 1920 },
      { width: 1920, height: 1080, dpr: 2 },
    ]) {
      expect(Value.Check(ScreenSchema, wrong), JSON.stringify(wrong)).toBe(false);
    }
  });

  it("lets undo name nothing: the inverse is the server's, never the client's (D-040)", () => {
    const undo = LIVE_COMMAND_PAYLOAD_SCHEMAS.undo;
    expect(Value.Check(undo, {})).toBe(true);
    for (const extra of [{ token_id: id }, { steps: 2 }, { inverse: { type: 'token.delete' } }]) {
      expect(Value.Check(undo, extra), JSON.stringify(extra)).toBe(false);
    }
  });

  it('gives players tokens of the player shape only, and the id alone on removal, whether hidden or deleted', () => {
    expect(PlayerTokenAddedPayloadSchema.properties.token).toBe(PlayerTokenSchema);
    expect(PlayerTokenAddedPayloadSchema.properties.relabelled.items).toBe(PlayerTokenSchema);
    expect(PlayerTokenUpdatedPayloadSchema.properties.token).toBe(PlayerTokenSchema);
    expect(Object.keys(TokenRemovedPayloadSchema.properties)).toEqual(['id']);
  });
});
