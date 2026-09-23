import { describe, expect, it } from 'vitest';
import { DmView } from './dm/DmView.js';
import { PlayerView } from './player/PlayerView.js';
import { loadView } from './views.js';

describe('loadView', () => {
  it('loads the player view at the root and for any path outside /dm', async () => {
    expect(await loadView('/')).toBe(PlayerView);
    expect(await loadView('/dmx')).toBe(PlayerView);
  });

  it('loads the DM view at /dm and below it', async () => {
    expect(await loadView('/dm')).toBe(DmView);
    expect(await loadView('/dm/settings')).toBe(DmView);
  });
});
