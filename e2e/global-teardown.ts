import { rmSync } from 'node:fs';
import path from 'node:path';

// Remove the temporary data directory the server under test was started with.
// Playwright stops that server only after this runs, and on Windows a file the
// server still holds open (its database) cannot be deleted. There the removal is
// retried as this process exits, once the server has been stopped, and a folder
// that still cannot go is left to the runner's temporary directory, with a warning.
export default function globalTeardown(): void {
  // The offline run's outbound log, read by offline.spec.ts; nothing holds it open.
  const log = process.env.EMBERGLASS_E2E_OUTBOUND_LOG;
  if (log) rmSync(path.dirname(log), { recursive: true, force: true });
  // The empty PATH folder of a run against a package (PKG-03, e2e/package.ts); nothing is ever in it.
  const noPrograms = process.env.EMBERGLASS_E2E_NO_PROGRAMS;
  if (noPrograms) rmSync(noPrograms, { recursive: true, force: true });
  const dir = process.env.EMBERGLASS_E2E_DATA_DIR;
  if (!dir) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    if (process.platform !== 'win32') throw error;
    process.once('exit', () => {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } catch {
        console.warn(`e2e teardown: could not remove ${dir}; it stays in the temporary directory.`);
      }
    });
  }
}
