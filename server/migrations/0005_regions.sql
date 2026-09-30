-- Fog regions (TBL-03, Q-099, specs/03-domain-model.md §1, §2, §7): the ninth entity. A region belongs
-- to one scene and goes with it; its outline is a JSON rectangle or polygon in grid units, checked by the
-- contract before it is written; `hidden` is whether it is fogged; `order` keeps the order the regions
-- were drawn in. Additive: no scene has a region before it.
CREATE TABLE region (
  id TEXT NOT NULL PRIMARY KEY CHECK (id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
  scene_id TEXT NOT NULL REFERENCES scene (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (name <> ''),
  "order" INTEGER NOT NULL,
  shape TEXT NOT NULL CHECK (json_valid(shape) AND json_type(shape) = 'object'),
  hidden INTEGER NOT NULL DEFAULT 1 CHECK (hidden IN (0, 1))
) STRICT, WITHOUT ROWID;

CREATE INDEX region_scene_id ON region (scene_id);
