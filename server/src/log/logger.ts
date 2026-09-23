import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { redact, scrub } from './redact.js';

// Structured logging (specs/09-operations.md §6, specs/07-security-and-access.md §8,
// D-029, D-035, D-065): human-readable lines on the console, one JSON object per
// line in `logs/emberglass.log` inside the data directory, rotated at 5 MB with
// three old files kept. Writes are synchronous: the log records rare events
// (start-up, connections, PIN failures, errors), and a line written before a
// crash is worth more than throughput.
export type LogLevel = 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

export interface Logger {
  info(event: string, msg: string, fields?: LogFields): void;
  warn(event: string, msg: string, fields?: LogFields): void;
  error(event: string, msg: string, fields?: LogFields): void;
}

export interface TextSink {
  write(text: string): unknown;
}

export interface LoggerOptions {
  dataDir: string;
  stdout?: TextSink;
  stderr?: TextSink;
  maxBytes?: number;
  keep?: number;
  now?: () => Date;
}

export const LOG_DIR = 'logs';
export const LOG_FILE = 'emberglass.log';
export const LOG_MAX_BYTES = 5 * 1024 * 1024;
export const LOG_KEEP = 3;

export function logFilePath(dataDir: string): string {
  return path.join(dataDir, LOG_DIR, LOG_FILE);
}

export function createLogger(options: LoggerOptions): Logger {
  const { stdout = process.stdout, stderr = process.stderr, maxBytes = LOG_MAX_BYTES, keep = LOG_KEEP } = options;
  const now = options.now ?? (() => new Date());
  const file = logFilePath(options.dataDir);
  mkdirSync(path.dirname(file), { recursive: true });
  let size = existsSync(file) ? statSync(file).size : 0;
  let fileFailed = false;

  // emberglass.log -> .1 -> .2 -> ... -> .keep, the oldest dropped. Every rename
  // happens between appends, when no handle is open, which Windows requires.
  const rotate = (): void => {
    rmSync(`${file}.${keep}`, { force: true });
    for (let index = keep - 1; index >= 1; index--) {
      if (existsSync(`${file}.${index}`)) renameSync(`${file}.${index}`, `${file}.${index + 1}`);
    }
    if (keep >= 1) renameSync(file, `${file}.1`);
    else rmSync(file, { force: true });
    size = 0;
  };

  const writeFile = (line: string): void => {
    const bytes = Buffer.byteLength(line);
    try {
      if (size > 0 && size + bytes > maxBytes) rotate();
      appendFileSync(file, line);
      size += bytes;
      fileFailed = false;
    } catch (error) {
      // The console still gets the line; say once that the file does not.
      if (!fileFailed) stderr.write(`Log file ${file} could not be written: ${scrub(String(error))}\n`);
      fileFailed = true;
    }
  };

  const log = (level: LogLevel, event: string, msg: string, fields: LogFields = {}): void => {
    const time = now().toISOString();
    const safeMsg = scrub(msg);
    const safeFields = redact(fields) as LogFields;
    // The four fixed keys come first and cannot be overwritten by a field.
    const record: LogFields = { time, level, event, msg: safeMsg };
    for (const [key, value] of Object.entries(safeFields)) if (!(key in record)) record[key] = value;
    writeFile(`${JSON.stringify(record)}\n`);
    (level === 'error' ? stderr : stdout).write(consoleLine(time, level, safeMsg, safeFields));
  };

  return {
    info: (event, msg, fields) => log('info', event, msg, fields),
    warn: (event, msg, fields) => log('warn', event, msg, fields),
    error: (event, msg, fields) => log('error', event, msg, fields),
  };
}

function consoleLine(time: string, level: LogLevel, msg: string, fields: LogFields): string {
  const { error, ...rest } = fields;
  let line = `${time} ${level.toUpperCase().padEnd(5)} ${msg}`;
  if (Object.keys(rest).length > 0) line += ` ${JSON.stringify(rest)}`;
  const stack = typeof error === 'object' && error !== null && 'stack' in error ? error.stack : undefined;
  if (typeof stack === 'string') line += `\n${stack.replace(/^/gm, '    ')}`;
  else if (error !== undefined) line += ` ${JSON.stringify({ error })}`;
  return `${line}\n`;
}
