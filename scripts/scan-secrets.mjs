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

const bin = process.platform === 'win32' ? 'secretlint.cmd' : 'secretlint';
const result = spawnSync(bin, ['--maskSecrets', ...files], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, PATH: `node_modules/.bin${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}` },
});
if (result.status === 0) console.log(`scan-secrets: ${files.length} files scanned, no secret found.`);
process.exit(result.status ?? 1);
