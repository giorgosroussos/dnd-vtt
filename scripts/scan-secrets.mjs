// `make scan-secrets`: secretlint over every file Git tracks, plus untracked files
// that are not ignored, so a secret is caught before its first commit too.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
if (listed.status !== 0) {
  console.error(listed.stderr);
  process.exit(1);
}
// A tracked file deleted in the working tree is listed by --cached but has nothing to scan.
const files = [...new Set(listed.stdout.split('\0').filter(Boolean))].filter((file) => existsSync(file));

// secretlint's own entry runs under this Node, with no shell in between: nothing
// in a file name is interpreted (cmd.exe expands %NAME% even inside quotes). The
// list is still split in batches, because Windows caps a command line at 32767
// characters.
const secretlint = fileURLToPath(new URL('../node_modules/secretlint/bin/secretlint.js', import.meta.url));
const MAX_ARGS_LENGTH = 24000;
const batches = [[]];
let length = 0;
for (const file of files) {
  if (length + file.length + 1 > MAX_ARGS_LENGTH && batches.at(-1).length > 0) {
    batches.push([]);
    length = 0;
  }
  batches.at(-1).push(file);
  length += file.length + 1;
}
let status = 0;
for (const batch of batches) {
  const result = spawnSync(process.execPath, [secretlint, '--maskSecrets', ...batch], { stdio: 'inherit' });
  if (result.status !== 0) status = result.status ?? 1;
}
if (status === 0) console.log(`scan-secrets: ${files.length} files scanned, no secret found.`);
process.exit(status);
