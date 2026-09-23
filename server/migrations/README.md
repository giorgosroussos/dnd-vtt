# Migrations

Numbered SQL migrations, applied in order by `src/db/migrate.ts` before the server accepts connections and by `make migrate` (`specs/09-operations.md` §2).

- Name files `NNNN_description.sql`, numbered from `0001` without gaps. A file is never edited or renumbered once merged; a change is a new migration.
- Each file runs in one transaction together with the bump of `PRAGMA user_version`, which is how the runner knows what is applied. Do not put `BEGIN` or `COMMIT` in a file.
- Changes are additive first; a destructive step needs an approved plan (`specs/14-agent-playbook.md` §8).
- When an existing database has pending migrations, the runner first writes a dated copy, `emberglass-backup-<UTC time>-v<version>.db`, next to it in the data directory.

The schema itself arrives with SRV-01; until then this folder holds no migration.
