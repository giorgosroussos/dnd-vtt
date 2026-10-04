# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### PKG-03

Package gates (`13` §11; `10` §3, `10` §4, `10` §5, `10` §6; D-176, D-177). `make package-gates` and the `package gates · windows` job run in CI and in the `release` workflow, which publishes only after that job passes and the owner approves it, with build provenance. The release workflow published `v1.0.0-rc.1` (run 37052169914), refused to replace it on a re-run, and `gh attestation verify` passes on both files. The review's fixes (D-177) ran green: CI on PR #32, and `v1.0.0-rc.2` published by the fixed workflow after the owner's approval in the `release` environment (run 37197305433). Still to come: the draft path exercised (G-050); then the owner's Sandbox record from a release candidate, `docs/acceptance/pkg-03-sandbox-run.md`, with any Mark-of-the-Web warning written into the READMEs and the release notes (G-046), and `package · windows` and `package gates · windows` added to the ruleset on `main` (G-045).

Owed by hand, unchanged: the acceptance run on the owner's LG TV (D-151, G-043 with G-002, G-031 and G-040), following `docs/acceptance/rel-03-owner-run.md`.

## Next

