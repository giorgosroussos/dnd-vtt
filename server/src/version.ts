import { readFileSync } from 'node:fs';

// The version of this Emberglass, written into an export's manifest for a person reading it (DMT-05). The package's
// bundle has it defined at build time (scripts/package/build.mjs); otherwise it is the repository's package.json,
// two folders up from both src/ and dist/.
declare const __EMBERGLASS_VERSION__: string | undefined;

function fromManifest(): string {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      version?: unknown;
    };
    return typeof manifest.version === 'string' ? manifest.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

export const APP_VERSION: string =
  typeof __EMBERGLASS_VERSION__ !== 'undefined' ? __EMBERGLASS_VERSION__ : fromManifest();
