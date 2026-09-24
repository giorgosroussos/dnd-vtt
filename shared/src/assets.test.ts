import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import {
  AssetCreateBodySchema,
  AssetListQuerySchema,
  AssetUpdateBodySchema,
  TOKEN_FOOTPRINT,
  TOKEN_SIZES,
  normalizeTag,
} from './index.js';

const SHA = 'a'.repeat(64);

describe('asset contract (specs/05-assets-and-images.md §1, §2, §4, D-083)', () => {
  it('gives every size the footprint of the size table', () => {
    expect(Object.keys(TOKEN_FOOTPRINT)).toEqual([...TOKEN_SIZES]);
    expect(TOKEN_FOOTPRINT).toEqual({ tiny: 0.5, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 });
  });

  it('normalises a tag to one spelling: trimmed, one space inside, NFC, lower case (G-009)', () => {
    expect(normalizeTag('  Dark   Cave ')).toBe('dark cave');
    expect(normalizeTag('CAVE')).toBe(normalizeTag('cave'));
    expect(normalizeTag('Café')).toBe(normalizeTag('Café'));
    expect(normalizeTag('ÄRGER')).toBe('ärger');
    expect(normalizeTag(' \t ')).toBe('');
  });

  it('refuses a create body naming its own id or an unknown field, or missing a required one', () => {
    const body = { name: 'Goblin', image_id: SHA, category: 'monster', size: 'small' };
    expect(Value.Check(AssetCreateBodySchema, body)).toBe(true);
    expect(Value.Check(AssetCreateBodySchema, { ...body, tags: ['cave'], notes: '', default_hidden: false })).toBe(
      true,
    );
    expect(Value.Check(AssetCreateBodySchema, { ...body, id: '00000000-0000-4000-8000-000000000001' })).toBe(false);
    expect(Value.Check(AssetCreateBodySchema, { ...body, colour: 'red' })).toBe(false);
    expect(Value.Check(AssetCreateBodySchema, { ...body, category: 'dragon' })).toBe(false);
    expect(Value.Check(AssetCreateBodySchema, { ...body, size: 'Small' })).toBe(false);
    expect(Value.Check(AssetCreateBodySchema, { ...body, tags: [''] })).toBe(false);
    expect(Value.Check(AssetCreateBodySchema, { name: 'Goblin', category: 'monster', size: 'small' })).toBe(false);
  });

  it('needs at least one field in an update, and takes one tag or several in a list query', () => {
    expect(Value.Check(AssetUpdateBodySchema, {})).toBe(false);
    expect(Value.Check(AssetUpdateBodySchema, { tags: [] })).toBe(true);
    expect(Value.Check(AssetListQuerySchema, { tag: 'cave' })).toBe(true);
    expect(Value.Check(AssetListQuerySchema, { tag: ['cave', 'boss'], q: 'gob', category: 'monster' })).toBe(true);
    expect(Value.Check(AssetListQuerySchema, { sort: 'name' })).toBe(false);
  });
});
