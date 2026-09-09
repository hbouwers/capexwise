-- The `updated_at` triggers for the tables `0004` added. Hand-written, like
-- `0001` and `0003`, because Drizzle does not model triggers — the generator
-- ignores this file, which is why the drift check stays clean.
--
-- `set_updated_at()` is created once, by `0001`. Each new table adds only its
-- own trigger, and every one is the same three lines with a different name.
--
-- Three triggers, not four. `rate_limits` has no `updated_at` to maintain: the
-- table is a set of counters the provider overwrites in place and deletes when
-- the window closes, and `src/db/schema/auth.ts` says why it is the one table in
-- the schema without the pair.
--
-- These three matter more than the earlier ones rather than less. Better Auth
-- writes every row in them through its own adapter, and it sets `updatedAt`
-- itself on some paths and not others. The trigger makes the column mean the
-- same thing on all of them, which is exactly `docs/data-model.md` §1's reason
-- for putting this in the database instead of the application.
--
-- `WHEN (OLD.* IS DISTINCT FROM NEW.*)` on all three, as everywhere else: an
-- UPDATE that changes nothing must not move the timestamp, or `updated_at` comes
-- to mean "last touched" rather than "last changed". That case is real here —
-- session refresh re-saves a row whose values have not moved.

CREATE TRIGGER sessions_set_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER accounts_set_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER verifications_set_updated_at
  BEFORE UPDATE ON verifications
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
