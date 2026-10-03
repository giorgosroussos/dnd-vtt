import { describe, expect, it } from 'vitest';
import { buildVersion } from './build-version.js';

describe('buildVersion (PKG-01, D-167)', () => {
  it('is the package version unless a release build names another', () => {
    expect(buildVersion('1.0.0', undefined)).toBe('1.0.0');
    expect(buildVersion('1.0.0', '')).toBe('1.0.0');
    expect(buildVersion('1.0.0', '1.0.0')).toBe('1.0.0');
  });

  it('takes a pre-release of the package version from the tag', () => {
    expect(buildVersion('1.0.0', '1.0.0-rc.1')).toBe('1.0.0-rc.1');
    expect(buildVersion('1.0.0', '1.0.0-beta')).toBe('1.0.0-beta');
  });

  it('refuses a version that is not the package one', () => {
    for (const other of ['1.0.1', '2.0.0-rc.1', '1.0.0-', '1.0.0-rc..1', '1.0.0-rc 1', 'v1.0.0']) {
      expect(() => buildVersion('1.0.0', other), other).toThrow(/neither the package version 1\.0\.0/);
    }
  });
});
