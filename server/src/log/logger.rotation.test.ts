import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROTATE_RETRY_MS, createLogger, logFilePath, type TextSink } from './logger.js';

// Windows refuses to rename a file another program holds open (an editor, a log
// tailer, antivirus). renameSync is wrapped so a test can refuse chosen renames.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

const realRename = (await vi.importActual<typeof import('node:fs')>('node:fs')).renameSync;
const renameSync = vi.mocked(fs.renameSync);

class Capture implements TextSink {
  text = '';
  write(chunk: string): boolean {
    this.text += chunk;
    return true;
  }
}

function busy(): never {
  throw Object.assign(new Error('EBUSY: resource busy or locked, rename'), { code: 'EBUSY' });
}

describe('log rotation when a rename is refused', () => {
  let dataDir: string;
  let file: string;
  let stderr: Capture;
  let clock: number;
  const now = () => new Date(clock);

  // Four files full: live, .1, .2, .3, each holding one line tagged with its age.
  const fill = () => {
    const logger = createLogger({ dataDir, stdout: new Capture(), stderr, maxBytes: 150, now });
    for (const tag of ['oldest', 'older', 'old', 'live']) logger.info('fill', `${tag} ${'x'.repeat(60)}`);
    return logger;
  };
  const contents = () =>
    Object.fromEntries(
      fs
        .readdirSync(path.dirname(file))
        .sort()
        .map((name) => [name, fs.readFileSync(path.join(path.dirname(file), name), 'utf8')]),
    );

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emberglass-rotate-'));
    file = logFilePath(dataDir);
    stderr = new Capture();
    clock = Date.parse('2026-09-24T12:00:00.000Z');
    renameSync.mockImplementation(realRename);
  });

  afterEach(() => {
    renameSync.mockImplementation(realRename);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('keeps every old file and every line while the live file is locked, then rotates once it is free', () => {
    const logger = fill();
    expect(Object.keys(contents())).toEqual([
      'emberglass.log',
      'emberglass.log.1',
      'emberglass.log.2',
      'emberglass.log.3',
    ]);
    const before = contents();

    renameSync.mockImplementation((from, to) => (from === file ? busy() : realRename(from, to)));
    for (let index = 0; index < 5; index++) logger.info('locked', `line ${index}`);

    const during = contents();
    expect(during['emberglass.log.1']).toBe(before['emberglass.log.1']);
    expect(during['emberglass.log.2']).toBe(before['emberglass.log.2']);
    expect(during['emberglass.log.3']).toBe(before['emberglass.log.3']);
    for (let index = 0; index < 5; index++) expect(during['emberglass.log']).toContain(`line ${index}`);
    expect(stderr.text.match(/could not be rotated/g)).toHaveLength(1);
    expect(stderr.text).not.toContain('could not be written');

    // Freed, but the retry waits for the back-off; after it, one normal rotation.
    renameSync.mockImplementation(realRename);
    logger.info('freed', 'too soon');
    expect(contents()['emberglass.log.1']).toBe(before['emberglass.log.1']);
    clock += ROTATE_RETRY_MS;
    logger.info('freed', 'after the back-off');
    const after = contents();
    expect(Object.keys(after)).toEqual(['emberglass.log', 'emberglass.log.1', 'emberglass.log.2', 'emberglass.log.3']);
    expect(after['emberglass.log.1']).toContain('line 4');
    expect(after['emberglass.log.2']).toBe(before['emberglass.log.1']);
    expect(after['emberglass.log.3']).toBe(before['emberglass.log.2']);
    expect(after['emberglass.log']).toContain('after the back-off');
  });

  it('loses no further old file when a rotation stops part-way and is retried', () => {
    const logger = fill();
    const before = contents();
    const second = `${file}.1`;
    let refusals = 3;
    renameSync.mockImplementation((from, to) => (from === second && refusals-- > 0 ? busy() : realRename(from, to)));

    logger.info('next', 'first attempt stops after dropping the oldest');
    for (let retry = 0; retry < 2; retry++) {
      clock += ROTATE_RETRY_MS;
      logger.info('next', `retry ${retry}`);
    }
    // Only the oldest file (.3) has gone, however often the rotation was retried.
    const during = contents();
    expect(Object.values(during).some((text) => text === before['emberglass.log.1'])).toBe(true);
    expect(Object.values(during).some((text) => text === before['emberglass.log.2'])).toBe(true);
    expect(Object.values(during).some((text) => text.startsWith(before['emberglass.log']!))).toBe(true);

    clock += ROTATE_RETRY_MS;
    logger.info('next', 'rename allowed again');
    const after = contents();
    expect(Object.keys(after)).toEqual(['emberglass.log', 'emberglass.log.1', 'emberglass.log.2', 'emberglass.log.3']);
    expect(after['emberglass.log.2']).toBe(before['emberglass.log.1']);
    expect(after['emberglass.log.3']).toBe(before['emberglass.log.2']);
    expect(after['emberglass.log.1']!.startsWith(before['emberglass.log']!)).toBe(true);
  });
});
