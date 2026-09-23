import { rmSync } from 'node:fs';

// Remove the temporary data directory the server under test was started with.
export default function globalTeardown(): void {
  const dir = process.env.EMBERGLASS_E2E_DATA_DIR;
  if (dir) rmSync(dir, { recursive: true, force: true });
}
