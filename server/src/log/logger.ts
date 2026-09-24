import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { redact, scrub } from './redact.js';

// Structured logging (specs/09-operations.md §6, specs/07-security-and-access.md §8,
// D-029, D-035, D-066): human-readable lines on the console, one JSON object per
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
export const ROTATE_RETRY_MS = 60_000;

export function logFilePath(dataDir: string): string {
  return path.join(dataDir, LOG_DIR, LOG_FILE);
}

export function createLogger(options: LoggerOptions): Logger {
  const { stdout = process.stdout, stderr = process.stderr, maxBytes = LOG_MAX_BYTES, keep = LOG_KEEP } = options;
  const now = options.now ?? (() => new Date());
  const file = logFilePath(options.dataDir);
  mkdirSync(path.dirname(file), { recursive: true });
  // A failed rotation (Windows refuses to rename a file another program holds
  // open) is retried after this long; meanwhile lines keep going to the live file.
  let rotateRetryAt = 0;
  let fileFailed = false;
  let rotateFailed = false;

  const sizeOnDisk = (name: string): number => (existsSync(name) ? statSync(name).size : 0);
  const old = (index: number): string => `${file}.${index}`;
  // The live file is moved here first, so that a refusal changes nothing.
  const moving = `${file}.rotating`;

  // emberglass.log -> .1 -> .2 -> ... -> .keep, the oldest dropped. Every rename
  // happens between appends, when this process holds no handle. The live file
  // moves first: if that is refused, no old file has been touched. Old files
  // shift only up to the first free slot, and the oldest is deleted only when
  // every slot is taken, so a rotation interrupted part-way is finished by the
  // next attempt without losing another file.
  const rotate = (): void => {
    if (!existsSync(moving)) renameSync(file, moving);
    if (keep < 1) {
      rmSync(moving, { force: true });
      return;
    }
    let free = 1;
    while (free <= keep && existsSync(old(free))) free++;
    if (free > keep) {
      rmSync(old(keep), { force: true });
      free = keep;
    }
    for (let index = free - 1; index >= 1; index--) renameSync(old(index), old(index + 1));
    renameSync(moving, old(1));
  };

  const writeFile = (line: string): void => {
    const bytes = Buffer.byteLength(line);
    try {
      // Measured on disk each time, so a restart or a second writer cannot let it grow unnoticed.
      const size = sizeOnDisk(file);
      if (size > 0 && size + bytes > maxBytes && now().getTime() >= rotateRetryAt) {
        try {
          rotate();
          rotateFailed = false;
        } catch (error) {
          rotateRetryAt = now().getTime() + ROTATE_RETRY_MS;
          if (!rotateFailed) {
            stderr.write(`Log file ${file} could not be rotated; still appending to it: ${scrub(String(error))}\n`);
          }
          rotateFailed = true;
        }
      }
      appendFileSync(file, line);
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
    for (const [key, value] of Object.entries(safeFields)) if (!Object.hasOwn(record, key)) record[key] = value;
    writeFile(`${JSON.stringify(record)}\n`);
    (level === 'error' ? stderr : stdout).write(consoleLine(time, level, safeMsg, safeFields));
  };

  return {
    info: (event, msg, fields) => log('info', event, msg, fields),
    warn: (event, msg, fields) => log('warn', event, msg, fields),
    error: (event, msg, fields) => log('error', event, msg, fields),
  };
}

// Control characters from a message or stack would reach the DM's terminal raw:
// an escape sequence, or a newline that forges a log line of its own.
function escapeControls(text: string, keepNewlines: boolean): string {
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  return text.replace(/[\u0000-\u001f\u007f]/g, (char) =>
    keepNewlines && char === '\n' ? char : `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

function consoleLine(time: string, level: LogLevel, msg: string, fields: LogFields): string {
  const { error, ...rest } = fields;
  let line = `${time} ${level.toUpperCase().padEnd(5)} ${escapeControls(msg, false)}`;
  if (Object.keys(rest).length > 0) line += ` ${JSON.stringify(rest)}`;
  const stack = typeof error === 'object' && error !== null && 'stack' in error ? error.stack : undefined;
  // Every stack line is indented, so no line of it can pass for a log line.
  if (typeof stack === 'string') line += `\n${escapeControls(stack, true).replace(/^/gm, '    ')}`;
  else if (error !== undefined) line += ` ${JSON.stringify({ error })}`;
  return `${line}\n`;
}
