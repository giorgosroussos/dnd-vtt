// The server refuses to start on a Node major older than 24 (specs/09-operations.md §1, D-012).
// Imported before anything else so that the refusal is the first thing an old Node reports.
export const MINIMUM_NODE_MAJOR = 24;

export function assertSupportedNode(version: string): void {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  if (!Number.isInteger(major) || major < MINIMUM_NODE_MAJOR) {
    throw new Error(
      `Emberglass needs Node.js ${MINIMUM_NODE_MAJOR} or newer; this is Node.js ${version}. ` +
        'Install the version named in .nvmrc and start again.',
    );
  }
}
