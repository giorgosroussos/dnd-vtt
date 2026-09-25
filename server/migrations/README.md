# Migrations

Numbered SQL migrations, applied in order by `src/db/migrate.ts` before the server accepts connections and by `make migrate` (`specs/09-operations.md` §2).

- Name files `NNNN_description.sql`, numbered from `0001` without gaps. A file is never edited or renumbered once merged; a change is a new migration.
- Each file runs in one transaction together with the bump of `PRAGMA user_version`, which is how the runner knows what is applied. Do not put `BEGIN` or `COMMIT` in a file.
- Changes are additive first; a destructive step needs an approved plan (`specs/14-agent-playbook.md` §8).
- When an existing database has pending migrations, the runner first writes a dated copy, `emberglass-backup-<UTC time>-v<version>.db`, next to it in the data directory.
- Foreign keys are off while migrations run, following SQLite's procedure for changing a table's schema, so rebuilding a parent table does not cascade-delete its children. Before each migration commits, the runner runs `PRAGMA foreign_key_check` and rolls back a migration that leaves a dangling reference (D-075).
- Each migration takes the write lock (`BEGIN IMMEDIATE`) and re-reads `PRAGMA user_version` under it, so a second process migrating the same file at the same time skips what the first applied.
- Never use `INSERT OR REPLACE` or `REPLACE` on an entity table: the implicit delete fires `ON DELETE` actions, so replacing a scene deletes its tokens and clears the live scene. Use `UPDATE` or `INSERT … ON CONFLICT DO UPDATE`.
- Every table is `STRICT, WITHOUT ROWID`, keyed by a text `id`. A CHECK constraint whose expression is NULL passes, so write it to refuse NULL explicitly (with `coalesce(…, 0)` or `IS NOT NULL`).
- Every migration is tested on the generated fixture database (`src/db/testing/fixture.ts`), which is written at schema version 1 and migrated forward by `src/db/schema.test.ts` (`specs/14-agent-playbook.md` §8). A migration that reshapes a record updates `readEntities` there.

`0001_initial_schema.sql` holds the eight entities of `specs/03-domain-model.md` §1 (SRV-01, D-075).

`0002_scene_token_numbers.sql` adds `scene.token_numbers`, the highest token number issued per asset on the scene, so that no number is issued twice (PRP-04, Q-091, D-101).
