-- Map notes (UXR-08, Q-128, specs/03-domain-model.md §1, §7, §10): notes the DM pins at a point of a scene's map,
-- the DM's only, deleted with their scene. `x` and `y` are the point in decimal grid units, as a token's position is
-- (specs/03-domain-model.md §4). The bound on `notes` is the contract's (shared/src/notes.ts); SQLite's length() of a
-- text counts characters, as the contract does. Additive: no scene has a map note before it.
CREATE TABLE map_note (
  id TEXT NOT NULL PRIMARY KEY CHECK (id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
  scene_id TEXT NOT NULL REFERENCES scene (id) ON DELETE CASCADE,
  x REAL NOT NULL CHECK (abs(x) < 9e999),
  y REAL NOT NULL CHECK (abs(y) < 9e999),
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 20000)
) STRICT, WITHOUT ROWID;

CREATE INDEX map_note_scene_id ON map_note (scene_id);
