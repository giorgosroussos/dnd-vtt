import { describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import {
  ARCHIVE_ENTRY_PATTERN,
  ARCHIVE_FORMAT_VERSION,
  ArchiveManifestSchema,
  TokenNumbersSchema,
  exportFileName,
  freeCampaignName,
  migrateFormat,
  safeFileName,
} from './archive.js';

// DMT-05: the archive format's pure parts (specs/09-operations.md §9, Q-115, D-181).

describe('export file names', () => {
  const day = new Date(2026, 9, 5, 23, 59);

  it('name a campaign export after the campaign and the local date, and a library export library', () => {
    expect(exportFileName('Curse of the Fallen', day)).toBe('Curse of the Fallen-2026-10-05.zip');
    expect(exportFileName(null, day)).toBe('library-2026-10-05.zip');
  });

  it.each([
    ['Dragon: "Heist"?', 'Dragon- -Heist--'],
    ['a/b\\c|d*e<f>g', 'a-b-c-d-e-f-g'],
    ['Tabs\tand\nlines', 'Tabs and lines'],
    ['Ends with dots...', 'Ends with dots'],
    ['  spaced  ', 'spaced'],
    ['CON', '_CON'],
    ['lpt1.txt', '_lpt1.txt'],
    ['Ωmega 🐉', 'Ωmega 🐉'],
  ])('keep %j a file name Windows accepts: %j', (name, expected) => {
    expect(safeFileName(name, 'campaign')).toBe(expected);
  });

  it('fall back when nothing usable is left, and stay short', () => {
    expect(safeFileName('...', 'campaign')).toBe('campaign');
    expect(safeFileName('???', 'campaign')).toBe('campaign');
    expect([...safeFileName('x'.repeat(300), 'campaign')]).toHaveLength(80);
  });
});

describe('an imported campaign name', () => {
  it('is its own while free, then takes the first free " (n)" from 2', () => {
    expect(freeCampaignName('Saga', new Set())).toBe('Saga');
    expect(freeCampaignName('Saga', new Set(['Saga']))).toBe('Saga (2)');
    expect(freeCampaignName('Saga', new Set(['Saga', 'Saga (2)', 'Saga (3)']))).toBe('Saga (4)');
    expect(freeCampaignName('Saga', new Set(['saga']))).toBe('Saga');
  });
});

describe('the format', () => {
  it('upgrades nothing in format 1, and never takes a newer one', () => {
    const data = { manifest: { format_version: 1 }, assets: [] };
    expect(migrateFormat(ARCHIVE_FORMAT_VERSION, data)).toBe(data);
    expect(() => migrateFormat(ARCHIVE_FORMAT_VERSION + 1, data)).toThrow(/newer/);
  });

  it('upgrades a format-1 campaign to format 2 with no map notes, and a format-1 assets archive with a count of none', () => {
    expect(ARCHIVE_FORMAT_VERSION).toBe(2);
    const campaign = migrateFormat(1, {
      manifest: { format_version: 1, kind: 'campaign', counts: { campaigns: 1, tokens: 3 } },
      tokens: [],
    });
    expect(campaign.mapnotes).toEqual([]);
    expect(campaign.manifest.counts).toEqual({ campaigns: 1, tokens: 3, map_notes: 0 });
    const assets = migrateFormat(1, { manifest: { format_version: 1, kind: 'assets', counts: { assets: 2 } } });
    expect(assets.mapnotes).toBeUndefined();
    expect(assets.manifest.counts).toEqual({ assets: 2, map_notes: 0 });
    // A manifest without counts is left for the schema to refuse.
    expect(migrateFormat(1, { manifest: { kind: 'campaign' } }).manifest).toEqual({ kind: 'campaign' });
  });

  it('allows only the manifest, the data files, the images and their two folders', () => {
    const sha = 'a'.repeat(64);
    for (const name of [
      'manifest.json',
      'data/',
      'images/',
      'data/tokens.json',
      `images/${sha}.png`,
      `images/${sha}.webp`,
    ]) {
      expect(ARCHIVE_ENTRY_PATTERN.test(name), name).toBe(true);
    }
    for (const name of [
      '../manifest.json',
      '/manifest.json',
      'data/../manifest.json',
      'data\\tokens.json',
      'C:/manifest.json',
      'data/Tokens.json',
      `images/${sha}.gif`,
      `images/${sha.slice(1)}.png`,
      `images/x/${sha}.png`,
      'notes.txt',
      'manifest.json/',
    ]) {
      expect(ARCHIVE_ENTRY_PATTERN.test(name), name).toBe(false);
    }
  });

  it('keys token numbers by asset id only, and refuses an unknown manifest field', () => {
    expect(Value.Check(TokenNumbersSchema, { '0e2f5f0c-1d7b-4b6a-9c3e-2a1f0b9d8c7e': 3 })).toBe(true);
    expect(Value.Check(TokenNumbersSchema, { __proto__x: 3 })).toBe(false);
    expect(Value.Check(TokenNumbersSchema, { '0e2f5f0c-1d7b-4b6a-9c3e-2a1f0b9d8c7e': 0 })).toBe(false);
    const manifest = {
      format_version: 1,
      app_version: '1.0.0',
      exported_at: '2026-10-05T18:30:00.000Z',
      kind: 'assets',
      counts: { campaigns: 0, sessions: 0, scenes: 0, tokens: 0, encounters: 0, map_notes: 0, assets: 0, images: 0 },
      images: [],
    };
    expect(Value.Check(ArchiveManifestSchema, manifest)).toBe(true);
    expect(Value.Check(ArchiveManifestSchema, { ...manifest, extra: 1 })).toBe(false);
    expect(Value.Check(ArchiveManifestSchema, { ...manifest, exported_at: 'yesterday' })).toBe(false);
  });
});
