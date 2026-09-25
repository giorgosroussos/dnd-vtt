import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import {
  CampaignCreateBodySchema,
  CampaignUpdateBodySchema,
  DeleteBodySchema,
  OrderBodySchema,
  SceneCreateBodySchema,
  SceneDuplicateBodySchema,
  SceneUpdateBodySchema,
  SessionCreateBodySchema,
  SessionUpdateBodySchema,
  isCalendarDate,
  CALIBRATION_FIELDS,
} from './index.js';

const UUID = '00000000-0000-4000-8000-000000000001';

describe('campaign, session and scene bodies (D-078)', () => {
  it('refuses an id in every create and update body, because the server generates identifiers (D-038)', () => {
    const bodies = [
      [CampaignCreateBodySchema, { name: 'A' }],
      [CampaignUpdateBodySchema, { name: 'A' }],
      [SessionCreateBodySchema, { title: 'A' }],
      [SessionUpdateBodySchema, { title: 'A' }],
      [SceneCreateBodySchema, { name: 'A' }],
      [SceneUpdateBodySchema, { name: 'A' }],
      [SceneDuplicateBodySchema, { name: 'A' }],
    ] as const;
    for (const [schema, body] of bodies) {
      expect(Value.Check(schema, body)).toBe(true);
      expect(Value.Check(schema, { ...body, id: UUID })).toBe(false);
    }
  });

  // A repeated id in an order is refused by the server's validator (uniqueItems),
  // which TypeBox's Value.Check does not apply; server/src/http/campaigns.test.ts covers it.
  it('refuses an empty update and an order with an id that is not a lowercase UUID', () => {
    expect(Value.Check(CampaignUpdateBodySchema, {})).toBe(false);
    expect(Value.Check(SessionUpdateBodySchema, {})).toBe(false);
    expect(Value.Check(OrderBodySchema, { ids: [UUID] })).toBe(true);
    expect(Value.Check(OrderBodySchema, { ids: ['0B7A4C52-9D1E-4F3A-8B6C-2E5D7F9A1C3B'] })).toBe(false);
  });

  it('asks a deletion to carry the whole summary it confirms', () => {
    const confirm = { sessions: 1, scenes: 2, tokens: 3, live: false };
    expect(Value.Check(DeleteBodySchema, { confirm })).toBe(true);
    expect(Value.Check(DeleteBodySchema, { confirm: { ...confirm, live: undefined } })).toBe(false);
    expect(Value.Check(DeleteBodySchema, {})).toBe(false);
  });

  it('accepts only calendar dates that exist', () => {
    for (const date of ['2026-10-03', '2024-02-29', '0001-01-01']) expect(isCalendarDate(date), date).toBe(true);
    for (const date of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '2026-1-3', '03/10/2026', ''])
      expect(isCalendarDate(date), date).toBe(false);
  });

  it('takes a scene map, grid.visible and the calibration fields in an update (PRP-03, D-094)', () => {
    const map = 'a'.repeat(64);
    expect(Value.Check(SceneUpdateBodySchema, { map_image_id: map })).toBe(true);
    expect(Value.Check(SceneUpdateBodySchema, { grid: { visible: false } })).toBe(true);
    expect(Value.Check(SceneUpdateBodySchema, { name: 'A', map_image_id: map, grid: { visible: true } })).toBe(true);
    const calibration = { size: 70.4, offset_x: 12.25, offset_y: -3.5, columns: 40, rows: 30 };
    expect(Value.Check(SceneUpdateBodySchema, { grid: calibration })).toBe(true);
    expect(Value.Check(SceneUpdateBodySchema, { grid: { ...calibration, visible: false } })).toBe(true);
    for (const field of CALIBRATION_FIELDS) {
      expect(Value.Check(SceneUpdateBodySchema, { grid: { [field]: calibration[field] } }), field).toBe(true);
    }
    expect(Value.Check(SceneUpdateBodySchema, {})).toBe(false);
    // A map is replaced, never removed; an id is the lowercase sha256.
    expect(Value.Check(SceneUpdateBodySchema, { map_image_id: null })).toBe(false);
    expect(Value.Check(SceneUpdateBodySchema, { map_image_id: 'A'.repeat(64) })).toBe(false);
    expect(Value.Check(SceneUpdateBodySchema, { grid: {} })).toBe(false);
    // Feet per square is the ruler's (LIV-07); the type is square only; unknown fields are refused.
    for (const field of ['feet_per_square', 'type', 'colour']) {
      expect(Value.Check(SceneUpdateBodySchema, { grid: { visible: true, [field]: 1 } }), field).toBe(false);
    }
    // A square has a positive size, the extent whole squares, every value a finite bound.
    for (const grid of [
      { size: 0 },
      { size: -1 },
      { size: 2e6 },
      { size: null },
      { offset_x: 2e6 },
      { offset_y: -2e6 },
      { columns: 0 },
      { rows: 2.5 },
      { columns: 200_000 },
    ]) {
      expect(Value.Check(SceneUpdateBodySchema, { grid }), JSON.stringify(grid)).toBe(false);
    }
  });
});
