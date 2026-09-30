-- The condition markers a token carries (TBL-02, Q-099, specs/03-domain-model.md §1): a JSON array
-- of distinct names from bloodied, unconscious, dead and concentrating, in that order, written by
-- the server only. Additive; an existing token carries none.
ALTER TABLE token ADD COLUMN markers TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(markers) AND json_type(markers) = 'array');
