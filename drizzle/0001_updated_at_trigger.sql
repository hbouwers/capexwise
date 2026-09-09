-- `updated_at` is maintained by the database, not by the application, so a
-- manual UPDATE in psql cannot leave it stale (docs/data-model.md §1). Drizzle
-- does not model functions or triggers, so this is a hand-written migration —
-- `drizzle-kit generate --custom`. The generator ignores it, which is why the
-- drift check stays clean.
--
-- One function, reused by every table. Each new table's migration adds its own
-- three-line CREATE TRIGGER; the function is created once, here.

-- `search_path` is pinned rather than inherited. A function that resolves
-- unqualified names through the caller's search_path can be made to call
-- something else entirely by a role that can create objects in a schema
-- earlier on that path. Nothing here needs more than pg_catalog.
CREATE FUNCTION set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
  AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- `WHEN (OLD.* IS DISTINCT FROM NEW.*)` so an UPDATE that changes nothing does
-- not move the timestamp. Without it, any write path that re-saves an unedited
-- form makes `updated_at` mean "last touched" rather than "last changed".
CREATE TRIGGER organizations_set_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
