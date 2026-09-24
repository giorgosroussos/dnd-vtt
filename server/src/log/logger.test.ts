import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOG_KEEP, LOG_MAX_BYTES, createLogger, logFilePath, type TextSink } from './logger.js';
import { MAX_LOG_STRING, REDACTED, redact, scrub } from './redact.js';

class Capture implements TextSink {
  text = '';
  write(chunk: string): boolean {
    this.text += chunk;
    return true;
  }
}

const fixedTime = () => new Date('2026-09-24T12:00:00.000Z');

describe('createLogger against a real data directory', () => {
  let dataDir: string;
  let stdout: Capture;
  let stderr: Capture;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), 'emberglass-log-'));
    stdout = new Capture();
    stderr = new Capture();
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('defaults to logs/emberglass.log, 5 MB and three old files (D-035)', () => {
    expect(logFilePath(dataDir)).toBe(path.join(dataDir, 'logs', 'emberglass.log'));
    expect(LOG_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(LOG_KEEP).toBe(3);
  });

  it('writes one JSON object per line to the file and a readable line to the console', () => {
    const logger = createLogger({ dataDir, stdout, stderr, now: fixedTime });
    logger.info('server.started', 'Emberglass is running on port 3000.', { port: 3000 });
    logger.warn('http.rejected', 'Request rejected.', { status: 400 });
    logger.error('http.error', 'Request failed on the server.', { error: new Error('boom') });

    const lines = readFileSync(logFilePath(dataDir), 'utf8').trim().split('\n');
    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records[0]).toEqual({
      time: '2026-09-24T12:00:00.000Z',
      level: 'info',
      event: 'server.started',
      msg: 'Emberglass is running on port 3000.',
      port: 3000,
    });
    expect(records.map((record) => record.level)).toEqual(['info', 'warn', 'error']);
    expect(records[2]).toMatchObject({ error: { name: 'Error', message: 'boom' } });

    expect(stdout.text).toContain('2026-09-24T12:00:00.000Z INFO  Emberglass is running on port 3000. {"port":3000}');
    expect(stdout.text).toContain('WARN  Request rejected. {"status":400}');
    expect(stderr.text).toContain('ERROR Request failed on the server.');
    expect(stderr.text).toMatch(/\n {4}Error: boom/);
    expect(stdout.text).not.toContain('Request failed');
  });

  it('never lets a field overwrite time, level, event or msg', () => {
    const logger = createLogger({ dataDir, stdout, stderr, now: fixedTime });
    logger.info('a.b', 'real', { level: 'error', msg: 'forged', time: 'then', event: 'x' });
    expect(JSON.parse(readFileSync(logFilePath(dataDir), 'utf8'))).toEqual({
      time: '2026-09-24T12:00:00.000Z',
      level: 'info',
      event: 'a.b',
      msg: 'real',
    });
  });

  it('keeps a field whose name is also an Object.prototype member', () => {
    createLogger({ dataDir, stdout, stderr }).info('a.b', 'm', { constructor: 'c', toString: 't' });
    expect(JSON.parse(readFileSync(logFilePath(dataDir), 'utf8'))).toMatchObject({ constructor: 'c', toString: 't' });
  });

  it('escapes control characters on the console, so a message cannot forge a line or drive the terminal', () => {
    const logger = createLogger({ dataDir, stdout, stderr, now: fixedTime });
    logger.warn('x', 'bad\n2026-01-01T00:00:00.000Z INFO  forged \u001b[31mred');
    const error = new Error('boom\nERROR forged');
    logger.error('y', 'failed', { error });
    expect(stdout.text.split('\n').filter(Boolean)).toHaveLength(1);
    expect(stdout.text).toContain('bad\\u000a2026');
    expect(stdout.text).toContain('\\u001b[31m');
    expect(stdout.text).not.toContain('\u001b');
    // Every stack line, the forged one included, is indented under its entry.
    for (const line of stderr.text.split('\n').slice(1).filter(Boolean)) expect(line.startsWith('    ')).toBe(true);
  });

  it('appends to an existing log file across restarts', () => {
    createLogger({ dataDir, stdout, stderr }).info('one', 'first run');
    createLogger({ dataDir, stdout, stderr }).info('two', 'second run');
    expect(readFileSync(logFilePath(dataDir), 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('rotates at the size limit and keeps exactly three old files', () => {
    const maxBytes = 1_000;
    const logger = createLogger({ dataDir, stdout, stderr, maxBytes, now: fixedTime });
    for (let index = 0; index < 100; index++) logger.info('fill', `line ${index} ${'x'.repeat(80)}`);

    const file = logFilePath(dataDir);
    expect(readdirSync(path.dirname(file)).sort()).toEqual([
      'emberglass.log',
      'emberglass.log.1',
      'emberglass.log.2',
      'emberglass.log.3',
    ]);
    for (const name of [file, `${file}.1`, `${file}.2`, `${file}.3`]) {
      expect(statSync(name).size).toBeLessThanOrEqual(maxBytes);
    }
    // Newest last: the current file ends with the last line, .1 holds the lines just before it.
    expect(readFileSync(file, 'utf8')).toContain('line 99 ');
    const firstOfCurrent = Number(/line (\d+)/.exec(readFileSync(file, 'utf8'))![1]);
    const lastOfOne = Number([...readFileSync(`${file}.1`, 'utf8').matchAll(/line (\d+)/g)].at(-1)![1]);
    expect(lastOfOne).toBe(firstOfCurrent - 1);
    expect(existsSync(`${file}.4`)).toBe(false);
  });

  it('counts an existing file toward the limit after a restart', () => {
    const file = logFilePath(dataDir);
    createLogger({ dataDir, stdout, stderr }).info('before', 'x'.repeat(300));
    createLogger({ dataDir, stdout, stderr, maxBytes: 200 }).info('after', 'y');
    expect(readFileSync(`${file}.1`, 'utf8')).toContain('"event":"before"');
    expect(readFileSync(file, 'utf8')).not.toContain('"event":"before"');
    expect(readFileSync(file, 'utf8')).toContain('"event":"after"');
  });

  it('writes a first line longer than the limit into a fresh file without rotating', () => {
    createLogger({ dataDir, stdout, stderr, maxBytes: 100 }).info('long', 'z'.repeat(500));
    const file = logFilePath(dataDir);
    expect(readdirSync(path.dirname(file))).toEqual(['emberglass.log']);
    expect(readFileSync(file, 'utf8')).toContain('z'.repeat(500));
    expect(stderr.text).toBe('');
  });

  it('writes a line longer than the limit whole, into a file of its own', () => {
    const logger = createLogger({ dataDir, stdout, stderr, maxBytes: 100 });
    logger.info('short', 'a');
    logger.info('long', 'y'.repeat(500));
    const file = logFilePath(dataDir);
    expect(readFileSync(file, 'utf8')).toContain('y'.repeat(500));
    expect(readFileSync(`${file}.1`, 'utf8')).toContain('"event":"short"');
  });

  it('keeps logging to the console when the file cannot be written, and says so once', () => {
    const logger = createLogger({ dataDir, stdout, stderr });
    const file = logFilePath(dataDir);
    rmSync(path.dirname(file), { recursive: true });
    writeFileSync(path.dirname(file), 'a file where the logs folder was');
    logger.info('one', 'first');
    logger.info('two', 'second');
    expect(stdout.text).toContain('first');
    expect(stdout.text).toContain('second');
    expect(stderr.text.match(/could not be written/g)).toHaveLength(1);
  });

  it('announces a second outage after the file recovered from the first', () => {
    const logger = createLogger({ dataDir, stdout, stderr });
    const folder = path.dirname(logFilePath(dataDir));
    const breakFolder = () => {
      rmSync(folder, { recursive: true, force: true });
      writeFileSync(folder, 'not a folder');
    };
    breakFolder();
    logger.info('one', 'lost');
    rmSync(folder);
    mkdirSync(folder);
    logger.info('two', 'kept');
    breakFolder();
    logger.info('three', 'lost again');
    expect(stderr.text.match(/could not be written/g)).toHaveLength(2);
    rmSync(folder);
  });

  it('redacts sensitive fields and scrubs messages in both outputs', () => {
    const logger = createLogger({ dataDir, stdout, stderr });
    logger.warn('auth.failed', 'PIN attempt with pin=9876 refused', {
      pin: '9876',
      newPin: '1234',
      sessionId: 'abc-session-id',
      headers: { cookie: 'emberglass_session=abc-session-id', 'user-agent': 'TV' },
      client: '192.168.1.20',
    });
    const file = readFileSync(logFilePath(dataDir), 'utf8');
    for (const output of [file, stdout.text]) {
      for (const secret of ['9876', '1234', 'abc-session-id']) expect(output).not.toContain(secret);
      expect(output).toContain(REDACTED);
      // Client addresses may be logged (specs/07-security-and-access.md §8, Q-041).
      expect(output).toContain('192.168.1.20');
      expect(output).toContain('"user-agent":"TV"');
    }
  });
});

describe('redact and scrub', () => {
  it('replaces the value of every credential-like key, at any depth', () => {
    expect(
      redact({
        pin: '1',
        currentPin: '2',
        NEW_PIN: '2b',
        pinHash: '3',
        session: '4',
        sessionId: '5',
        'set-cookie': '6',
        Cookie: '7',
        authorization: '8',
        password: '9',
        sid: '10',
        dmPIN: '12',
        'connect.sid': '13',
        sessid: '14',
        enteredpin: '15',
        'x.pin': '16',
        nested: [{ deeper: { emberglass_session: '11' } }],
      }),
    ).toEqual({
      pin: REDACTED,
      currentPin: REDACTED,
      NEW_PIN: REDACTED,
      pinHash: REDACTED,
      session: REDACTED,
      sessionId: REDACTED,
      'set-cookie': REDACTED,
      Cookie: REDACTED,
      authorization: REDACTED,
      password: REDACTED,
      sid: REDACTED,
      dmPIN: REDACTED,
      'connect.sid': REDACTED,
      sessid: REDACTED,
      enteredpin: REDACTED,
      'x.pin': REDACTED,
      nested: [{ deeper: { emberglass_session: REDACTED } }],
    });
  });

  it('leaves game words alone: a token is a game piece here', () => {
    expect(redact({ tokenId: 't1', token: 'goblin', spin: 2, pinned: true, label: 'Goblin 3' })).toEqual({
      tokenId: 't1',
      token: 'goblin',
      spin: 2,
      pinned: true,
      label: 'Goblin 3',
    });
  });

  it.each([
    ['a query string', '/api/auth?pin=1234&x=1', '/api/auth?pin=[redacted]&x=1'],
    ['a JSON body', '{"pin":"1234","name":"a"}', '{"pin":[redacted],"name":"a"}'],
    ['a truncated JSON body', 'Unexpected end: {"pin":"12', 'Unexpected end: {"pin":[redacted]'],
    ['a Cookie header, whole', 'Cookie: emberglass_session=abc; theme=dark', 'Cookie: [redacted]'],
    ['a session cookie that is not first', 'Cookie: theme=dark; emberglass=abc', 'Cookie: [redacted]'],
    ['a Set-Cookie header', 'set-cookie: sid=abc; HttpOnly\nnext', 'set-cookie: [redacted]\nnext'],
    ['a bearer credential', 'Authorization: Bearer abc.def', 'Authorization: [redacted]'],
    ['a key with a colon', 'sessionId: abc123 expired', 'sessionId: [redacted] expired'],
    ['an array value', '{"pins":["1234","5678"]}', '{"pins":[redacted]}'],
    ['an escaped quote in a value', '{"pin":"12\\"34"}', '{"pin":[redacted]}'],
    ['single-quoted pairs', "{'pin': '1234'}", "{'pin': [redacted]}"],
    ['a URL-encoded pair', 'pin%3D1234&code=5', 'pin%3D[redacted]&code=5'],
    ['a pair nested in an object value', '{"a":{"pin":"1"}}', '{"a":{"pin":[redacted]}}'],
    ['a pair nested in an array value', '{"a":[{"sessionId":"x"}]}', '{"a":[{"sessionId":[redacted]}]}'],
    ['an object under a sensitive key', '{"session":{"id":"xyz"}}', '{"session":[redacted]}'],
    ['a dotted session cookie name', 'connect.sid=s%3Aabc', 'connect.sid=[redacted]'],
    ['nothing sensitive', 'spin=3 token=goblin label: Goblin 2', 'spin=3 token=goblin label: Goblin 2'],
  ])('scrubs credentials out of %s', (_case, input, expected) => {
    expect(scrub(input)).toBe(expected);
  });

  // The patterns see text a client chose; the first version took 9 s on 4,000
  // characters of "pinpin…" (FND-03 review). Generous bound for a slow CI runner.
  it.each([
    ['pin'.repeat(6_000)],
    ['a'.repeat(20_000)],
    ['a:'.repeat(10_000)],
    ['a:{'.repeat(7_000)],
    ['a=['.repeat(7_000)],
    ['"a":'.repeat(5_000)],
    ['x.pin='.repeat(3_000)],
  ])('scrubs adversarial text in linear time (%#)', (input) => {
    const started = performance.now();
    for (let run = 0; run < 10; run++) scrub(input);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('cuts a long string before scrubbing it', () => {
    const output = scrub(`${'a'.repeat(MAX_LOG_STRING)}pin=1234`);
    expect(output).toBe(`${'a'.repeat(MAX_LOG_STRING)}…[truncated 8 chars]`);
  });

  it('never writes raw bytes, and summarises collections', () => {
    expect(
      redact({
        body: Buffer.from('pin=1234'),
        bytes: new Uint8Array([49, 50, 51, 52]),
        map: new Map([['pin', '1234']]),
        set: new Set(['1234']),
        at: new Date(0),
      }),
    ).toEqual({
      body: '[binary 8 bytes]',
      bytes: '[binary 4 bytes]',
      map: '[Map of 1]',
      set: '[Set of 1]',
      at: '1970-01-01T00:00:00.000Z',
    });
  });

  it('flattens errors, scrubbing message and stack', () => {
    const error = new Error('failed for cookie=emberglass_session=xyz');
    const flat = redact({ error }) as { error: { name: string; message: string; stack: string } };
    expect(flat.error.name).toBe('Error');
    expect(flat.error.message).not.toContain('xyz');
    expect(flat.error.stack).not.toContain('xyz');
  });

  it('stops at a depth limit instead of recursing forever', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(JSON.stringify(redact(cyclic))).toContain('[truncated]');
  });
});
