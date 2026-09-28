import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DISPLAY_SIZE_BOUNDS, SettingsUpdateSchema, UPLOAD_LIMIT_BOUNDS } from './index.js';

describe('the settings update (specs/09-operations.md §7, REL-01)', () => {
  const valid = (body: unknown): boolean => Value.Check(SettingsUpdateSchema, body);

  it('takes any one of the three settings, or all of them', () => {
    expect(valid({ upload_limit_bytes: UPLOAD_LIMIT_BOUNDS.min })).toBe(true);
    expect(valid({ display_variant_size: DISPLAY_SIZE_BOUNDS.max })).toBe(true);
    expect(valid({ ruler_rule: 'dmg' })).toBe(true);
    expect(valid({ ...DEFAULT_SETTINGS })).toBe(true);
  });

  it('refuses an empty body, an unknown field, a wrong type and every value out of bounds', () => {
    expect(
      [
        {},
        { pin_hash: 'x' },
        { live_scene_id: null },
        { upload_limit_bytes: UPLOAD_LIMIT_BOUNDS.min - 1 },
        { upload_limit_bytes: UPLOAD_LIMIT_BOUNDS.max + 1 },
        { upload_limit_bytes: 2_000_000.5 },
        { upload_limit_bytes: '52428800' },
        { display_variant_size: DISPLAY_SIZE_BOUNDS.min - 1 },
        { display_variant_size: DISPLAY_SIZE_BOUNDS.max + 1 },
        { ruler_rule: 'euclid' },
        { ruler_rule: null },
      ].some(valid),
    ).toBe(false);
  });

  it('keeps the defaults within the bounds', () => {
    expect(DEFAULT_SETTINGS.upload_limit_bytes).toBeGreaterThanOrEqual(UPLOAD_LIMIT_BOUNDS.min);
    expect(DEFAULT_SETTINGS.upload_limit_bytes).toBeLessThanOrEqual(UPLOAD_LIMIT_BOUNDS.max);
    expect(DEFAULT_SETTINGS.display_variant_size).toBeGreaterThanOrEqual(DISPLAY_SIZE_BOUNDS.min);
    expect(DEFAULT_SETTINGS.display_variant_size).toBeLessThanOrEqual(DISPLAY_SIZE_BOUNDS.max);
  });
});
