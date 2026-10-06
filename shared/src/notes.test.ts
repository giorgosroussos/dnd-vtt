import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import {
  AssetCreateBodySchema,
  AssetUpdateBodySchema,
  hasNotes,
  NOTES_MAX_LENGTH,
  NotesBodySchema,
  notesLength,
  notesPreview,
  NotesUpdatedPayloadSchema,
} from './index.js';

const UUID = '00000000-0000-4000-8000-000000000001';

describe('DM notes (DMT-04, specs/03-domain-model.md §10, specs/04-live-sync.md §16)', () => {
  it('takes the whole text, line breaks and all, up to the limit, and nothing else', () => {
    expect(Value.Check(NotesBodySchema, { notes: '' })).toBe(true);
    expect(Value.Check(NotesBodySchema, { notes: 'Leader:\nflees at half HP\r\n\n<b>not bold</b>' })).toBe(true);
    expect(Value.Check(NotesBodySchema, { notes: 'x'.repeat(NOTES_MAX_LENGTH) })).toBe(true);
    expect(Value.Check(NotesBodySchema, { notes: 'x'.repeat(NOTES_MAX_LENGTH + 1) })).toBe(false);
    expect(Value.Check(NotesBodySchema, {})).toBe(false);
    expect(Value.Check(NotesBodySchema, { notes: null })).toBe(false);
    expect(Value.Check(NotesBodySchema, { notes: '', token_id: UUID })).toBe(false);
  });

  it('bounds an asset’s notes the same way', () => {
    const body = { name: 'Bandit', image_id: 'a'.repeat(64), category: 'monster', size: 'medium' };
    expect(Value.Check(AssetCreateBodySchema, { ...body, notes: 'x'.repeat(NOTES_MAX_LENGTH) })).toBe(true);
    expect(Value.Check(AssetCreateBodySchema, { ...body, notes: 'x'.repeat(NOTES_MAX_LENGTH + 1) })).toBe(false);
    expect(Value.Check(AssetUpdateBodySchema, { notes: 'x'.repeat(NOTES_MAX_LENGTH + 1) })).toBe(false);
  });

  it('counts characters by code point, as the server’s schema does', () => {
    expect(notesLength('🐉 dragon')).toBe(8);
    const dragons = '🐉'.repeat(NOTES_MAX_LENGTH);
    expect(notesLength(dragons)).toBe(NOTES_MAX_LENGTH);
    expect(Value.Check(NotesBodySchema, { notes: dragons })).toBe(true);
  });

  it('names the live scene or one of its tokens in notes.updated', () => {
    expect(Value.Check(NotesUpdatedPayloadSchema, { scene_id: UUID, token_id: null, notes: 'x' })).toBe(true);
    expect(Value.Check(NotesUpdatedPayloadSchema, { scene_id: UUID, token_id: UUID, notes: '' })).toBe(true);
    expect(Value.Check(NotesUpdatedPayloadSchema, { scene_id: UUID, notes: '' })).toBe(false);
  });

  it('says a text of white space alone holds no notes', () => {
    expect(hasNotes('')).toBe(false);
    expect(hasNotes(' \n\t ')).toBe(false);
    expect(hasNotes(undefined)).toBe(false);
    expect(hasNotes('.')).toBe(true);
  });

  it('previews the first lines that are not blank, each cut to its width', () => {
    expect(notesPreview('Leader\n\n  \nflees at half HP')).toBe('Leader\nflees at half HP');
    expect(notesPreview('one\ntwo\nthree\nfour')).toBe('one\ntwo\nthree…');
    expect(notesPreview('a'.repeat(100), 3, 10)).toBe(`${'a'.repeat(9)}…`);
    expect(notesPreview('one\r\ntwo', 1)).toBe('one…');
    expect(notesPreview('')).toBe('');
  });
});
