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
});
