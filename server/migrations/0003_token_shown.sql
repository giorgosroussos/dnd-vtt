-- Whether players have seen the token (Q-096, specs/05-assets-and-images.md §3,
-- specs/03-domain-model.md §1): set when it is first shown, placed visible or revealed,
-- and never cleared, so a token players saw with its asset's bare name that is hidden and
-- revealed again keeps its label instead of being numbered as at a first showing. Never
-- sent to a client. Additive; an existing token counts as shown when it is visible, or when
-- its label is not its asset's bare name (numbered at a showing, or typed by the DM, which
-- is never renumbered either way). A hidden bare-named token is left not shown, as it was
-- treated before.
ALTER TABLE token ADD COLUMN shown INTEGER NOT NULL DEFAULT 0 CHECK (shown IN (0, 1));
UPDATE token SET shown = 1
  WHERE hidden = 0 OR label <> (SELECT asset.name FROM asset WHERE asset.id = token.asset_id);
