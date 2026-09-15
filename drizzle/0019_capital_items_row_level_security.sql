-- The half of the capital items' tables Drizzle does not model: their
-- `updated_at` triggers, the rule that an explicit split sums to the whole,
-- their grants, and `docs/data-model.md` §9's row-level security.
-- Hand-written, like `0017`, so the generator ignores it and the drift check
-- stays clean.
--
-- Two kinds of table, as in `0012`. `capital_items` and
-- `capital_item_allocations` are an org's, and get §9's template.
-- `capital_item_types` is reference data — one catalogue every org reads — and
-- gets `trade_tags`' read-only half of it.

-- `set_updated_at()` is `0001`'s, with the same `WHEN`, so an update that
-- changes nothing leaves the timestamp alone.
CREATE TRIGGER capital_item_types_set_updated_at
  BEFORE UPDATE ON capital_item_types
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER capital_items_set_updated_at
  BEFORE UPDATE ON capital_items
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER capital_item_allocations_set_updated_at
  BEFORE UPDATE ON capital_item_allocations
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- **An explicit split sums to the whole, and only an explicit split has
-- shares** (§5). No check constraint can say either — each is about a set of
-- rows — so this is a trigger, and a deferred one: an item made explicit and
-- its shares written are several statements in one transaction, and the rule
-- is about where they end up, not about the moments between. So it is judged at
-- commit, once everything the transaction meant to write is there.
--
-- Raised as a check violation naming a constraint, so a failed commit reads
-- like the other rules on these tables and a test can say which one it hit.
-- The message names no value: nothing here is somebody's data, but a message
-- that printed the shares would be the first that did.
--
-- Invoker's rights, deliberately. The scoped role that wrote the rows is the
-- role that reads them back here, through the same policies — which see one
-- org's rows, and an item's shares are always its own org's
-- (`capital_item_allocations_item` names the org). `search_path` is pinned for
-- `0001`'s reason, so every name below is qualified.
CREATE FUNCTION check_capital_item_allocation(item uuid) RETURNS void
  LANGUAGE plpgsql
  SET search_path = pg_catalog
  AS $$
DECLARE
  method public.allocation_method;
  shares bigint;
  total bigint;
BEGIN
  SELECT allocation INTO method FROM public.capital_items WHERE id = item;

  -- Deleted, and its shares with it (`on delete cascade`).
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*), coalesce(sum(share_bps), 0) INTO shares, total
    FROM public.capital_item_allocations
    WHERE capital_item_id = item;

  IF method = 'explicit' AND total <> 10000 THEN
    RAISE EXCEPTION 'An explicit split of a capital item must sum to 10000 basis points.'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'capital_item_allocations_sum_to_whole';
  END IF;

  IF method <> 'explicit' AND shares > 0 THEN
    RAISE EXCEPTION 'Only a capital item split explicitly has shares.'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'capital_item_allocations_explicit_only';
  END IF;
END;
$$;
--> statement-breakpoint

-- A share written, changed or removed: the item it belonged to, and the one it
-- belongs to now if an update moved it.
CREATE FUNCTION capital_item_allocations_sum_to_whole() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
  AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.check_capital_item_allocation(OLD.capital_item_id);
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.check_capital_item_allocation(NEW.capital_item_id);
  END IF;

  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- An item added as explicit, or switched to or from it: its shares have to
-- agree with its method by the time the transaction commits.
CREATE FUNCTION capital_items_allocation_shares() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
  AS $$
BEGIN
  PERFORM public.check_capital_item_allocation(NEW.id);

  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER capital_item_allocations_sum_to_whole
  AFTER INSERT OR UPDATE OR DELETE ON capital_item_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION capital_item_allocations_sum_to_whole();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER capital_items_allocation_shares
  AFTER INSERT OR UPDATE OF allocation ON capital_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION capital_items_allocation_shares();
--> statement-breakpoint

-- The scoped role, granted what the product does with these (§9): an item is
-- added, confirmed, edited, replaced and removed, and every one of those is an
-- insert or an update — a replacement is a new row and `removed` is a status
-- (§7). No `delete` on either until something offers one: the add-equipment
-- modal's Undo (#110) is the first, and brings its grant with it. A split's
-- shares are written with the item, and changed by the editor that sets them.
--
-- `select` and nothing else on the catalogue, which only a migration writes.
--
-- Nothing for `capexwise_identity` on any of the three (ADR-0007).
GRANT SELECT, INSERT, UPDATE ON capital_items TO capexwise_scoped;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON capital_item_allocations TO capexwise_scoped;
--> statement-breakpoint
GRANT SELECT ON capital_item_types TO capexwise_scoped;
--> statement-breakpoint

-- The backup's reader, `0007`, which names every table after it itself.
GRANT SELECT ON capital_item_types, capital_items, capital_item_allocations
  TO capexwise_reader;
--> statement-breakpoint

ALTER TABLE capital_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE capital_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE capital_item_allocations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE capital_item_allocations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- One org's rows, read and written. Every reference out of these names the org
-- as well, because the policy judges the row's own `org_id` and a foreign key
-- is checked past it — §9's fifth item.
CREATE POLICY capital_items_org_isolation ON capital_items
  FOR ALL
  TO capexwise_scoped
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint
CREATE POLICY capital_item_allocations_org_isolation ON capital_item_allocations
  FOR ALL
  TO capexwise_scoped
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint

-- Reference data, as `trade_tags` is in `0012`: enabled so a write granted by
-- mistake finds no policy to admit it, read by every org, and not forced,
-- because the owner is the role that seeds it (`0020`) and there is no org
-- here to keep from anyone.
ALTER TABLE capital_item_types ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY capital_item_types_read ON capital_item_types
  FOR SELECT
  TO capexwise_scoped
  USING (true);
--> statement-breakpoint

-- Every row, read only, for the nightly backup — without these it would dump
-- all three tables empty and the restore drill could not tell (`0007`).
CREATE POLICY capital_item_types_backup_read ON capital_item_types
  FOR SELECT
  TO capexwise_reader
  USING (true);
--> statement-breakpoint
CREATE POLICY capital_items_backup_read ON capital_items
  FOR SELECT
  TO capexwise_reader
  USING (true);
--> statement-breakpoint
CREATE POLICY capital_item_allocations_backup_read ON capital_item_allocations
  FOR SELECT
  TO capexwise_reader
  USING (true);
