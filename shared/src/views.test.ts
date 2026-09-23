import { describe, expect, it } from 'vitest';
import { VIEW_PATHS, viewForPath } from './index.js';

describe('viewForPath', () => {
  it('serves the player view at the root', () => {
    expect(VIEW_PATHS.player).toBe('/');
    expect(viewForPath('/')).toBe('player');
  });

  it('serves the DM view at /dm and below it', () => {
    expect(VIEW_PATHS.dm).toBe('/dm');
    expect(viewForPath('/dm')).toBe('dm');
    expect(viewForPath('/dm/')).toBe('dm');
    expect(viewForPath('/dm/settings')).toBe('dm');
  });

  it('never selects the DM view for a path that merely starts with the same letters', () => {
    expect(viewForPath('/dmx')).toBe('player');
    expect(viewForPath('/players/dm')).toBe('player');
  });
});
