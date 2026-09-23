import { describe, expect, it } from 'vitest';
import { assertSupportedNode } from './node-version.js';

describe('assertSupportedNode', () => {
  it('accepts Node 24 and newer majors', () => {
    expect(() => assertSupportedNode('24.0.0')).not.toThrow();
    expect(() => assertSupportedNode('24.11.0')).not.toThrow();
    expect(() => assertSupportedNode('26.1.0')).not.toThrow();
  });

  it('refuses an older major and names the version it found', () => {
    expect(() => assertSupportedNode('23.11.1')).toThrow(/needs Node\.js 24 or newer; this is Node\.js 23\.11\.1/);
    expect(() => assertSupportedNode('12.22.9')).toThrow(/Node\.js 12\.22\.9/);
  });

  it('refuses a version it cannot read', () => {
    expect(() => assertSupportedNode('')).toThrow();
    expect(() => assertSupportedNode('v24')).toThrow();
  });
});
