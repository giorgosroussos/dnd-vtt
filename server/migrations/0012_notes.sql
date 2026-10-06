-- DM notes (DMT-04, Q-114, D-180, D-186, specs/03-domain-model.md §1, §10): on every scene and every token a plain-text
-- `notes`, empty by default, the DM's only. Additive: every existing scene and token has none, as before. The bound is
-- the contract's (shared/src/notes.ts); SQLite's length() of a text counts characters, as the contract does.
ALTER TABLE scene ADD COLUMN notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 20000);
ALTER TABLE token ADD COLUMN notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 20000);
