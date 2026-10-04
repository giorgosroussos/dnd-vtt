import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The package gates (PKG-03, specs/10-testing-acceptance.md §4, D-176): with EMBERGLASS_E2E_PACKAGE naming
// the folder of an installed or unzipped package, every server of the run is that package, started as
// Emberglass.cmd starts it (its own runtime running its launcher), under the offline guard, with no program
// on PATH, so that no Node can be found and the launcher opens no browser of its own. `make package-gates`
// sets it; without it the run is the source install's.

/** The folder of the package under test, or undefined for the source install. */
export const PACKAGE_DIR = process.env.EMBERGLASS_E2E_PACKAGE || undefined;

/** The command that starts the package's launcher under the guard, as program and arguments. */
export function packageLauncher(folder: string, guard: string): { program: string; args: string[] } {
  return {
    program: path.join(folder, process.platform === 'win32' ? 'emberglass.exe' : 'emberglass'),
    args: ['--import', guard, path.join(folder, 'app', 'launcher.mjs')],
  };
}

/**
 * What the package's process sees in place of this one's PATH and Node options: an empty folder, so that
 * neither a Node nor a browser opener is found, and no option meant for the test runner's Node.
 */
export function packageEnv(): Record<string, string> {
  const noPrograms = (process.env.EMBERGLASS_E2E_NO_PROGRAMS ??= mkdtempSync(
    path.join(os.tmpdir(), 'emberglass-no-programs-'),
  ));
  // Every spelling this process has (Windows calls it Path) is replaced, since the result is spread over this
  // process's environment and which of two spellings a child sees depends on how its spawn orders them.
  const env: Record<string, string> = { PATH: noPrograms, NODE_OPTIONS: '' };
  for (const key of Object.keys(process.env)) if (/^path$/i.test(key)) env[key] = noPrograms;
  return env;
}
