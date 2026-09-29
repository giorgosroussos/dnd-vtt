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

  it.each([
    ['an empty body', {}],
    ['the PIN hash', { pin_hash: 'x' }],
    ['the live scene', { live_scene_id: null }],
    ['an upload limit under 1 MB', { upload_limit_bytes: UPLOAD_LIMIT_BOUNDS.min - 1 }],
    ['an upload limit over 1 GB', { upload_limit_bytes: UPLOAD_LIMIT_BOUNDS.max + 1 }],
    ['a fractional upload limit', { upload_limit_bytes: 2_000_000.5 }],
    ['an upload limit as text', { upload_limit_bytes: '52428800' }],
    ['a display size under the bound', { display_variant_size: DISPLAY_SIZE_BOUNDS.min - 1 }],
    ['a display size over the bound', { display_variant_size: DISPLAY_SIZE_BOUNDS.max + 1 }],
    ['an unknown rule', { ruler_rule: 'euclid' }],
    ['no rule', { ruler_rule: null }],
  ])('refuses %s', (_name, body) => {
    expect(valid(body)).toBe(false);
  });

  it('accepts each bound itself', () => {
    expect(valid({ upload_limit_bytes: UPLOAD_LIMIT_BOUNDS.max, display_variant_size: DISPLAY_SIZE_BOUNDS.min })).toBe(
      true,
    );
  });

  it('keeps the defaults within the bounds', () => {
    expect(DEFAULT_SETTINGS.upload_limit_bytes).toBeGreaterThanOrEqual(UPLOAD_LIMIT_BOUNDS.min);
    expect(DEFAULT_SETTINGS.upload_limit_bytes).toBeLessThanOrEqual(UPLOAD_LIMIT_BOUNDS.max);
    expect(DEFAULT_SETTINGS.display_variant_size).toBeGreaterThanOrEqual(DISPLAY_SIZE_BOUNDS.min);
    expect(DEFAULT_SETTINGS.display_variant_size).toBeLessThanOrEqual(DISPLAY_SIZE_BOUNDS.max);
  });
});
