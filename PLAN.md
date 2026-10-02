# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### PKG-01

Portable build (`13` §11; `09` §1, `09` §3, `02` §8, `07` §1, `02` §6; D-164, D-166, D-167). Server bundled by esbuild with `better-sqlite3` and `sharp` external; staged `Emberglass/` folder with the renamed Node 24 runtime, the bundle, migrations, client build, production native modules for win32-x64, `LICENSE`, third-party notices and the source tag; a launcher that opens `http://localhost:3000/dm` and starts the server only if none answers on `/api/auth` (no health route: Q-046, D-166); a real version shown in About & credits; a `release` workflow on `v*` tags on `windows-latest` attaching the zip and its SHA-256 to a draft GitHub Release.

Built on the branch and passing locally on Linux (`make package`, `TRACEABILITY.md`). Work stays on the branch `pkg-windows-packaging` until the owner has checked it; no pull request. Remaining acceptance: the `package · windows` job green on that branch, from CI run on demand (Actions → CI → Run workflow, branch `pkg-windows-packaging`; a push to a branch other than `main` starts no run), i.e. on the Windows runner unzipping into a folder with no Node on PATH and running `Emberglass.cmd` with an empty `EMBERGLASS_DATA_DIR` passes `make smoke`'s checks, a second launch opens the browser and starts no second server, and `emberglass.exe` describes itself as Emberglass; `make verify` and `make check-docs` green there too. Review prompt runs after (Surfaces include security; touches a red line). The owner adds `package · windows` to the ruleset (G-045).

Owed by hand, unchanged: the acceptance run on the owner's LG TV (D-151, G-043 with G-002, G-031 and G-040), following `docs/acceptance/rel-03-owner-run.md`.

## Next

- `PKG-02` Installer (`13` §11; `09` §4, `09` §5, `09` §2). Inno Setup over the PKG-01 folder: per-machine, Start Menu and optional desktop shortcut, private-profile firewall rule for `emberglass.exe` removed on uninstall, upgrade in place, data directory never deleted; unsigned, SmartScreen steps and checksums in README and release notes. Acceptance: silent install on the Windows runner creates the shortcut and exactly one inbound rule on the private profile; installing a newer build over an older one keeps the data and the migration backup appears; silent uninstall removes the rule and the program folder and leaves `%APPDATA%\Emberglass`.
- `PKG-03` Package gates (`13` §11; `10` §3, `10` §4, `10` §5, `10` §6). The five journeys, the hidden-information suite and the offline run against the installed package on the Windows runner, as a job of the `release` workflow that must pass before the release is published (PKG-01 leaves it a draft, D-166); a manual install in Windows Sandbox from a downloaded zip and installer recorded under `docs/acceptance/`, with any Mark-of-the-Web warning (G-046). Acceptance: the job green on a release-candidate tag; the Sandbox record handed back by the owner.
