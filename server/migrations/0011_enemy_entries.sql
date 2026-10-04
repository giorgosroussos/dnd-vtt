-- Per-enemy initiative (DMT-02, Q-111, specs/04-live-sync.md §14, D-180): every stored encounter's one
-- Enemies entry (`kind: 'dm'`) is expanded in place into one `kind: 'monster'` entry per member it had, the
-- scene's monster and npc tokens players could see that did not carry Dead, with its initiative number and in
-- the order of the DM's token list; one without a member is removed, its turn passing as on removal. Members
-- were never stored and are computed from the fog, so the expansion is the step in code that
-- `src/db/migration-steps.ts` gives this file, run in this migration's transaction; the schema does not
-- change. Not reversible in place: the runner's dated backup before it is the rollback.
SELECT 1;
