-- The half of `buildings` and `units` Drizzle does not model: their `updated_at`
-- triggers, their grants, and `docs/data-model.md` §9's row-level security.
-- Hand-written, like `0003`, `0006` and `0007`, so the generator ignores it and
-- the drift check stays clean. The first two tables inside the boundary, and the
-- template every domain table after them copies.

-- `set_updated_at()` is `0001`'s. Same three lines per table, and the same
-- `WHEN`, so an update that changes nothing leaves the timestamp alone.
CREATE TRIGGER buildings_set_updated_at
  BEFORE UPDATE ON buildings
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER units_set_updated_at
  BEFORE UPDATE ON units
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- The scoped role: all four commands, because the building form creates, edits
-- and removes both. `delete` on `buildings` is for the typo case §7 allows — a
-- building nothing hangs off yet — and `units_building`'s `restrict` refuses it
-- for anything else. Nothing for `capexwise_identity`: these are inside the
-- boundary, and the identity path has no business here (ADR-0007).
GRANT SELECT, INSERT, UPDATE, DELETE ON buildings, units TO capexwise_scoped;
--> statement-breakpoint

-- The backup's reader, `0007`. Its `grant select on all tables` covered the
-- tables that existed then and no others, so every table after it says so
-- itself.
GRANT SELECT ON buildings, units TO capexwise_reader;
--> statement-breakpoint

ALTER TABLE buildings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE buildings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE units ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE units FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- One org's rows, read and written. The policy cannot see through a foreign
-- key — Postgres checks a reference past row-level security — which is why
-- `units_building` names the org as well as the building: `with check` keeps a
-- unit in its org, and the reference keeps its building there too.
CREATE POLICY buildings_org_isolation ON buildings
  FOR ALL
  TO capexwise_scoped
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint
CREATE POLICY units_org_isolation ON units
  FOR ALL
  TO capexwise_scoped
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint

-- Every row, read only, for the nightly backup — without these it would dump
-- both tables empty and the restore drill could not tell (`0007`).
CREATE POLICY buildings_backup_read ON buildings
  FOR SELECT
  TO capexwise_reader
  USING (true);
--> statement-breakpoint
CREATE POLICY units_backup_read ON units
  FOR SELECT
  TO capexwise_reader
  USING (true);
