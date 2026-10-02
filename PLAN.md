# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

- None: every work package of `13` is done. Owed by hand: the acceptance run on the owner's LG TV, deferred by the owner (D-151), tracked as G-043 with G-002, G-031 and G-040; follow `docs/acceptance/rel-03-owner-run.md` and hand the record back.

## Next

- None: REL-03 was the last package of `13` §7 and §10.

Proposed, not yet in `13`: Phase 6, a Windows package (draft ADR D-164, `Owner approval: pending`). Blocked by Q-107, Q-108 and Q-109; once they are answered and D-164 is approved, `13` gains §11 with these packages, `01` §5, `02` §8, `09` §1, §3, §4 and `12` are amended by `make unlock`, and `TRACEABILITY.md` gains their rows.

- `PKG-01` Portable build (`09` §1, `09` §3, `02` §8, `07` §1, `08` §9). Server bundled by esbuild with `better-sqlite3` and `sharp` external; staged `Emberglass/` folder with the renamed Node 24 runtime, the bundle, migrations, client build, production native modules for win32-x64, licences and third-party notices; a launcher that opens `http://localhost:3000/dm` and starts the server only if none answers; a real version shown in About; a `release` workflow on `v*` tags on `windows-latest` attaching the zip and its SHA-256 to a GitHub Release. Acceptance: on the Windows runner, unzipping into a folder with no Node on PATH and running the launcher with an empty `EMBERGLASS_DATA_DIR` answers `/api/health` and `make smoke`; a second launch opens the browser and starts no second server; `make check-docs` and the external-URL build check pass.
- `PKG-02` Installer (`09` §4, `09` §5, `09` §2). Inno Setup over the PKG-01 folder: per-machine, Start Menu and optional desktop shortcut, private-profile firewall rule for `emberglass.exe` removed on uninstall, upgrade in place, data directory never deleted; unsigned, SmartScreen steps and checksums in README and release notes. Acceptance: silent install on the Windows runner creates the shortcut and exactly one inbound rule on the private profile; installing a newer build over an older one keeps the data and the migration backup appears; silent uninstall removes the rule and the program folder and leaves `%APPDATA%\Emberglass`.
- `PKG-03` Package gates (`10` §3, `10` §5, `10` §6, `10` §4). The five journeys, the hidden-information suite and the offline run against the installed package on the Windows runner, as a job of the `release` workflow that must pass before the release is published; a manual install in Windows Sandbox recorded under `docs/acceptance/`. Acceptance: the job green on a release-candidate tag; the Sandbox record handed back by the owner.
