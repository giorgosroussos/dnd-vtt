import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import { SceneTokenSchema, TokenCreateBodySchema, TokenSchema, TokenUpdateBodySchema } from './index.js';

// The token bodies of PRP-04 (D-100): the server alone generates ids, numbers labels and sets
// visibility from the asset, so a placement names only the asset and the position.

const UUID = '00000000-0000-4000-8000-000000000001';

describe('token bodies (PRP-04, D-100)', () => {
  it('places a token by asset and a decimal position only', () => {
    expect(Value.Check(TokenCreateBodySchema, { asset_id: UUID, x: 1.25, y: -0.5 })).toBe(true);
    for (const extra of [{ id: UUID }, { label: 'A' }, { hidden: true }, { z_order: 1 }, { scene_id: UUID }]) {
      expect(Value.Check(TokenCreateBodySchema, { asset_id: UUID, x: 0, y: 0, ...extra }), JSON.stringify(extra)).toBe(
        false,
      );
    }
    expect(Value.Check(TokenCreateBodySchema, { asset_id: UUID, x: 0 })).toBe(false);
  });

  it('changes position, visibility, label and stacking order, at least one of them', () => {
    for (const body of [{ x: 1.5 }, { y: 2 }, { hidden: false }, { label: 'Goblin 3' }, { stack: 'back' }]) {
      expect(Value.Check(TokenUpdateBodySchema, body), JSON.stringify(body)).toBe(true);
    }
    for (const body of [
      {},
      { label: ' ' },
      { label: '' },
      { label: 'a\u0000' },
      { label: '\u0000' },
      { label: 'a\tb' },
      { z_order: 3 },
      { stack: 'up' },
      { asset_id: UUID },
    ]) {
      expect(Value.Check(TokenUpdateBodySchema, body), JSON.stringify(body)).toBe(false);
    }
  });

  it('answers a token with its stored fields and the drawing fields of its asset', () => {
    expect(Object.keys(SceneTokenSchema.properties)).toEqual([...Object.keys(TokenSchema.properties), 'asset']);
    expect(Object.keys(SceneTokenSchema.properties.asset.properties)).toEqual(['name', 'image_id', 'size']);
  });
});
