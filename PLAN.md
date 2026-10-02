# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### PKG-03

Package gates (`13` §11; `10` §3, `10` §4, `10` §5, `10` §6). The five journeys, the hidden-information suite and the offline run against the installed package on the Windows runner, as a job of the `release` workflow that must pass before the release is published (PKG-01 leaves it a draft, D-166); a manual install in Windows Sandbox from a downloaded zip and installer recorded under `docs/acceptance/`, with any Mark-of-the-Web warning (G-046). Acceptance: the job green on a release-candidate tag; the Sandbox record handed back by the owner. Work stays on the branch `pkg-windows-packaging`, with CI run on demand there. Deferred into it: build provenance and duplicate drafts (G-048), Mark-of-the-Web on a downloaded installer and zip (G-046). The owner adds `package · windows` to the ruleset on `main` (G-045).

Owed by hand, unchanged: the acceptance run on the owner's LG TV (D-151, G-043 with G-002, G-031 and G-040), following `docs/acceptance/rel-03-owner-run.md`.

## Next

