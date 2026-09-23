// `make scan-secrets`: secretlint over every file Git tracks, plus untracked files
// that are not ignored, so a secret is caught before its first commit too.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

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

const windows = process.platform === 'win32';
const bin = windows ? 'secretlint.cmd' : 'secretlint';
// On Windows the command goes through cmd.exe, whose command line is capped at
// 8191 characters, so the file list is scanned in batches that stay well under it.
const MAX_ARGS_LENGTH = 6000;
const batches = [[]];
let length = 0;
for (const file of files) {
  if (length + file.length + 3 > MAX_ARGS_LENGTH && batches.at(-1).length > 0) {
    batches.push([]);
    length = 0;
  }
  batches.at(-1).push(file);
  length += file.length + 3;
}
let status = 0;
for (const batch of batches) {
  const args = windows ? batch.map((file) => `"${file}"`) : batch;
  const result = spawnSync(bin, ['--maskSecrets', ...args], {
    stdio: 'inherit',
    shell: windows,
    env: { ...process.env, PATH: `node_modules/.bin${windows ? ';' : ':'}${process.env.PATH}` },
  });
  if (result.status !== 0) status = result.status ?? 1;
}
if (status === 0) console.log(`scan-secrets: ${files.length} files scanned, no secret found.`);
process.exit(status);
