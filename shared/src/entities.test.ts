import { readFileSync } from 'node:fs';
import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import {
  ASSET_CATEGORIES,
  DEFAULT_SETTINGS,
  GridPresetSchema,
  IMAGE_MIME_TYPES,
  ImageSchema,
  SceneSchema,
  SettingsSchema,
  TOKEN_SIZES,
  TokenSchema,
  UuidSchema,
  type Scene,
  type Token,
} from './index.js';

const spec = (file: string): string => readFileSync(new URL(`../../specs/${file}`, import.meta.url), 'utf8');

const UUID = '00000000-0000-4000-8000-000000000001';
const SHA = 'a'.repeat(64);

const token: Token = {
  id: UUID,
  scene_id: UUID,
  asset_id: UUID,
  label: 'Goblin 1',
  x: 2.25,
  y: 7.125,
  hidden: true,
  z_order: 0,
  character_id: null,
};

const scene: Scene = {
  id: UUID,
  session_id: UUID,
  name: 'Open ground',
  order: 0,
  map_image_id: null,
  grid: {
    type: 'square',
    size: null,
    offset_x: 0,
    offset_y: 0,
    visible: true,
    feet_per_square: 5,
    columns: 30,
    rows: 20,
  },
};

describe('entity contract (specs/03-domain-model.md §1, D-074)', () => {
  it('lists the asset categories and token sizes of specs/05-assets-and-images.md §1–§2', () => {
    const assets = spec('05-assets-and-images.md');
    const categories = /category \(([^)]+)\)/
      .exec(assets)![1]!
      .match(/`([a-z]+)`/g)!
      .map((c) => c.slice(1, -1));
    expect([...ASSET_CATEGORIES]).toEqual(categories);
    const sizes = assets
      .split('\n')
      .filter((line) => /^\| [A-Z][a-z]+(, [A-Z][a-z]+)? \|/.test(line) && !line.startsWith('| Size'))
      .flatMap((line) => line.split('|')[1]!.split(','))
      .map((size) => size.trim().toLowerCase());
    expect([...TOKEN_SIZES]).toEqual(sizes);
  });

  it('accepts the upload types of specs/05-assets-and-images.md §6 only', () => {
    expect([...IMAGE_MIME_TYPES]).toEqual(['image/png', 'image/jpeg', 'image/webp']);
  });

  it('defaults the settings as specs/05-assets-and-images.md §6–§7 and specs/06-grid-and-measurement.md §5 do', () => {
    expect(DEFAULT_SETTINGS).toEqual({ ruler_rule: 'phb', upload_limit_bytes: 52_428_800, display_variant_size: 4096 });
  });

  it('keeps token positions as decimal grid units and character_id empty', () => {
    expect(Value.Check(TokenSchema, token)).toBe(true);
    expect(Value.Check(TokenSchema, { ...token, x: 3, y: -0.5 })).toBe(true);
    expect(Value.Check(TokenSchema, { ...token, x: '2.25' })).toBe(false);
    expect(Value.Check(TokenSchema, { ...token, character_id: UUID })).toBe(false);
    expect(Value.Check(TokenSchema, { ...token, character_id: '' })).toBe(false);
    expect(Value.Check(TokenSchema, { ...token, notes: 'x' })).toBe(false);
  });

  it('holds a map-less scene with no square size, and only square grids', () => {
    expect(Value.Check(SceneSchema, scene)).toBe(true);
    expect(Value.Check(SceneSchema, { ...scene, grid: { ...scene.grid, type: 'hex' } })).toBe(false);
    expect(Value.Check(SceneSchema, { ...scene, grid: { ...scene.grid, columns: 0 } })).toBe(false);
    expect(Value.Check(GridPresetSchema, scene.grid)).toBe(false);
    expect(Value.Check(GridPresetSchema, { ...scene.grid, size: 70.4 })).toBe(true);
  });

  it('keys an image by a lowercase sha256 and everything else by a lowercase UUID', () => {
    const image = { id: SHA, mime: 'image/png', width: 1, height: 1, variants: {}, grid_preset: null };
    expect(Value.Check(ImageSchema, image)).toBe(true);
    expect(Value.Check(ImageSchema, { ...image, id: SHA.toUpperCase() })).toBe(false);
    expect(Value.Check(ImageSchema, { ...image, id: UUID })).toBe(false);
    expect(Value.Check(UuidSchema, UUID)).toBe(true);
    expect(Value.Check(UuidSchema, '00000000-0000-4000-8000-00000000000A')).toBe(false);
    expect(Value.Check(UuidSchema, '1')).toBe(false);
  });

  it('leaves the PIN hash out of the settings contract', () => {
    const settings = { id: UUID, live_scene_id: null, ...DEFAULT_SETTINGS };
    expect(Value.Check(SettingsSchema, settings)).toBe(true);
    expect(Value.Check(SettingsSchema, { ...settings, pin_hash: 'scrypt$…' })).toBe(false);
  });
});
