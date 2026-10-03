import { readFileSync } from 'node:fs';

// The version the About dialog shows (PKG-01, D-164, D-167): the root package.json's, or, for a
// release build, EMBERGLASS_BUILD_VERSION, which the package build sets from the tag it builds
// (`1.0.0-rc.1` for the tag `v1.0.0-rc.1`). A build version that is not the package's version, or
// that version with a pre-release suffix, is refused, so the two cannot drift apart.
export function buildVersion(packageVersion: string, override: string | undefined): string {
  if (override === undefined || override === '') return packageVersion;
  const prerelease = override.startsWith(`${packageVersion}-`) ? override.slice(packageVersion.length + 1) : null;
  if (override !== packageVersion && (prerelease === null || !/^[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*$/.test(prerelease))) {
    throw new Error(
      `EMBERGLASS_BUILD_VERSION "${override}" is neither the package version ${packageVersion} ` +
        `nor ${packageVersion}-<pre-release>.`,
    );
  }
  return override;
}

export function readBuildVersion(env: Record<string, string | undefined> = process.env): string {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  return buildVersion(manifest.version, env.EMBERGLASS_BUILD_VERSION);
}
