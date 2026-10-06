-- The import limit (DMT-05, Q-119, specs/09-operations.md §7, §9, specs/03-domain-model.md §1): the largest archive an
-- import takes, and the most its entries may unpack to, in bytes; 2 GB by default, changed in Settings without
-- restarting. The contract bounds it (shared/src/archive.ts, IMPORT_LIMIT_BOUNDS); this keeps it positive. Additive:
-- every existing database starts at the default.
ALTER TABLE settings ADD COLUMN import_limit_bytes INTEGER NOT NULL DEFAULT 2147483648 CHECK (import_limit_bytes > 0);
