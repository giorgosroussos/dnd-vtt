import en from './messages/en.json' with { type: 'json' };

// The one message catalogue (specs/08-ux-journeys.md §6, D-073). Every string the
// UI shows comes from here; messages.test.ts fails on text written anywhere else.
// A translation is another JSON file with the same keys.
export type MessageKey = keyof typeof en;
export type MessageParams = Readonly<Record<string, string | number>>;

export const LOCALE = 'en';
export const catalogue: Readonly<Record<MessageKey, string>> = en;

/** The catalogue text for `key`, with each `{name}` replaced from `params`. */
export function t(key: MessageKey, params: MessageParams = {}): string {
  return catalogue[key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}
