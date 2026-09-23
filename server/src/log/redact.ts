// Redaction applied by the logger to everything it writes, whatever the caller
// passed: logs never contain a PIN, a session identifier or a cookie
// (specs/07-security-and-access.md §8, D-029, D-065). Callers are still expected
// never to log headers, bodies or query strings; this is the second line.
//
// "token" is deliberately absent: it is a game piece here, not a credential.
const SENSITIVE_WORDS = 'pin|session|cookie|authorization|password|secret|sid';

export const REDACTED = '[redacted]';

// A key that starts with "pin", ends in "Pin", "_pin" or "-pin" (not "spin"),
// is exactly "sid", or names a session, cookie, authorization, password or secret.
const SENSITIVE_KEYS = [
  /^pin/i,
  /[a-z0-9]Pin$/,
  /[_-]pin$/i,
  /^sid$/i,
  /session|cookie|authorization|password|secret/i,
];

// `key=value`, `key: value` and `"key":"value"` pairs inside free text, such as
// a JSON parse error echoing a body, a query string or a Cookie header.
const SENSITIVE_PAIR = new RegExp(
  `([\\w-]*(?:${SENSITIVE_WORDS})[\\w-]*)("?\\s*[:=]\\s*)("[^"]*"?|'[^']*'?|[^\\s&,"'}\\]]+)`,
  'gi',
);

const MAX_DEPTH = 8;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.some((pattern) => pattern.test(key));
}

export function scrub(text: string): string {
  return text.replace(SENSITIVE_PAIR, (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`);
}

/** A copy of `value` safe to log: sensitive keys replaced, strings scrubbed, errors flattened. */
export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrub(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[truncated]';
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
