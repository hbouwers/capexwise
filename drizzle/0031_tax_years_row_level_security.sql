-- The half of `tax_years` Drizzle does not model: the `updated_at` trigger,
-- the grants, and `docs/data-model.md` §9's row-level security. Hand-written,
-- like `0029`, so the generator ignores it and the drift check stays clean.

-- `set_updated_at()` is `0001`'s, with the same `WHEN`.
CREATE TRIGGER tax_years_set_updated_at
  BEFORE UPDATE ON tax_years
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- The scoped role, granted what the tax planner does (§9): a year's settings
-- are written the first time one is changed, and changed after that. **No
-- `delete`**: a year with no row reads as the defaults, so there is nothing a
-- delete would do that setting the defaults back would not, and #44's freeze
-- of a filed year will land on this row.
--
-- Nothing for `capexwise_identity` (ADR-0007).
GRANT SELECT, INSERT, UPDATE ON tax_years TO capexwise_scoped;
--> statement-breakpoint

-- The backup's reader, `0007`.
GRANT SELECT ON tax_years TO capexwise_reader;
--> statement-breakpoint

ALTER TABLE tax_years ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tax_years FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- One org's rows, read and written.
CREATE POLICY tax_years_org_isolation ON tax_years
  FOR ALL
  TO capexwise_scoped
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint

-- Every row, read only, for the nightly backup (`0007`).
CREATE POLICY tax_years_backup_read ON tax_years
  FOR SELECT
  TO capexwise_reader
  USING (true);
