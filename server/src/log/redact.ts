// Redaction applied by the logger to everything it writes, whatever the caller
// passed: logs never contain a PIN, a session identifier or a cookie
// (specs/07-security-and-access.md §8, D-029, D-066). Callers are still expected
// never to log headers, bodies or query strings; this is the second line.
//
// Every pattern here runs in time linear in its input: this code sees text a
// client chose, and one slow regular expression would let any browser on the
// LAN stall the server.

export const REDACTED = '[redacted]';

/** Longest string written to a log; the rest is cut before any pattern runs. */
export const MAX_LOG_STRING = 2048;

const MAX_DEPTH = 8;

// Words of a key, split at camelCase humps and at anything not a letter or digit:
// "dmPIN" -> dm, pin; "emberglass_session" -> emberglass, session; "connect.sid" -> connect, sid.
function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

// Words that merely contain "pin". "token" is deliberately not sensitive either:
// it is a game piece here, not a credential.
const NOT_A_PIN = new Set(['spin', 'spins', 'spinner', 'spinning', 'pinned', 'pinch']);

function isSensitiveWord(word: string): boolean {
  if (/session|sessid|cookie|authorization|password|passwd|secret/.test(word)) return true;
  if (word === 'sid' || word.endsWith('sid')) return true;
  return (word.startsWith('pin') || word.endsWith('pin')) && !NOT_A_PIN.has(word);
}

export function isSensitiveKey(key: string): boolean {
  return keyWords(key).some(isSensitiveWord);
}

// A header line that carries credentials: everything after the colon goes,
// because a cookie header holds several pairs and "Bearer x" holds a space.
const CREDENTIAL_HEADER = /\b((?:set-)?cookie|(?:proxy-)?authorization)([ \t]*:[ \t]*)[^\r\n]*/gi;

// `key=value`, `key: value`, `"key":"value"` and `'key': 'value'` pairs, and the
// URL-encoded `key%3Dvalue`. A key starts only where a run of key characters
// starts (the lookbehind), so each run is scanned once. Whether the key is
// sensitive is decided in code, not by the pattern: a pattern that names the
// sensitive words inside a run backtracks badly. Values are bounded, so a
// rejected match costs at most MAX_VALUE characters.
// A sensitive value longer than this is cut there; PINs and session identifiers are far shorter.
const MAX_VALUE = 256;
const PAIR = new RegExp(
  [
    `(?<![\\w.-])([\\w.-]+)`,
    `(["']?[ \\t]*(?:[:=]|%3[aAdD])[ \\t]*)`,
    `("(?:[^"\\\\]|\\\\.){0,${MAX_VALUE}}"?|'(?:[^'\\\\]|\\\\.){0,${MAX_VALUE}}'?|\\[[^\\]]{0,${MAX_VALUE}}\\]?|\\{[^}]{0,${MAX_VALUE}}\\}?|[^\\s&,;"'}\\]]{1,${MAX_VALUE}})`,
  ].join(''),
  'g',
);

// Replace the value of every sensitive pair. After a pair whose key is not
// sensitive the scan resumes where its value starts, so a pair nested in that
// value (`{"a":{"pin":"1"}}`) is still seen.
function scrubPairs(text: string): string {
  let out = '';
  let copied = 0;
  PAIR.lastIndex = 0;
  for (let match = PAIR.exec(text); match; match = PAIR.exec(text)) {
    const [whole, key = '', separator = ''] = match;
    if (isSensitiveKey(key)) {
      out += `${text.slice(copied, match.index)}${key}${separator}${REDACTED}`;
      copied = match.index + whole.length;
      PAIR.lastIndex = copied;
    } else {
      PAIR.lastIndex = match.index + key.length + separator.length;
    }
  }
  return out + text.slice(copied);
}

function truncate(text: string): string {
  return text.length > MAX_LOG_STRING
    ? `${text.slice(0, MAX_LOG_STRING)}…[truncated ${text.length - MAX_LOG_STRING} chars]`
    : text;
}

export function scrub(text: string): string {
  return scrubPairs(
    truncate(text).replace(
      CREDENTIAL_HEADER,
      (_match, name: string, separator: string) => `${name}${separator}${REDACTED}`,
    ),
  );
}

/** A copy of `value` safe to log: sensitive keys replaced, strings scrubbed, errors flattened. */
export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrub(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[truncated]';
  // Raw bytes could hold a body the patterns above cannot read.
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return `[binary ${value.byteLength} bytes]`;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  if (value instanceof Map || value instanceof Set) return `[${value.constructor.name} of ${value.size}]`;
  if (value instanceof Error) {
    const flat: Record<string, unknown> = { name: value.name, message: value.message };
    if (value.stack) flat.stack = value.stack;
    return redact(flat, depth + 1);
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    copy[key] = isSensitiveKey(key) ? REDACTED : redact(item, depth + 1);
  }
  return copy;
}
