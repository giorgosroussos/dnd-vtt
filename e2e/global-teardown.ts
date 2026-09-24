import { rmSync } from 'node:fs';

// Remove the temporary data directory the server under test was started with.
// Playwright stops that server only after this runs, and on Windows a file the
// server still holds open (its database) cannot be deleted. There the removal is
// retried as this process exits, once the server has been stopped, and a folder
// that still cannot go is left to the runner's temporary directory, with a warning.
export default function globalTeardown(): void {
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
