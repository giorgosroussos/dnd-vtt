import { defineProject } from 'vitest/config';
import { readBuildVersion } from './build-version.js';

export default defineProject({
  define: { __EMBERGLASS_VERSION__: JSON.stringify(readBuildVersion()) },
  test: {
    name: 'client',
    environment: 'node',
    include: ['build-version.test.ts', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
