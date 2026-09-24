import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@emberglass/shared';
import { ERROR_MESSAGES, errorMessage } from './errorMessage.js';
import { catalogue } from './messages.js';

// Every error code the server can send has a message the DM reads, and none shows
// the code itself (specs/08-ux-journeys.md §6, G-014, D-085).
describe('error messages', () => {
  it('maps every shared error code and `network` to its own catalogue text', () => {
    expect(Object.keys(ERROR_MESSAGES).sort()).toEqual([...ERROR_CODES, 'network'].sort());
    for (const code of [...ERROR_CODES, 'network'] as const) {
      const text = errorMessage(code);
      expect(catalogue[ERROR_MESSAGES[code]], code).toBe(text);
      expect(text.trim(), code).not.toBe('');
      expect(text, code).not.toContain(code);
    }
    expect(new Set(Object.values(ERROR_MESSAGES)).size).toBe(ERROR_CODES.length + 1);
  });
});
