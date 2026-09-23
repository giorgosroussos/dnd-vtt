import os from 'node:os';
import path from 'node:path';

// Start-up configuration: port and data directory from the environment only
// (specs/09-operations.md §5, §7, D-034). Everything else configurable is a setting.
export interface Config {
  dataDir: string;
  port: number;
}

export const DEFAULT_PORT = 3000;

type Env = Record<string, string | undefined>;

export function defaultDataDir(platform: NodeJS.Platform, env: Env, home: string): string {
  if (platform === 'win32') {
    return path.win32.join(env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), 'Emberglass');
  }
  if (platform === 'darwin') {
    return path.posix.join(home, 'Library', 'Application Support', 'Emberglass');
  }
  return path.posix.join(env.XDG_DATA_HOME || path.posix.join(home, '.local', 'share'), 'emberglass');
}

export function parsePort(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`EMBERGLASS_PORT must be a whole number from 1 to 65535, got "${value}".`);
  }
  return port;
}

export function loadConfig(
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): Config {
  // A relative EMBERGLASS_DATA_DIR is resolved from where the command was typed:
  // npm sets INIT_CWD to it even when a workspace script runs in its own folder.
  const base = env.INIT_CWD || process.cwd();
  const dataDir = env.EMBERGLASS_DATA_DIR
    ? path.resolve(base, env.EMBERGLASS_DATA_DIR)
    : defaultDataDir(platform, env, home);
  return { dataDir, port: parsePort(env.EMBERGLASS_PORT) };
}
