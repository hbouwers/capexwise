-- The add-equipment modal's Undo (#110): the first thing the product offers
-- that deletes a capital item, and so the `delete` grant `0019` left for it
-- to bring. Hand-written, like `0019`, so the generator ignores it and the
-- drift check stays clean.
--
-- Undo takes back a batch the checklist has just added, and it is safe only
-- because nothing can refer to those rows yet (`modal-add-equipment.md`,
-- footer). Everything else about an item is history: a replaced item is what
-- the tax planner depreciates, and a removed one is gone but was there. So
-- the grant comes with a rule the database holds rather than the action — a
-- **restrictive** policy that admits a delete only of a row still as the
-- checklist left it:
--
-- - `estimated`, because `Confirm` makes an item audited and dates it, and an
--   audited item is a fact somebody read off a label;
-- - `active`, because a replaced or removed item is history by definition;
-- - no actual cost, because that is a tax basis whatever the confidence.
--
-- Restrictive, so it is AND'd with `capital_items_org_isolation` rather than
-- OR'd: the org rule still decides which rows are in reach at all, and this
-- one narrows a delete within them. A restrictive policy admits nothing on its
-- own, which is why the permissive one stays the only one the isolation
-- test's registry counts.
--
-- A replacement (`replaced_by_id`) points from the old row, which is
-- `replaced` and so refused here; the new row it points at is audited, and
-- refused too. An explicit split's shares go with their item by `cascade`,
-- which runs as the table's owner — so no grant on
-- `capital_item_allocations`, whose rows the checklist never writes.
GRANT DELETE ON capital_items TO capexwise_scoped;
--> statement-breakpoint
CREATE POLICY capital_items_delete_as_added ON capital_items
  AS RESTRICTIVE
  FOR DELETE
  TO capexwise_scoped
  USING (
    confidence = 'estimated'
    AND status = 'active'
    AND actual_cost_cents IS NULL
  );
