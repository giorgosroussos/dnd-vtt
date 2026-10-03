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

  // The TV address of the connect panel (specs/08-ux-journeys.md §5, Q-110): an IPv4 address, or null for Automatic.
  it('takes a TV address, or null for Automatic', () => {
    for (const address of ['192.168.1.133', '10.0.0.2', '172.16.0.1', '0.0.0.0', '255.255.255.255']) {
      expect(valid({ tv_address: address }), address).toBe(true);
    }
    expect(valid({ tv_address: null })).toBe(true);
  });

  it.each([
    ['a part over 255', '192.168.1.256'],
    ['three parts', '192.168.1'],
    ['a leading zero', '192.168.01.2'],
    ['a host name', 'emberglass.local'],
    ['an IPv6 address', 'fe80::1'],
    ['a URL', 'http://192.168.1.133:3000/'],
    ['a port', '192.168.1.133:3000'],
    ['spaces', ' 192.168.1.133'],
    ['nothing', ''],
  ])('refuses a TV address with %s', (_name, address) => {
    expect(valid({ tv_address: address })).toBe(false);
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
