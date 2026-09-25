-- The highest token number issued on a scene, per asset (PRP-04, Q-091,
-- specs/05-assets-and-images.md §3, specs/03-domain-model.md §1): a JSON object
-- from asset id to a positive integer, so that a number freed by deleting a token,
-- the highest one included, is never issued again on that scene. Additive: an
-- existing scene starts with none recorded, and the server also reads the numbers
-- its tokens' labels carry, so a scene numbered before this migration continues
-- after its highest label. Never sent to a client.
ALTER TABLE scene ADD COLUMN token_numbers TEXT NOT NULL DEFAULT '{}'
  CHECK (CASE WHEN json_valid(token_numbers) THEN json_type(token_numbers) = 'object' ELSE 0 END);
