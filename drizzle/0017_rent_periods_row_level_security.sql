-- The half of `rent_periods` Drizzle does not model: its `updated_at` trigger,
-- its grants, and `docs/data-model.md` §9's row-level security. Hand-written,
-- like `0015`, so the generator ignores it and the drift check stays clean.

-- `set_updated_at()` is `0001`'s, with the same `WHEN`, so an update that
-- changes nothing leaves the timestamp alone.
CREATE TRIGGER rent_periods_set_updated_at
  BEFORE UPDATE ON rent_periods
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- The scoped role, granted what the rent roll does (§9): it opens a period on
-- first view, and marks, un-marks and corrects one after that. No `delete`.
-- §7 allows removing a period nothing was recorded against, and nothing in v0
-- offers it: a month the unit stood empty is marked vacant on the row, which
-- is a record, where a missing row would be reopened by the next view (#97).
--
-- Nothing for `capexwise_identity` (ADR-0007).
GRANT SELECT, INSERT, UPDATE ON rent_periods TO capexwise_scoped;
--> statement-breakpoint

-- The backup's reader, `0007`, which names every table after it itself.
GRANT SELECT ON rent_periods TO capexwise_reader;
--> statement-breakpoint

ALTER TABLE rent_periods ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE rent_periods FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- One org's rows, read and written. The reference to the unit names the org
-- as well, because the policy judges the row's own `org_id` and a foreign key
-- is checked past it — §9's fifth item.
CREATE POLICY rent_periods_org_isolation ON rent_periods
  FOR ALL
  TO capexwise_scoped
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint

-- Every row, read only, for the nightly backup — without it the table would be
-- dumped empty and the restore drill could not tell (`0007`).
CREATE POLICY rent_periods_backup_read ON rent_periods
  FOR SELECT
  TO capexwise_reader
  USING (true);
