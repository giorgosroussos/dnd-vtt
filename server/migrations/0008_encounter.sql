-- The initiative tracker (TBL-06, Q-104, Q-105, specs/03-domain-model.md §1, §2, §7, D-160): at most one
-- encounter per scene, deleted with it. `entries` is a JSON array in turn order, each a player character's
-- entry naming its token or the one Enemies entry, checked by the contract before it is written; the
-- Enemies entry's members are never stored. `enemies_seen` is whether the encounter has had a member
-- (Q-106). Additive: no scene has an encounter before it.
CREATE TABLE encounter (
  id TEXT NOT NULL PRIMARY KEY CHECK (id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
  scene_id TEXT NOT NULL REFERENCES scene (id) ON DELETE CASCADE,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  round INTEGER NOT NULL CHECK (round >= 1),
  current_index INTEGER NOT NULL CHECK (current_index >= 0),
  enemies_seen INTEGER NOT NULL CHECK (enemies_seen IN (0, 1)),
  entries TEXT NOT NULL CHECK (json_valid(entries) AND json_type(entries) = 'array')
) STRICT, WITHOUT ROWID;

CREATE UNIQUE INDEX encounter_scene_id ON encounter (scene_id);
