-- The TV address of the connect panel (PKG-01, Q-110, specs/08-ux-journeys.md §5, specs/09-operations.md §7,
-- specs/03-domain-model.md §1, D-169): the IPv4 address the DM chose in Settings for the panel, the QR code
-- and the console, or NULL for Automatic, where the server ranks the addresses itself. The contract checks
-- each part is 0 to 255; this keeps anything that is not four dotted numbers out. Additive: every existing
-- database starts on Automatic, as before.
ALTER TABLE settings ADD COLUMN tv_address TEXT CHECK (
  tv_address IS NULL
  OR (
    length(tv_address) BETWEEN 7 AND 15
    AND tv_address GLOB '[0-9]*.[0-9]*.[0-9]*.[0-9]*'
    AND tv_address NOT GLOB '*[^0-9.]*'
    AND tv_address NOT GLOB '*.*.*.*.*'
  )
);
