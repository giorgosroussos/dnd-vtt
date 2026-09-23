import { defineConfig } from 'vitest/config';

// `make test`: every workspace's unit and integration tests in one run (D-011).
export default defineConfig({
  test: { projects: ['shared', 'server', 'client'] },
});
