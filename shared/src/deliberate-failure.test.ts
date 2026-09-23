import { expect, it } from 'vitest';

// FND-02 acceptance: a deliberately failing test must turn the `test` jobs red. Reverted next.
it('fails on purpose', () => {
  expect(1).toBe(2);
});
