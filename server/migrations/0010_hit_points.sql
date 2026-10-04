-- Hit points and armour class (DMT-01, Q-112, D-180, specs/03-domain-model.md §1, §9): on every token its current,
-- maximum and temporary hit points and its armour class, and on every asset a default maximum and armour class
-- copied to its new tokens; each a whole number or NULL for none, the DM's only. Additive: every existing token
-- and asset has none, as before. The bounds are the contract's (shared/src/hp.ts); a CHECK on NULL passes.
ALTER TABLE token ADD COLUMN hp_current INTEGER CHECK (hp_current IS NULL OR hp_current BETWEEN 0 AND 9999);
ALTER TABLE token ADD COLUMN hp_max INTEGER CHECK (hp_max IS NULL OR hp_max BETWEEN 1 AND 9999);
ALTER TABLE token ADD COLUMN hp_temp INTEGER CHECK (hp_temp IS NULL OR hp_temp BETWEEN 0 AND 9999);
ALTER TABLE token ADD COLUMN ac INTEGER CHECK (ac IS NULL OR ac BETWEEN 0 AND 99);
ALTER TABLE asset ADD COLUMN hp_max INTEGER CHECK (hp_max IS NULL OR hp_max BETWEEN 1 AND 9999);
ALTER TABLE asset ADD COLUMN ac INTEGER CHECK (ac IS NULL OR ac BETWEEN 0 AND 99);
