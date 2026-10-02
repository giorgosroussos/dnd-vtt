# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### PKG-03

Package gates (`13` §11; `10` §3, `10` §4, `10` §5, `10` §6; D-176). Implemented, and passing locally against the Linux package: `make package-gates` and the `package gates · windows` job in CI and in the `release` workflow, which now publishes only after that job passes, with build provenance (G-048); the owner's Sandbox run sheet `docs/acceptance/pkg-03-sandbox-run.md` (G-046). `package gates · windows` is green on the Windows runner (CI run 37049232462). Acceptance still to come, in this order: the release workflow green on a release-candidate tag such as `v1.0.0-rc.1`, publishing a pre-release, then its release job re-run and refusing to replace it (G-048); the owner's Sandbox record from that pre-release, with any Mark-of-the-Web warning written into the READMEs and the release notes (G-046). The owner adds `package · windows` and `package gates · windows` to the ruleset on `main` (G-045).

Owed by hand, unchanged: the acceptance run on the owner's LG TV (D-151, G-043 with G-002, G-031 and G-040), following `docs/acceptance/rel-03-owner-run.md`.

## Next

