import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'client', environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
