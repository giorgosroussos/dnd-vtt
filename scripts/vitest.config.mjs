import { defineProject } from 'vitest/config';

// Tests of the repository tooling that CI runs (FND-02).
export default defineProject({
  test: { name: 'scripts', environment: 'node', include: ['*.test.mjs'] },
});
