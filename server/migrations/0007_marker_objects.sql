-- Condition markers as objects (TBL-05, Q-103, D-157, specs/03-domain-model.md §1): each stored name becomes
-- {"id": name}, in the same order. Lossless: the four names of 0004 are all among the eighteen conditions,
-- and the reverse is each object's id. Exhaustion, the only marker with a level, did not exist before.
UPDATE token
SET markers = (
  SELECT json_group_array(json_object('id', each.value) ORDER BY each.key)
  FROM json_each(token.markers) AS each
  WHERE each.type = 'text'
)
-- Only arrays that still hold names: a row already holding objects is left as it is, so a second run (a
-- restore of a partly migrated file) cannot empty it (TBL-05 review).
WHERE EXISTS (SELECT 1 FROM json_each(token.markers) WHERE type = 'text');
