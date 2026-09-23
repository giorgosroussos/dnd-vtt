import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PORT, defaultDataDir, loadConfig, parsePort } from './config.js';

describe('defaultDataDir (D-034)', () => {
  it('uses %APPDATA%\\Emberglass on Windows', () => {
    expect(defaultDataDir('win32', { APPDATA: 'C:\\Users\\dm\\AppData\\Roaming' }, 'C:\\Users\\dm')).toBe(
      'C:\\Users\\dm\\AppData\\Roaming\\Emberglass',
    );
    expect(defaultDataDir('win32', {}, 'C:\\Users\\dm')).toBe('C:\\Users\\dm\\AppData\\Roaming\\Emberglass');
  });

  it('uses Application Support on macOS', () => {
    expect(defaultDataDir('darwin', {}, '/Users/dm')).toBe('/Users/dm/Library/Application Support/Emberglass');
  });

  it('uses $XDG_DATA_HOME/emberglass on Linux, else ~/.local/share/emberglass', () => {
    expect(defaultDataDir('linux', { XDG_DATA_HOME: '/data' }, '/home/dm')).toBe('/data/emberglass');
    expect(defaultDataDir('linux', {}, '/home/dm')).toBe('/home/dm/.local/share/emberglass');
    expect(defaultDataDir('linux', { XDG_DATA_HOME: '' }, '/home/dm')).toBe('/home/dm/.local/share/emberglass');
  });
});

describe('parsePort', () => {
  it('defaults to 3000', () => {
    expect(DEFAULT_PORT).toBe(3000);
    expect(parsePort(undefined)).toBe(3000);
    expect(parsePort('')).toBe(3000);
  });

  it('accepts a valid port', () => {
    expect(parsePort('8080')).toBe(8080);
  });

  it.each(['0', '65536', '-1', '3000.5', 'abc', ' 3000'])('refuses %j', (value) => {
    expect(() => parsePort(value)).toThrow(/EMBERGLASS_PORT/);
  });
});

describe('loadConfig', () => {
  it('uses EMBERGLASS_DATA_DIR and EMBERGLASS_PORT when set', () => {
    const config = loadConfig({ EMBERGLASS_DATA_DIR: '/srv/emberglass', EMBERGLASS_PORT: '4000' }, 'linux', '/home/dm');
    expect(config).toEqual({ dataDir: '/srv/emberglass', port: 4000 });
  });

  it('resolves a relative data directory from where the command was typed', () => {
    const config = loadConfig({ EMBERGLASS_DATA_DIR: '.dev-data', INIT_CWD: '/repo' }, 'linux', '/home/dm');
    expect(config.dataDir).toBe(path.resolve('/repo', '.dev-data'));
  });

  it('falls back to the per-user default', () => {
    expect(loadConfig({}, 'linux', '/home/dm')).toEqual({ dataDir: '/home/dm/.local/share/emberglass', port: 3000 });
  });
});
