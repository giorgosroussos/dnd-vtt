-- Painted fog (TBL-04, Q-101, D-154, specs/03-domain-model.md §1): one mask per scene replaces the fog
-- regions. `scene.fog` is the mask as JSON, rows of fogged runs in cells of a quarter square, checked by the
-- contract before it is written; no fog on an existing scene. The `region` table goes with its index: the
-- regions drawn before are not converted, by the owner's choice (D-154), and the runner's dated backup of
-- the database, written before this migration runs, keeps them.
ALTER TABLE scene ADD COLUMN fog TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(fog) AND json_type(fog) = 'array');

DROP TABLE region;
