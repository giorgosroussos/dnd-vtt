import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import { IMAGE_FILE_PATH, IMAGE_VARIANTS, ImageIdParamsSchema, imageFileUrl } from './index.js';

const SHA = 'a'.repeat(64);

describe('image contract (specs/05-assets-and-images.md §7, D-080)', () => {
  it('names the three versions and builds their URLs from the sha256', () => {
    expect(IMAGE_VARIANTS).toEqual(['original', 'display', 'thumbnail']);
    expect(imageFileUrl(SHA, 'display')).toBe(`/images/${SHA}/display`);
    expect(IMAGE_FILE_PATH.replace(':id', SHA).replace(':variant', 'thumbnail')).toBe(imageFileUrl(SHA, 'thumbnail'));
  });

  it('takes only a lowercase hex sha256 as an image id', () => {
    expect(Value.Check(ImageIdParamsSchema, { id: SHA })).toBe(true);
    for (const id of ['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64), '00000000-0000-4000-8000-000000000001']) {
      expect(Value.Check(ImageIdParamsSchema, { id }), id).toBe(false);
    }
    expect(Value.Check(ImageIdParamsSchema, { id: SHA, extra: 1 })).toBe(false);
  });
});
