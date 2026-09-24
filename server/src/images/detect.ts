import type { ImageMime } from '@emberglass/shared';

// The type of an upload, from its first bytes and never from its name or its
// Content-Type (specs/05-assets-and-images.md §6). Only PNG, JPEG and WebP are
// accepted; a few common others are named so that the refusal can say what the
// file is (D-080). sharp's decode then confirms an accepted type in full.

/** Enough leading bytes to tell every type below apart. */
export const SNIFF_BYTES = 12;

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0): boolean =>
  bytes.length >= at + signature.length && signature.every((byte, index) => bytes[at + index] === byte);
const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

const ACCEPTED: readonly { mime: ImageMime; test: (bytes: Uint8Array) => boolean }[] = [
  { mime: 'image/png', test: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { mime: 'image/jpeg', test: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  { mime: 'image/webp', test: (b) => startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8) },
];

// Named in the refusal only; never accepted.
const REFUSED: readonly { type: string; test: (bytes: Uint8Array) => boolean }[] = [
  { type: 'image/gif', test: (b) => startsWith(b, ascii('GIF87a')) || startsWith(b, ascii('GIF89a')) },
  { type: 'image/bmp', test: (b) => startsWith(b, ascii('BM')) },
  {
    type: 'image/tiff',
    test: (b) => startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a]),
  },
  { type: 'image/avif', test: (b) => startsWith(b, ascii('ftypavif'), 4) || startsWith(b, ascii('ftypavis'), 4) },
  { type: 'image/heic', test: (b) => startsWith(b, ascii('ftyphei'), 4) || startsWith(b, ascii('ftypmif1'), 4) },
  { type: 'application/pdf', test: (b) => startsWith(b, ascii('%PDF')) },
];

export type Sniffed = { accepted: true; mime: ImageMime } | { accepted: false; type: string };

/** What the leading bytes say the file is; `unknown` when they match nothing listed. */
export function sniff(bytes: Uint8Array): Sniffed {
  for (const { mime, test } of ACCEPTED) if (test(bytes)) return { accepted: true, mime };
  for (const { type, test } of REFUSED) if (test(bytes)) return { accepted: false, type };
  return { accepted: false, type: 'unknown' };
}

/** sharp's name for each accepted type, which its decode must agree with. */
export const SHARP_FORMAT: Record<ImageMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
};
