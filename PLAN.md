# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### DMT-01

Hit points and armour class (`13` §12; `03` §9, `04` §2, `04` §3, `04` §4, `04` §8, `04` §15, `05` §1, `05` §3, `08` §13, `10` §3; Q-112, Q-116, D-180, D-181, D-182). An additive migration adds nullable `hp_current`, `hp_max`, `hp_temp` and `ac` to tokens and `hp_max` and `ac` to assets, the defaults copied to new tokens; `token.setStats` and `token.applyHp { delta }` are undoable live commands, temporary hit points taking damage first; with `hp_max` set, Bloodied follows half, 0 sets Dead (monster, npc) or Unconscious (player character), and rising above 0 removes neither, live and in preparation. Acceptance: integration tests on a real SQLite file cover each threshold, with and without `hp_max`, undo and redo, and the asset defaults; the hidden-information suite passes with hit points in its script and finds none in any player message. Implemented and green locally (D-182, TRACEABILITY.md); left: CI on the pull request and prompt 2 (review), whose findings are fixed on the branch before DMT-01 is done.

### DMT-02

Per-enemy initiative (`13` §12; `03` §1, `04` §4, `04` §14, `08` §12, `10` §3; Q-111, Q-117, Q-118, D-180, D-181, D-183, D-184). One `kind: monster` entry per visible, living monster and npc at start, sorted, dragged, added (optionally with its number) and removed like a player character's; Dead or unseen ones kept and passed over; the tokens players newly see offered together; "No enemies left. End combat?" when the turn passes with no enemy able to act; migration 0011 expanding a stored Enemies entry in place; the TV strip naming each enemy by its label, a Dead one greyed. Acceptance: the encounter's rule tests and integration tests cover start, sorting, turns passing over Dead and unseen entries, the late-enemy offer and the expansion of a stored encounter; the hidden-information suite passes with a hidden monster in the encounter; `e2e/tests/initiative.spec.ts` shows each bandit's label on the TV strip. Implemented and green locally (TRACEABILITY.md); left: CI on the pull request and prompt 2 (review), whose findings are fixed on the branch before DMT-02 is done.

### DMT-03

Follow my view (`13` §12; `04` §9, `08` §11, `08` §13; Q-113, Q-120, D-185). A toggle among the live scene's TV camera controls (and C), off at every activation, kept by the DM view: while on, the DM's whole visible area widened to the TV's shape about its centre (`followRect`) goes out as `camera.setPlayer` through a 100 ms throttle with leading and trailing sends, an unchanged camera not sent; the frame hidden and the live indicator saying "TV follows you"; Lock TV camera, Send my view, Fit map, TV zoom and the frame, another scene going live and the TV going idle turning it off, the TV camera's own events never; paused while another scene is open and resumed, sending at once, on returning (Q-120); the TV gliding 120 ms between cameras. Acceptance: unit tests of the widening (wider, narrower, same shape, the bounds) and the throttle; component tests of each way off, the echo, the pause and resume; `e2e/tests/follow.spec.ts` with a DM and a player context. Implemented and green locally (TRACEABILITY.md); left: CI on the pull request and prompt 2 (review), whose findings are fixed on the branch before DMT-03 is done.

Owed by hand, before the 1.0.0 release:

- the acceptance run on the owner's LG TV (D-151, G-043 with G-002, G-031 and G-040), following `docs/acceptance/rel-03-owner-run.md`;
- the install in Windows Sandbox from a release candidate (D-178, G-046), following `docs/acceptance/pkg-03-sandbox-run.md`.

## Next

- DMT-04 DM notes (`13` §12; `03` §10, `04` §16; Q-114).
- DMT-05 Export and import (`13` §12; `09` §9, `07` §9; Q-115, Q-119), last so that its format carries every field above.
