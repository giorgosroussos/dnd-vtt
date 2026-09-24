# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### SRV-03 — Campaigns, sessions and scenes over REST: review and CI

- **Outcome:** the SRV-03 implementation (D-078), which passes `make verify` locally, is reviewed and green on both CI runners, and the row in `TRACEABILITY.md` moves to `done`.
- **Specs:** `13` §4 SRV-03, `02` §5, `03` §2, `03` §3, `03` §5, `03` §6, `03` §7; D-075, D-078.
- **Remaining acceptance (executable):**
  - Prompt 2 (review) run on the SRV-03 change (`Surfaces: data`, `Touches red line: yes`, `Contract change: yes`); critical and high findings fixed with tests.
  - `make verify` exit 0 on both CI runners, read back from the pipeline; `TRACEABILITY.md` SRV-03 row `done` with the run.
- **Open card:** Q-090 (campaign order, `08` §1 against `03` §1) is for the owner to answer or defer to PRP-01; campaigns are listed by name meanwhile.
- **Non-goals:** as before: scene setup and tokens while not live (PRP-02 to PRP-04), image upload (SRV-04), the sidebar UI (PRP-01), live-scene activation (LIV-04).

## Next

1. **SRV-04 — Image upload pipeline.** PNG, JPEG and WebP judged by content under the configurable limit, a rejection storing nothing, sha256 identity with duplicate reuse, WebP display and thumbnail variants that validate against `ImageVariantsSchema` (G-009), and removal of an image nobody references on every SRV-03 deletion path (G-013) (`13` §4, `05` §6, `05` §7, `03` §7).
2. **SRV-05 — Asset library over REST.** Search and tag filter, create, update, delete refused while in use with the scenes listed, tag case decided (G-009) (`13` §4, `05` §1, `05` §2, `05` §4, `05` §5).
