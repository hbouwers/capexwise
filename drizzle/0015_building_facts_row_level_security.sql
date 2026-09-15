-- The half of the building facts tables Drizzle does not model: their
-- `updated_at` triggers, their grants, and `docs/data-model.md` §9's row-level
-- security. Hand-written, like `0012`, so the generator ignores it and the
-- drift check stays clean.
--
-- All three are an org's, and get §9's template exactly as `buildings` did.

-- `set_updated_at()` is `0001`'s. Same three lines per table, and the same
-- `WHEN`, so an update that changes nothing leaves the timestamp alone.
CREATE TRIGGER building_facts_set_updated_at
  BEFORE UPDATE ON building_facts
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER building_utilities_set_updated_at
  BEFORE UPDATE ON building_utilities
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER building_access_codes_set_updated_at
  BEFORE UPDATE ON building_access_codes
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- The scoped role, granted only what the facts card's editor does (§9).
--
-- `building_facts` is one row per building, written the first time a day is
-- recorded and edited after that — clearing every field is an update, not a
-- delete, so there is no `delete`. It goes with its building, and that cascade
-- is the foreign key's, which runs as the table's owner and needs no grant.
--
-- Utilities and codes get all four: removing one from the editor deletes the
-- row. A code's delete is §7's hard delete — no ciphertext is kept for a lock
-- that has been rekeyed.
--
-- Nothing for `capexwise_identity` on any of the three (ADR-0007).
GRANT SELECT, INSERT, UPDATE ON building_facts TO capexwise_scoped;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON building_utilities TO capexwise_scoped;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON building_access_codes TO capexwise_scoped;
--> statement-breakpoint

-- The backup's reader, `0007`, which names every table after it itself. The
-- codes are dumped sealed: the reader holds no key, and the dump holds only
-- ciphertext (ADR-0008).
GRANT SELECT ON building_facts, building_utilities, building_access_codes
  TO capexwise_reader;
--> statement-breakpoint

ALTER TABLE building_facts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE building_facts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE building_utilities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE building_utilities FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE building_access_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE building_access_codes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- One org's rows, read and written. Each table's references to a building, a
-- unit or a contact name the org as well, because the policy judges a row's own
-- `org_id` and a foreign key is checked past it — §9's fifth item.
CREATE POLICY building_facts_org_isolation ON building_facts
  FOR ALL
  TO capexwise_scoped
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint
CREATE POLICY building_utilities_org_isolation ON building_utilities
  FOR ALL
  TO capexwise_scoped
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint
CREATE POLICY building_access_codes_org_isolation ON building_access_codes
  FOR ALL
  TO capexwise_scoped
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint

-- Every row, read only, for the nightly backup — without these it would dump
-- all three tables empty and the restore drill could not tell (`0007`).
CREATE POLICY building_facts_backup_read ON building_facts
  FOR SELECT
  TO capexwise_reader
  USING (true);
--> statement-breakpoint
CREATE POLICY building_utilities_backup_read ON building_utilities
  FOR SELECT
  TO capexwise_reader
  USING (true);
--> statement-breakpoint
CREATE POLICY building_access_codes_backup_read ON building_access_codes
  FOR SELECT
  TO capexwise_reader
  USING (true);
